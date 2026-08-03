namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;

/// <summary>
/// Story <c>exercise-configuration/01a</c>: proves the feature's one migration's hand-written DATA migration
/// on a database that already holds rows — the live-UAT-shaped case. Three things it must get right:
/// <list type="number">
/// <item><b>Up</b> maps every legacy status literal onto its COR-032 replacement
/// (<c>scheduled</c> → <c>build</c>, <c>active</c> → <c>live</c>, <c>complete</c> → <c>completed</c>,
/// <c>archived</c> unchanged) — the mapping table in <c>implementation.md</c>, verbatim;</item>
/// <item><b>Up</b> backfills the new non-nullable switches on pre-existing rows with their safe defaults
/// (chrome ON + watermark ON — NFR-008's "never both off" holds by construction — and practice OFF), and
/// leaves every new settings column NULL so story 01b's projection keeps serving the shipped constants;</item>
/// <item><b>Down</b> puts every row back INSIDE the legacy four. A rollback that stranded a row on a COR-032
/// literal would present an unknown status to a rolled-back, un-widened client whose <c>isExerciseStatus</c>
/// guard fails closed — a blank participant world, not a type error.</item>
/// </list>
/// </summary>
/// <remarks>
/// <para>
/// <b>Why its own database.</b> These tests migrate FROM the previous migration, so they cannot use the shared
/// <see cref="MsSqlContainerFixture"/> database (already fully migrated, and shared with the whole collection).
/// Each test provisions and drops a throwaway database on whichever real SQL Server the fixture resolved
/// (Testcontainers in CI, <c>PULSE_TEST_SQL_CONNECTION</c> locally) — the same approach, and for the same
/// reason, as the sibling <see cref="PersonaHandleUniqueIndexMigrationGuardTests"/>, whose helper is private to
/// that class.
/// </para>
/// <para>
/// Without these, the data migration would be hand-written SQL that CI never executes: it would first run
/// during a real deployment, against real rows.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class ExerciseConfigurationMigrationTests
{
    /// <summary>The migration immediately before the one under test — the "before" state to seed legacy rows into.</summary>
    private const string PreviousMigration = "20260725120413_PersonaHandleUniqueIndex";

    /// <summary>The migration under test — the exercise-configuration feature's one and only migration.</summary>
    private const string MigrationUnderTest = "20260725174714_ExerciseConfiguration";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseConfigurationMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Up_MapsEveryLegacyStatusOntoItsCor032Replacement()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var scheduled = await database.InsertExerciseAsync("scheduled");
        var active = await database.InsertExerciseAsync("active");
        var complete = await database.InsertExerciseAsync("complete");
        var archived = await database.InsertExerciseAsync("archived");

        await database.MigrateToAsync(MigrationUnderTest);

        var statuses = await database.ReadStatusesAsync();

        statuses[scheduled].Should().Be(
            "build", "an exercise created and never configured is still in staff-only content development");
        statuses[active].Should().Be(
            "live", "the bootstrap seed marks a running exercise — StartEx has effectively occurred");
        statuses[complete].Should().Be(
            "completed", "COR-032 names the state 'Completed (EndEx)' — the legacy spelling was 'complete'");
        statuses[archived].Should().Be(
            "archived", "archived is spelled identically in both vocabularies, so the row is untouched");
    }

    [RequiresDockerFact]
    public async Task Up_LeavesRowsAlreadyOnTheCor032Vocabulary_Untouched()
    {
        // Re-running the data migration (or migrating a database somebody already hand-corrected) must be a
        // no-op: no legacy literal survives the first pass, and none of the six new literals is also a legacy
        // one, so nothing can be double-mapped.
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var staged = await database.InsertExerciseAsync("staged");
        var paused = await database.InsertExerciseAsync("paused");
        var completed = await database.InsertExerciseAsync("completed");

        await database.MigrateToAsync(MigrationUnderTest);

        var statuses = await database.ReadStatusesAsync();

        statuses[staged].Should().Be("staged");
        statuses[paused].Should().Be("paused");
        statuses[completed].Should().Be("completed", "'completed' must not be re-mapped by the 'complete' rule");
    }

    [RequiresDockerFact]
    public async Task Up_BackfillsPreExistingRows_WithSafeSwitchDefaults_AndNullSettings()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var id = await database.InsertExerciseAsync("active");

        await database.MigrateToAsync(MigrationUnderTest);

        // Read via RAW SQL, not EF. The database is deliberately parked at this migration, whose schema
        // predates later columns (exercise-isolation/11's Exercises.OrganizationId among them) that the
        // CURRENT entity model maps — so an EF materialization would fail on a missing column and mask what
        // this test is actually about. Same reason InsertExerciseAsync/ReadStatusesAsync are raw.
        var reloaded = await database.ReadConfigurationColumnsAsync(id);

        reloaded.ComplianceChromeEnabled.Should().BeTrue(
            "the migration must add the chrome switch ON, matching the shipped constant — a pre-existing " +
            "exercise's participant world must not lose its compliance banners when this migration lands");
        reloaded.WatermarkEnabled.Should().BeTrue(
            "chrome and watermark are never both off (NFR-008), so the backfill defaults both ON");
        reloaded.IsPracticeMode.Should().BeFalse(
            "an exercise that has never been flagged is real conduct, not a rehearsal (COR-033)");

        reloaded.WorldName.Should().BeNull("an unconfigured setting stays NULL — the projection falls back to the constant");
        reloaded.EnabledChannels.Should().BeNull();
        reloaded.BrandName.Should().BeNull();
        reloaded.ChromeTopText.Should().BeNull();
        reloaded.ScheduledStartAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Down_ReturnsEveryRowToTheLegacyVocabulary()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(MigrationUnderTest);

        var build = await database.InsertExerciseAsync("build");
        var staged = await database.InsertExerciseAsync("staged");
        var live = await database.InsertExerciseAsync("live");
        var paused = await database.InsertExerciseAsync("paused");
        var completed = await database.InsertExerciseAsync("completed");
        var archived = await database.InsertExerciseAsync("archived");

        await database.MigrateToAsync(PreviousMigration);

        var statuses = await database.ReadStatusesAsync();

        // Deliberately lossy — the legacy vocabulary has no Staged and no Paused. What must hold is that
        // NOTHING is left on a COR-032-only literal for a rolled-back client to choke on.
        statuses[build].Should().Be("scheduled");
        statuses[staged].Should().Be("scheduled", "the legacy vocabulary has no Staged — it collapses onto its nearest neighbour");
        statuses[live].Should().Be("active");
        statuses[paused].Should().Be("active", "the legacy vocabulary has no Paused — a paused exercise is still a running one");
        statuses[completed].Should().Be("complete");
        statuses[archived].Should().Be("archived");

        statuses.Values.Should().OnlyContain(
            s => s == "scheduled" || s == "active" || s == "complete" || s == "archived",
            "after a rollback every row must be inside the legacy four — an un-widened client's isExerciseStatus " +
            "guard fails closed on anything else and blanks the participant world");
    }

    /// <summary>The story-01a columns read back raw from a database parked at that migration.</summary>
    /// <param name="ComplianceChromeEnabled">The COR-031 chrome switch.</param>
    /// <param name="WatermarkEnabled">The NFR-008 watermark switch.</param>
    /// <param name="IsPracticeMode">The COR-033 practice flag.</param>
    /// <param name="WorldName">The COR-030 world name (null = unconfigured).</param>
    /// <param name="EnabledChannels">The COR-030 channel list (null = unconfigured).</param>
    /// <param name="BrandName">The COR-030 brand name (null = unconfigured).</param>
    /// <param name="ChromeTopText">The COR-031 top banner text (null = unconfigured).</param>
    /// <param name="ScheduledStartAt">The COR-030 schedule start (null = unscheduled).</param>
    public sealed record ConfigurationColumns(
        bool ComplianceChromeEnabled,
        bool WatermarkEnabled,
        bool IsPracticeMode,
        string? WorldName,
        string? EnabledChannels,
        string? BrandName,
        string? ChromeTopText,
        DateTimeOffset? ScheduledStartAt);

    /// <summary>
    /// A throwaway database on the same real SQL Server the shared fixture resolved, created per test and
    /// dropped on disposal — so a partial-migration test can never leave the collection's shared database
    /// behind. Deliberately a local copy of the sibling guard-test's helper (which is private to that class)
    /// rather than a refactor of another story's test file.
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
            var name = $"PulseCfgTest_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }
                .ConnectionString;

            await ExecuteNonQueryAsync(master, $"CREATE DATABASE [{name}];");

            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }
                .ConnectionString;

            return new EphemeralDatabase(master, name, connectionString);
        }

        /// <summary>Applies (or rolls back to) the given migration.</summary>
        public async Task MigrateToAsync(string targetMigration)
        {
            await using var context = CreateContext();
            await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }

        /// <summary>
        /// Inserts one exercise with the given raw status via raw SQL. Raw, not EF: these rows must exist in
        /// the PRE-migration schema, which has none of the columns the current entity model maps.
        /// </summary>
        public async Task<Guid> InsertExerciseAsync(string status)
        {
            var id = Guid.NewGuid();

            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO [Exercises] ([Id], [Name], [TimeZone], [Status])
                VALUES (@id, @name, N'UTC', @status);
                """;
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@name", $"Exercise {id:N}");
            command.Parameters.AddWithValue("@status", status);
            await command.ExecuteNonQueryAsync();

            return id;
        }

        /// <summary>
        /// Reads the columns story 01a's migration is responsible for, for one exercise — raw SQL, so it is
        /// independent of every schema version that came AFTER the migration under test.
        /// </summary>
        /// <param name="id">The exercise id.</param>
        /// <returns>The backfilled switch + settings values.</returns>
        public async Task<ConfigurationColumns> ReadConfigurationColumnsAsync(Guid id)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT [ComplianceChromeEnabled], [WatermarkEnabled], [IsPracticeMode],
                       [WorldName], [EnabledChannels], [BrandName], [ChromeTopText], [ScheduledStartAt]
                FROM [Exercises] WHERE [Id] = @id;
                """;
            command.Parameters.AddWithValue("@id", id);

            await using var reader = await command.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                throw new InvalidOperationException($"No Exercises row for {id}.");
            }

            return new ConfigurationColumns(
                reader.GetBoolean(0),
                reader.GetBoolean(1),
                reader.GetBoolean(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetDateTimeOffset(7));
        }

        /// <summary>Reads every exercise's stored status, keyed by id — raw SQL, schema-version independent.</summary>
        public async Task<IReadOnlyDictionary<Guid, string>> ReadStatusesAsync()
        {
            var statuses = new Dictionary<Guid, string>();

            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT [Id], [Status] FROM [Exercises];";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                statuses[reader.GetGuid(0)] = reader.GetString(1);
            }

            return statuses;
        }

        public PulseDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);

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
