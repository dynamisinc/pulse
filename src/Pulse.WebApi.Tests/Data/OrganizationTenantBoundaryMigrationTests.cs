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
/// exercise-isolation/11 (Tier-2) — proves the <c>OrganizationTenantBoundary</c> migration's HAND-WRITTEN
/// data migration against a database that already holds rows, which is the only shape that matters: UAT and
/// production both have data, and the columns it adds are NON-NULLABLE.
/// </summary>
/// <remarks>
/// <para>
/// <b>What could go wrong, and is therefore tested.</b> The scaffolded shape
/// (<c>AddColumn(nullable: false, defaultValue: Guid.Empty)</c>) would have homed every existing exercise,
/// template and staff user on the <c>Guid.Empty</c> sentinel that both read filters treat as "no tenant" —
/// satisfying <c>NOT NULL</c> while making every pre-existing row permanently unreachable. That is a silent
/// total data loss dressed as a successful deploy. The migration instead adds each column nullable,
/// backfills, THROWs if anything is unhomed, and only then enforces <c>NOT NULL</c>. None of that runs in CI
/// unless a test drives it — otherwise its first execution ever would be against real customer rows.
/// </para>
/// <para>
/// <b>Its own throwaway database</b>, for the same reason as the sibling
/// <see cref="ExerciseConfigurationMigrationTests"/>: these tests migrate FROM the previous migration, so the
/// shared, already-fully-migrated <see cref="MsSqlContainerFixture"/> database cannot be used.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class OrganizationTenantBoundaryMigrationTests
{
    /// <summary>The migration immediately before the one under test — the "before" state to seed rows into.</summary>
    private const string PreviousMigration = "20260725184424_FollowGraph";

    /// <summary>The migration under test.</summary>
    private const string MigrationUnderTest = "20260801131212_OrganizationTenantBoundary";

    private readonly MsSqlContainerFixture _fixture;

    public OrganizationTenantBoundaryMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Up_BackfillsEveryPreExistingRowOntoTheDefaultOrganization()
    {
        await using var database = await EphemeralTenantDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        // Rows that exist BEFORE the tenant tier does — the UAT/production shape.
        var exerciseId = await database.InsertExerciseAsync();
        var templateId = await database.InsertPersonaTemplateAsync();
        var staffUserId = await database.InsertStaffUserAsync();

        await database.MigrateToAsync(MigrationUnderTest);

        (await database.ReadOrganizationIdAsync("Exercises", exerciseId)).Should().Be(
            Organization.DefaultOrganizationId,
            "a pre-existing exercise must land on the well-known default tenant — single-customer was the "
            + "documented operating assumption up to this migration, so one tenant is the only truthful "
            + "mapping there is");
        (await database.ReadOrganizationIdAsync("PersonaTemplates", templateId)).Should().Be(
            Organization.DefaultOrganizationId,
            "the shared library must stay reachable after the tenant filter turns on");
        (await database.ReadOrganizationIdAsync("StaffUsers", staffUserId)).Should().Be(
            Organization.DefaultOrganizationId,
            "a staff human left unhomed could reach no exercise at all once the org bound applies");
    }

    [RequiresDockerFact]
    public async Task Up_NeverLeavesARowOnTheEmptySentinel_WhichWouldBeUnreachableForever()
    {
        await using var database = await EphemeralTenantDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var exerciseId = await database.InsertExerciseAsync();

        await database.MigrateToAsync(MigrationUnderTest);

        (await database.ReadOrganizationIdAsync("Exercises", exerciseId)).Should().NotBe(
            Guid.Empty,
            "Guid.Empty is the fail-closed 'no tenant' sentinel that GuardOrganizationScope refuses and both "
            + "read paths treat as matching nothing. A backfill onto it would satisfy NOT NULL while making "
            + "the row invisible to every org-bounded surface — the exact silent-loss outcome the "
            + "hand-written migration exists to prevent");
    }

    [RequiresDockerFact]
    public async Task Up_SeedsExactlyOneDefaultOrganizationRow_WithTheIdTheEntityConstantNames()
    {
        await using var database = await EphemeralTenantDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);
        await database.MigrateToAsync(MigrationUnderTest);

        var count = await database.CountAsync(
            $"SELECT COUNT(*) FROM [Organizations] WHERE [Id] = '{Organization.DefaultOrganizationId}'");

        count.Should().Be(
            1, "the migration's literal default-organization GUID must still equal "
            + $"Organization.DefaultOrganizationId ({Organization.DefaultOrganizationId}). The migration "
            + "writes the value out as a literal on purpose — a migration describes the schema at a point in "
            + "time and must not drift if the constant is re-pointed — so this assertion is what keeps the "
            + "two in agreement, and BootstrapService's create-or-reuse idempotent");
    }

    [RequiresDockerFact]
    public async Task Up_LeavesNoDefaultConstraintOnTheTenantColumns_SoARawInsertCannotMintAnOrphan()
    {
        await using var database = await EphemeralTenantDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);
        await database.MigrateToAsync(MigrationUnderTest);

        foreach (var table in new[] { "Exercises", "PersonaTemplates", "StaffUsers" })
        {
            var defaults = await database.CountAsync($"""
                SELECT COUNT(*)
                FROM sys.default_constraints dc
                JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
                WHERE dc.parent_object_id = OBJECT_ID('{table}') AND c.name = 'OrganizationId'
                """);

            defaults.Should().Be(
                0, $"[{table}].OrganizationId must carry NO default constraint. The add-nullable/backfill/"
                + "alter-to-NOT-NULL sequence is chosen precisely so none is left behind: a residual DEFAULT "
                + "of the empty sentinel would let any future raw-SQL insert that omits the tenant silently "
                + "create an unreachable orphan");
        }
    }

    [RequiresDockerFact]
    public async Task Up_IsIdempotentAcrossADownAndReUp_MintingNoSecondDefaultTenant()
    {
        await using var database = await EphemeralTenantDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var exerciseId = await database.InsertExerciseAsync();

        await database.MigrateToAsync(MigrationUnderTest);
        await database.MigrateToAsync(PreviousMigration);   // Down: drops the columns AND the table.
        await database.MigrateToAsync(MigrationUnderTest);   // Up again.

        (await database.CountAsync("SELECT COUNT(*) FROM [Organizations]")).Should().Be(
            1, "the seed insert is IF NOT EXISTS-guarded on a FIXED id, so a replay resolves the same row "
            + "rather than minting a second 'Default Organization' — which the unique name index would "
            + "reject anyway, failing the deploy");
        (await database.ReadOrganizationIdAsync("Exercises", exerciseId)).Should().Be(
            Organization.DefaultOrganizationId,
            "and the row is re-homed correctly on the second pass");
    }

    [RequiresDockerFact]
    public async Task Down_RemovesTheTenantTierCleanly_SoTheMigrationIsReversible()
    {
        await using var database = await EphemeralTenantDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);
        await database.InsertExerciseAsync();

        await database.MigrateToAsync(MigrationUnderTest);
        await database.MigrateToAsync(PreviousMigration);

        (await database.CountAsync(
            "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Exercises') AND name = 'OrganizationId'"))
            .Should().Be(0, "Down must drop the tenant column it added");
        (await database.CountAsync(
            "SELECT COUNT(*) FROM sys.tables WHERE name = 'Organizations'"))
            .Should().Be(0, "and the tenant table, in the exact reverse order");
    }

    /// <summary>
    /// A throwaway database on whichever real SQL Server the shared fixture resolved (Testcontainers in CI,
    /// <c>PULSE_TEST_SQL_CONNECTION</c> locally), migrated by hand to a specific point in history.
    /// </summary>
    private sealed class EphemeralTenantDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _name;

        private EphemeralTenantDatabase(string masterConnectionString, string name, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _name = name;
            ConnectionString = connectionString;
        }

        private string ConnectionString { get; }

        public static async Task<EphemeralTenantDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            if (fixture.ConnectionString is null)
            {
                throw new InvalidOperationException(
                    "The shared MSSQL fixture has no connection string — it did not initialize.");
            }

            // GUID-derived name: no injection surface, and bracket-quoted regardless.
            var name = $"PulseOrgTest_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }
                .ConnectionString;

            await ExecuteNonQueryAsync(master, $"CREATE DATABASE [{name}];");

            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }
                .ConnectionString;

            return new EphemeralTenantDatabase(master, name, connectionString);
        }

        /// <summary>Applies (or rolls back to) the given migration.</summary>
        public async Task MigrateToAsync(string targetMigration)
        {
            await using var context = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);
            await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }

        /// <summary>
        /// Inserts one exercise via RAW SQL. Raw, not EF: the row must exist in the PRE-migration schema,
        /// which has no <c>OrganizationId</c> column at all — the current entity model could not write it.
        /// </summary>
        public async Task<Guid> InsertExerciseAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [Exercises] ([Id], [Name], [TimeZone], [Status], [ComplianceChromeEnabled],
                                         [WatermarkEnabled], [IsPracticeMode])
                VALUES ('{id}', N'Legacy Exercise {id:N}', N'UTC', N'live', 1, 1, 0);
                """);
            return id;
        }

        /// <summary>Inserts one persona template via raw SQL, for the same reason.</summary>
        public async Task<Guid> InsertPersonaTemplateAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [PersonaTemplates] ([Id], [DisplayName], [Handle])
                VALUES ('{id}', N'Legacy Template {id:N}', N'@t_{id:N}');
                """);
            return id;
        }

        /// <summary>Inserts one staff user via raw SQL, for the same reason.</summary>
        public async Task<Guid> InsertStaffUserAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [StaffUsers] ([Id], [ExternalSubject], [DisplayName], [CreatedAt])
                VALUES ('{id}', N'idp|{id:N}', N'Legacy Staffer', SYSDATETIMEOFFSET());
                """);
            return id;
        }

        /// <summary>Reads one row's backfilled tenant — raw SQL, so it is independent of the entity model.</summary>
        public async Task<Guid> ReadOrganizationIdAsync(string table, Guid id)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT [OrganizationId] FROM [{table}] WHERE [Id] = @id;";
            command.Parameters.AddWithValue("@id", id);

            var value = await command.ExecuteScalarAsync();
            return value is Guid organizationId
                ? organizationId
                : throw new InvalidOperationException($"No [{table}] row for {id}, or a NULL tenant.");
        }

        /// <summary>Runs a scalar COUNT query.</summary>
        public async Task<int> CountAsync(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            return Convert.ToInt32(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
        }

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
                // Leaving a uniquely-named throwaway database behind beats failing the run on teardown.
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
