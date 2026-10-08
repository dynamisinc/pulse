namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Replays the DEPLOY's migration path — the idempotent script <c>deploy-backend.yml</c> generates with
/// <c>dotnet ef migrations script --idempotent</c> and applies with sqlcmd — batch by batch against a real
/// SQL Server. Every other migration test drives <c>IMigrator.MigrateAsync</c>, which runs each operation as
/// its own command and so cannot see a failure that only exists in the script's shape.
/// </summary>
/// <remarks>
/// <para>
/// <b>The failure this exists for (2026-08-03).</b> In the idempotent script each migration is ONE batch, and
/// SQL Server compiles a whole batch before running any of it. <c>OrganizationTenantBoundary</c>'s hand-written
/// backfill named <c>OrganizationId</c>, a column added by an <c>ALTER</c> earlier in that same batch, so the
/// batch failed to compile (<c>Msg 207</c>) and nothing in it ran. sqlcmd, called without <c>-b</c>, exited 0;
/// the deploy reported success; the app shipped against the old schema, and every exercise-scoped read in UAT
/// returned 500 while <c>/health</c> and <c>/health/ready</c> stayed green. Every migration test passed
/// throughout.
/// </para>
/// <para>
/// <b>Each batch runs the way <c>sqlcmd -b</c> runs it:</b> the script is split on <c>GO</c> lines and every
/// batch is sent as one command on one connection, so a compile error surfaces as a <see cref="SqlException"/>
/// and fails the test instead of scrolling past.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class IdempotentMigrationScriptTests
{
    /// <summary>The last migration before the Organization tier — the shape UAT held when the 2026-08-03 deploy ran.</summary>
    private const string BeforeTenantTier = "20260725184424_FollowGraph";

    /// <summary>The last migration before demo-polish B1 — the shape UAT holds when the demo backend deploys.</summary>
    private const string BeforeDemoPolish = "20260802124443_ExerciseCreatedAt";

    private readonly MsSqlContainerFixture _fixture;

    public IdempotentMigrationScriptTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_AppliesEveryMigrationToAnEmptyDatabase_AndReplaysAsANoOp()
    {
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        var script = database.GenerateIdempotentScript();

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(),
            "a batch that fails to compile applies nothing and records nothing, so a missing history row is "
            + "exactly how a script-only failure shows up");

        // The deploy re-applies the same script on every merge, and twice on a serverless cold start.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_BringsUpTheTenantTier_OverRowsThatPredateIt()
    {
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(BeforeTenantTier);

        // The UAT shape on 2026-08-03: rows written before the Organization tier existed.
        var exerciseId = await database.InsertLegacyExerciseAsync();
        var staffUserId = await database.InsertLegacyStaffUserAsync();

        await database.ApplyScriptAsync(database.GenerateIdempotentScript());

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        (await database.ReadOrganizationIdAsync("Exercises", exerciseId))
            .Should().Be(Organization.DefaultOrganizationId, "the backfill must run in the script, not just under Migrate()");
        (await database.ReadOrganizationIdAsync("StaffUsers", staffUserId))
            .Should().Be(Organization.DefaultOrganizationId);
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_BringsUpDemoPolish_OverLegacyPostsAndPersonas_AndReplaysAsANoOp()
    {
        // demo-polish B1 (lesson #413): the UAT shape on deploy day — Posts and Personas rows written before the
        // media/reply/reaction schema existed — taken forward by the SCRIPT, batch by batch, as sqlcmd -b runs it.
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(BeforeDemoPolish);

        var postId = await database.InsertLegacyPostAsync();
        var personaId = await database.InsertLegacyPersonaAsync();
        var script = database.GenerateIdempotentScript();

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(),
            "the demo-polish batch must compile and run in the script, not just under Migrate()");
        await AssertDemoPolishSchemaOverLegacyRowsAsync(database, postId, personaId);

        // The deploy re-applies the same script on every merge: a second apply must be a no-op.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        await AssertDemoPolishSchemaOverLegacyRowsAsync(database, postId, personaId);
    }

    private static async Task AssertDemoPolishSchemaOverLegacyRowsAsync(ScriptDatabase database, Guid postId, Guid personaId)
    {
        foreach (var table in new[] { "MediaAssets", "PostMediaItems", "PostReactions" })
        {
            (await database.TableExistsAsync(table)).Should().BeTrue("the script must create [{0}]", table);
        }

        var post = await database.ReadDemoPolishPostColumnsAsync(postId);
        post.Body.Should().Be("Legacy post", "the legacy post must survive the migration untouched");
        post.ParentPostId.Should().BeNull("a pre-existing post is a top-level post");
        post.BaselineLike.Should().Be(0, "the NOT NULL baselines backfill to their DEFAULT 0 on existing rows");
        post.BaselineRepost.Should().Be(0);
        post.BaselineReply.Should().Be(0);

        var persona = await database.ReadDemoPolishPersonaColumnsAsync(personaId);
        persona.DisplayName.Should().Be("Legacy Persona", "the legacy persona must survive the migration untouched");
        persona.AvatarMediaId.Should().BeNull("an existing persona has no avatar until one is set");
        persona.BannerMediaId.Should().BeNull();
        persona.Location.Should().BeNull();
    }

    /// <summary>
    /// A throwaway database on whichever real SQL Server the shared fixture resolved (Testcontainers in CI,
    /// <c>PULSE_TEST_SQL_CONNECTION</c> locally).
    /// </summary>
    private sealed class ScriptDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _name;

        private ScriptDatabase(string masterConnectionString, string name, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _name = name;
            ConnectionString = connectionString;
        }

        private string ConnectionString { get; }

        public static async Task<ScriptDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            if (fixture.ConnectionString is null)
            {
                throw new InvalidOperationException(
                    "The shared MSSQL fixture has no connection string — it did not initialize.");
            }

            // GUID-derived name: no injection surface, and bracket-quoted regardless.
            var name = $"PulseScriptTest_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }
                .ConnectionString;

            await ExecuteNonQueryAsync(master, $"CREATE DATABASE [{name}];");

            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }
                .ConnectionString;

            return new ScriptDatabase(master, name, connectionString);
        }

        /// <summary>The same script the deploy generates: every migration, idempotent.</summary>
        public string GenerateIdempotentScript()
        {
            using var context = NewContext();
            return context.Database.GetService<IMigrator>()
                .GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        }

        /// <summary>Every migration in the assembly, by id.</summary>
        public IReadOnlyList<string> AllMigrations()
        {
            using var context = NewContext();
            return context.Database.GetMigrations().ToList();
        }

        /// <summary>Applies (or rolls back to) the given migration through EF — used only to reach a starting point.</summary>
        public async Task MigrateToAsync(string targetMigration)
        {
            await using var context = NewContext();
            await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }

        /// <summary>
        /// Runs <paramref name="script"/> as sqlcmd does: split on <c>GO</c>, each batch one command, one
        /// session throughout. Any error — including a compile error — throws.
        /// </summary>
        public async Task ApplyScriptAsync(string script)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();

            foreach (var batch in SplitOnGo(script))
            {
                await using var command = connection.CreateCommand();
                command.CommandText = batch;
                command.CommandTimeout = 120;
                await command.ExecuteNonQueryAsync();
            }
        }

        /// <summary>The ids recorded in <c>__EFMigrationsHistory</c>.</summary>
        public async Task<IReadOnlyList<string>> AppliedMigrationsAsync()
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT [MigrationId] FROM [__EFMigrationsHistory];";

            var applied = new List<string>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                applied.Add(reader.GetString(0));
            }

            return applied;
        }

        /// <summary>
        /// Inserts one exercise via RAW SQL in the pre-tenant-tier schema, which has no <c>OrganizationId</c>
        /// column at all — the current entity model could not write it.
        /// </summary>
        public async Task<Guid> InsertLegacyExerciseAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [Exercises] ([Id], [Name], [TimeZone], [Status], [ComplianceChromeEnabled],
                                         [WatermarkEnabled], [IsPracticeMode])
                VALUES ('{id}', N'Legacy Exercise {id:N}', N'UTC', N'live', 1, 1, 0);
                """);
            return id;
        }

        /// <summary>Inserts one staff user via raw SQL, for the same reason.</summary>
        public async Task<Guid> InsertLegacyStaffUserAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [StaffUsers] ([Id], [ExternalSubject], [DisplayName], [CreatedAt])
                VALUES ('{id}', N'idp|{id:N}', N'Legacy Staffer', SYSDATETIMEOFFSET());
                """);
            return id;
        }

        /// <summary>Reads one row's tenant — raw SQL, so it is independent of the entity model.</summary>
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

        /// <summary>Inserts one post via raw SQL in the pre-demo-polish schema (no reply/baseline columns).</summary>
        public async Task<Guid> InsertLegacyPostAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [Posts] ([Id], [ExerciseId], [AuthorPersonaId], [Body], [CreatedScenarioTime], [Origin],
                                     [ActingHumanId], [CreatedWallClock])
                VALUES ('{id}', '{Guid.NewGuid()}', '{Guid.NewGuid()}', N'Legacy post', '2033-09-04T13:00:00+00:00',
                        N'participant', N'human-legacy', SYSDATETIMEOFFSET());
                """);
            return id;
        }

        /// <summary>Inserts one persona via raw SQL in the pre-demo-polish schema (no avatar/banner/location).</summary>
        public async Task<Guid> InsertLegacyPersonaAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [Personas] ([Id], [ExerciseId], [DisplayName], [Handle], [Kind], [Verified])
                VALUES ('{id}', '{Guid.NewGuid()}', N'Legacy Persona', N'legacy_{id:N}', N'human', 0);
                """);
            return id;
        }

        /// <summary>Whether a user table exists.</summary>
        public async Task<bool> TableExistsAsync(string table)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT OBJECT_ID(@table, N'U');";
            command.Parameters.AddWithValue("@table", $"[{table}]");
            return await command.ExecuteScalarAsync() is int;
        }

        /// <summary>Reads one post's demo-polish columns — raw SQL, independent of the entity model.</summary>
        public async Task<(string Body, Guid? ParentPostId, int BaselineLike, int BaselineRepost, int BaselineReply)>
            ReadDemoPolishPostColumnsAsync(Guid id)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT [Body], [ParentPostId], [BaselineLikeCount], [BaselineRepostCount], [BaselineReplyCount] " +
                "FROM [Posts] WHERE [Id] = @id;";
            command.Parameters.AddWithValue("@id", id);

            await using var reader = await command.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                throw new InvalidOperationException($"No [Posts] row for {id} — the legacy row did not survive.");
            }

            return (
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.GetInt32(2),
                reader.GetInt32(3),
                reader.GetInt32(4));
        }

        /// <summary>Reads one persona's demo-polish columns — raw SQL, independent of the entity model.</summary>
        public async Task<(string DisplayName, Guid? AvatarMediaId, Guid? BannerMediaId, string? Location)>
            ReadDemoPolishPersonaColumnsAsync(Guid id)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT [DisplayName], [AvatarMediaId], [BannerMediaId], [Location] FROM [Personas] WHERE [Id] = @id;";
            command.Parameters.AddWithValue("@id", id);

            await using var reader = await command.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                throw new InvalidOperationException($"No [Personas] row for {id} — the legacy row did not survive.");
            }

            return (
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.IsDBNull(2) ? null : reader.GetGuid(2),
                reader.IsDBNull(3) ? null : reader.GetString(3));
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

        private PulseDbContext NewContext() =>
            new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);

        /// <summary>Splits a script into batches on lines that are exactly <c>GO</c>, as sqlcmd does.</summary>
        private static IEnumerable<string> SplitOnGo(string script)
        {
            var batch = new StringBuilder();
            foreach (var line in script.Split('\n'))
            {
                if (line.Trim().Equals("GO", StringComparison.OrdinalIgnoreCase))
                {
                    if (batch.ToString().Trim().Length > 0)
                    {
                        yield return batch.ToString();
                    }

                    batch.Clear();
                    continue;
                }

                batch.Append(line).Append('\n');
            }

            if (batch.ToString().Trim().Length > 0)
            {
                yield return batch.ToString();
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
