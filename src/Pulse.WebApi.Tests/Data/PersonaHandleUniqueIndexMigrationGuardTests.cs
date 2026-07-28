namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>backend-host/03-persona-handle-uniqueness</c>: proves the <c>PersonaHandleUniqueIndex</c>
/// migration's hand-written pre-flight guard behaves as designed on a database that ALREADY holds data — the
/// live-UAT-shaped case. Two halves, both load-bearing:
/// <list type="number">
/// <item>an already-seeded cast (six distinct handles) migrates cleanly — the guard is not a tripwire that
/// blocks every populated environment;</item>
/// <item>a genuinely duplicated <c>(ExerciseId, Handle)</c> pair FAILS the migration with a diagnostic naming
/// the offending group, and leaves the schema untouched — it does not silently de-duplicate.</item>
/// </list>
/// </summary>
/// <remarks>
/// <para>
/// <b>Why its own database.</b> These tests must migrate FROM the previous migration, so they cannot use the
/// shared <see cref="MsSqlContainerFixture"/> database (already fully migrated, and shared with every other
/// test in the collection). Each test provisions and drops its own throwaway database on whichever real SQL
/// Server the fixture resolved (Testcontainers in CI, <c>PULSE_TEST_SQL_CONNECTION</c> locally), so nothing here
/// can perturb a sibling test.
/// </para>
/// <para>
/// Without these, the guard would be the one piece of hand-written SQL in the change that CI never executes —
/// broken guard SQL would surface for the first time during a real deployment.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class PersonaHandleUniqueIndexMigrationGuardTests
{
    /// <summary>The migration immediately before the one under test — the "before" state to seed data into.</summary>
    private const string PreviousMigration = "20260722163046_EngineReviewItems";

    /// <summary>The migration under test.</summary>
    private const string MigrationUnderTest = "20260725120413_PersonaHandleUniqueIndex";

    private readonly MsSqlContainerFixture _fixture;

    public PersonaHandleUniqueIndexMigrationGuardTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AnAlreadySeededCast_MigratesCleanly()
    {
        // The UAT case the guard must NOT break: a database already carrying a seeded six-persona cast (plus a
        // second exercise reusing the same handles, which is legal per-exercise) migrates forward without error.
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);

        await database.MigrateToAsync(PreviousMigration);

        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        string[] cast = ["FairhavenWater", "FulcoEM", "Newsline7", "mvega_fh", "tbrandt41", "kwardFH"];
        await database.InsertPersonasAsync(exerciseA, cast);
        await database.InsertPersonasAsync(exerciseB, cast);

        var act = async () => await database.MigrateToAsync(MigrationUnderTest);

        await act.Should().NotThrowAsync(
            "an environment with a legitimately seeded cast must migrate without a de-duplication step");

        (await database.CountPersonasAsync()).Should().Be(cast.Length * 2, "the migration must not delete rows");
    }

    [RequiresDockerFact]
    public async Task APreExistingDuplicate_FailsTheMigration_WithADiagnostic_AndDeletesNothing()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);

        await database.MigrateToAsync(PreviousMigration);

        var exerciseId = Guid.NewGuid();
        // Case-variant spellings, because that is the harder case: the guard's GROUP BY has to fold case the same
        // way the index key would, or it would wave through rows the CREATE INDEX then rejects with an opaque error.
        await database.InsertPersonasAsync(exerciseId, ["mvega_fh", "MVega_FH"]);

        var act = async () => await database.MigrateToAsync(MigrationUnderTest);

        var thrown = (await act.Should().ThrowAsync<SqlException>(
            "the migration must refuse to run rather than silently resolving the duplicate for the operator")).And;

        thrown.Message.Should().Contain("IX_Personas_ExerciseId_Handle");
        // ContainEquivalentOf, not Contain: SQL Server's CONVERT renders a uniqueidentifier in UPPERCASE, whereas
        // Guid.ToString() is lowercase.
        thrown.Message.Should().ContainEquivalentOf(
            exerciseId.ToString(),
            "the diagnostic must name WHICH exercise is in the way — a bare index-creation failure does not");
        thrown.Message.Should().ContainEquivalentOf(
            "mvega_fh",
            "the diagnostic must name the offending handle so the operator can act on it directly");

        (await database.CountPersonasAsync()).Should().Be(2, "a refused migration must not delete anything");
        (await database.IndexExistsAsync()).Should().BeFalse(
            "the migration's transaction must roll back, leaving the schema exactly as it was");
    }

    /// <summary>
    /// A throwaway database on the same real SQL Server the shared fixture resolved, created per test and dropped
    /// on disposal — so a partial-migration test can never leave the collection's shared database behind.
    /// </summary>
    private sealed class EphemeralDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _name;

        private EphemeralDatabase(string masterConnectionString, string name, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _name = name;
            ConnectionString = connectionString;
        }

        private string ConnectionString { get; }

        public static async Task<EphemeralDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            if (fixture.ConnectionString is null)
            {
                throw new InvalidOperationException(
                    "The shared MSSQL fixture has no connection string — it did not initialize.");
            }

            // GUID-derived name: no injection surface, and bracket-quoted regardless.
            var name = $"PulseGuardTest_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }
                .ConnectionString;

            await ExecuteNonQueryAsync(master, $"CREATE DATABASE [{name}];");

            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }
                .ConnectionString;

            return new EphemeralDatabase(master, name, connectionString);
        }

        /// <summary>Applies migrations up to (and including) <paramref name="targetMigration"/>.</summary>
        public async Task MigrateToAsync(string targetMigration)
        {
            await using var context = CreateContext();
            await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }

        /// <summary>
        /// Inserts one persona per handle via raw SQL — the entity model already carries the post-migration
        /// <c>nvarchar(256)</c>/unique-index configuration, so EF cannot be used to stage the pre-migration rows
        /// this test needs (it would generate the wrong shape, and the tracked model would disagree with the
        /// not-yet-migrated schema).
        /// </summary>
        public async Task InsertPersonasAsync(Guid exerciseId, string[] handles)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();

            foreach (var handle in handles)
            {
                await using var command = connection.CreateCommand();
                command.CommandText = """
                    INSERT INTO [Personas] ([Id], [ExerciseId], [DisplayName], [Handle], [Kind], [Verified])
                    VALUES (@id, @exerciseId, @handle, @handle, N'human', 0);
                    """;
                command.Parameters.AddWithValue("@id", Guid.NewGuid());
                command.Parameters.AddWithValue("@exerciseId", exerciseId);
                command.Parameters.AddWithValue("@handle", handle);
                await command.ExecuteNonQueryAsync();
            }
        }

        public async Task<int> CountPersonasAsync() =>
            Convert.ToInt32(await ExecuteScalarAsync("SELECT COUNT(*) FROM [Personas];"));

        public async Task<bool> IndexExistsAsync() =>
            Convert.ToInt32(await ExecuteScalarAsync(
                "SELECT COUNT(*) FROM sys.indexes WHERE name = 'IX_Personas_ExerciseId_Handle' " +
                "AND object_id = OBJECT_ID('Personas');")) > 0;

        public async ValueTask DisposeAsync()
        {
            try
            {
                SqlConnection.ClearAllPools();
                await ExecuteNonQueryAsync(
                    _masterConnectionString,
                    $"IF DB_ID('{_name}') IS NOT NULL " +
                    $"BEGIN ALTER DATABASE [{_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; " +
                    $"DROP DATABASE [{_name}]; END");
            }
            catch (SqlException)
            {
                // Same posture as MsSqlContainerFixture: an orphaned, uniquely-named throwaway database is
                // preferable to failing the run on teardown.
            }
        }

        private PulseDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);

        private async Task<object?> ExecuteScalarAsync(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            return await command.ExecuteScalarAsync();
        }

        private static async Task ExecuteNonQueryAsync(string connectionString, string sql)
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }
}
