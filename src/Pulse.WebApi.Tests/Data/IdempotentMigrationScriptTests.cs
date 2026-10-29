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

    /// <summary>The last migration before demo-feedback/01 — the shape UAT holds when the 10/20 feedback cut deploys.</summary>
    private const string BeforeDemoFeedback = "20261013144332_EasyLoginSchema";

    /// <summary>The last migration before demo-feedback/17 (Wave 4) — the shape UAT holds when the Wave 4 cut deploys.</summary>
    private const string BeforeWave4 = "20261014202342_DemoFeedbackPinsNoiseImport";

    /// <summary>The last migration before identity-auth-roles/16 (A1) — the shape UAT holds when the A1 cut deploys.</summary>
    private const string BeforeAdminIdentity = "20261017011709_DemoFeedbackNamedLookalikePairs";

    /// <summary>The last migration before channels-foundation/01 (M1) — the shape UAT holds when the December channels cut deploys.</summary>
    private const string BeforeChannelsM1 = "20261017120000_AdminIdentityFoundation";

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

    [RequiresDockerFact]
    public async Task TheDeployScript_BringsUpDemoFeedback_OverLegacyRows_AndReplaysAsANoOp()
    {
        // demo-feedback/01 (lesson #413): the UAT shape on deploy day — an exercise, a post and a run-sheet item written
        // before the pin / import-key / noise schema existed — taken forward by the SCRIPT, batch by batch.
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(BeforeDemoFeedback);

        var exerciseId = await database.InsertTenantExerciseAsync();
        var postId = await database.InsertLegacyPostAsync();
        var injectItemId = await database.InsertLegacyInjectItemAsync(exerciseId);
        var script = database.GenerateIdempotentScript();

        // Both filtered indexes name a column this same migration adds, so each must reach the batch inside EXEC(N'…')
        // — compiled only when it runs, after the ALTER that creates the column (#413).
        script.Should().Contain("EXEC(N'CREATE INDEX [IX_Posts_ExerciseId_PinnedForAllAt]")
            .And.Contain("EXEC(N'CREATE UNIQUE INDEX [IX_InjectItems_ExerciseId_ExternalRef]");

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(),
            "the demo-feedback batch must compile and run in the script, not just under Migrate()");
        await AssertDemoFeedbackSchemaOverLegacyRowsAsync(database, exerciseId, postId, injectItemId);

        // The deploy re-applies the same script on every merge: a second apply must be a no-op.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        await AssertDemoFeedbackSchemaOverLegacyRowsAsync(database, exerciseId, postId, injectItemId);
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_BringsUpWave4_OverExistingPostsAndExercises_AndReplaysAsANoOp()
    {
        // demo-feedback/17 (lesson #413): the UAT shape on Wave 4 deploy day — an exercise and a post written before the
        // runtime-state / edit-tracking schema existed — taken forward by the SCRIPT, batch by batch, as sqlcmd -b runs it.
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(BeforeWave4);

        var exerciseId = await database.InsertTenantExerciseAsync();
        var postId = await database.InsertLegacyPostAsync();
        var script = database.GenerateIdempotentScript();

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(),
            "the Wave 4 batch must compile and run in the script, not just under Migrate()");
        await AssertWave4SchemaOverLegacyRowsAsync(database, exerciseId, postId);

        // The deploy re-applies the same script on every merge: a second apply must be a no-op.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        await AssertWave4SchemaOverLegacyRowsAsync(database, exerciseId, postId);
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_BringsUpAdminIdentity_OverLegacyRows()
    {
        // identity-auth-roles/16 (M-4, lesson #413): the UAT shape on A1 deploy day — staff users and assignments
        // (one orgAdmin), participant and pio accounts, live sessions of every kind, a post and lifecycle telemetry —
        // taken forward by the SCRIPT, batch by batch, as sqlcmd -b runs it. AdminIdentityFoundation's hand-written
        // backfills name columns its own ALTERs add, so this is the shape that only fails in the script.
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(BeforeAdminIdentity);

        var seed = await LegacyIdentityRows.SeedAsync(database);
        var script = database.GenerateIdempotentScript();

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(),
            "the AdminIdentityFoundation batch must compile and run in the script, not just under Migrate()");
        await AssertAdminIdentityOverLegacyRowsAsync(database, seed);

        // The deploy re-applies the same script on every merge: a second apply must be a no-op.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        await AssertAdminIdentityOverLegacyRowsAsync(database, seed);
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_BringsUpChannelsM1_OverAnExistingInjectItem_AndReplaysAsANoOp()
    {
        // channels-foundation/01 (lesson #413): the UAT shape on M1 deploy day — a run-sheet item written before
        // InjectItems.ContentItemId existed — taken forward by the SCRIPT, batch by batch, as sqlcmd -b runs it. The
        // index and the composite foreign key over that column name it in the same migration that adds it.
        await using var database = await ScriptDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(BeforeChannelsM1);

        var exerciseId = await database.InsertTenantExerciseAsync();
        var injectItemId = await database.InsertLegacyInjectItemAsync(exerciseId);
        var script = database.GenerateIdempotentScript();

        // M1's filtered indexes reach the batch inside EXEC(N'…') (#413).
        script.Should().Contain("EXEC(N'CREATE UNIQUE INDEX [IX_ContentItems_ExerciseId_ExternalSource_ExternalRef]")
            .And.Contain("EXEC(N'CREATE INDEX [IX_ContentItems_ExerciseId_ScheduledScenarioTime]");

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(),
            "the Channels_M1 batch must compile and run in the script, not just under Migrate()");
        await AssertChannelsM1OverLegacyRowsAsync(database, injectItemId);

        // The deploy re-applies the same script on every merge: a second apply must be a no-op.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        await AssertChannelsM1OverLegacyRowsAsync(database, injectItemId);
    }

    private static async Task AssertChannelsM1OverLegacyRowsAsync(ScriptDatabase database, Guid injectItemId)
    {
        foreach (var table in new[]
                 {
                     "Outlets", "ContentItems", "ContentItemRevisions", "ContentItemMedia", "ChannelAlerts",
                     "PortalConfigs", "PortalResources", "WeatherZones",
                 })
        {
            (await database.TableExistsAsync(table)).Should().BeTrue("M1 creates {0}", table);
        }

        (await database.TableExistsAsync("PortalDisplays")).Should().BeFalse("PortalDisplay is Deferred (Q-35) and never created");
        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [InjectItems] WHERE [Id] = '{injectItemId}' AND [ContentItemId] IS NULL"))
            .Should().Be(1, "an existing inject survives untouched with no content reference");
    }

    private static async Task AssertAdminIdentityOverLegacyRowsAsync(ScriptDatabase database, LegacyIdentityRows seed)
    {
        async Task<int> Count(string sql) => await database.ScalarAsync<int>(sql);

        (await Count($"SELECT COUNT(*) FROM [People] WHERE [Id] IN ('{seed.Controller}', '{seed.Admin}') AND [Email] IS NULL"))
            .Should().Be(2, "one person per staff user, SAME id, no email until invited");
        (await Count($"SELECT COUNT(*) FROM [People] WHERE [Id] = '{seed.Admin}' AND [OrgRole] = 'orgAdmin'"))
            .Should().Be(1, "the orgAdmin assignment moves the org-admin grant onto the person");
        (await Count($"SELECT COUNT(*) FROM [People] WHERE [Id] = '{seed.Controller}' AND [OrgRole] IS NULL")).Should().Be(1);

        (await Count($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] = '{seed.ControllerAssignment}' AND [PersonId] = '{seed.Controller}' AND [Role] = 'controller' AND [IsLead] = 1"))
            .Should().Be(1, "the controller assignment becomes the SAME-id enrollment, and the exercise's only controller leads");
        (await Count($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] = '{seed.AdminAssignment}' AND [PersonId] = '{seed.Admin}' AND [Role] = 'planner' AND [IsLead] = 0"))
            .Should().Be(1, "an orgAdmin assignment becomes a planner enrollment");
        (await Count("SELECT COUNT(*) FROM sys.tables WHERE [name] = 'StaffAssignments'")).Should().Be(0);

        (await Count($"""
            SELECT COUNT(*) FROM [Accounts] a JOIN [Enrollments] e ON e.[Id] = a.[EnrollmentId]
            WHERE a.[Id] = '{seed.ParticipantAccount}' AND e.[Id] = a.[Id] AND e.[Role] = 'participant'
              AND e.[PersonaId] = '{seed.PersonaId}' AND e.[ExerciseId] = '{seed.Exercise}' AND e.[PersonId] IS NULL
            """)).Should().Be(1, "the participant account's role and persona move to its same-id enrollment");
        (await Count($"""
            SELECT COUNT(*) FROM [Accounts] a JOIN [Enrollments] e ON e.[Id] = a.[EnrollmentId]
            WHERE a.[Id] = '{seed.PioAccount}' AND e.[Role] = 'pio' AND e.[PersonaId] IS NULL
            """)).Should().Be(1, "the pio account's role moves to its enrollment");
        (await Count("SELECT COUNT(*) FROM sys.columns WHERE [object_id] = OBJECT_ID('Accounts') AND [name] IN ('Role', 'PersonaId')"))
            .Should().Be(0, "the old homes are dropped once the data has moved");

        (await Count($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{seed.ControllerSession}' AND [PersonId] = '{seed.Controller}' AND [RevokedAt] IS NULL"))
            .Should().Be(1, "an ordinary staff session survives, its person backfilled from the staff user");
        (await Count($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{seed.AdminSession}' AND [PersonId] = '{seed.Admin}' AND [RevokedAt] IS NOT NULL"))
            .Should().Be(1, "a live exercise-scoped orgAdmin session is revoked");
        (await Count($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{seed.ParticipantSession}' AND [RevokedAt] IS NULL"))
            .Should().Be(1, "a participant session survives");
        (await Count("""
            SELECT COUNT(*) FROM sys.check_constraints
            WHERE [name] = 'CK_Sessions_ExerciseId_OrgAdminOnly' AND [parent_object_id] = OBJECT_ID('Sessions') AND [is_not_trusted] = 0
            """)).Should().Be(1, "the session-scope CHECK is created, and validated against the legacy rows, by the script");

        (await Count($"SELECT COUNT(*) FROM [Exercises] WHERE [Id] = '{seed.Exercise}' AND [FirstLiveAt] = '{seed.WentLiveAt:O}'"))
            .Should().Be(1, "FirstLiveAt is backfilled from the first transition to live");
        (await Count("SELECT COUNT(*) FROM [Organizations] WHERE [Slug] IS NULL OR [Slug] = N''"))
            .Should().Be(0, "every organization gets a slug");
        (await Count($"SELECT COUNT(*) FROM [Posts] WHERE [Id] = '{seed.Post}' AND [ExerciseId] = '{seed.Exercise}'"))
            .Should().Be(1, "an existing post survives untouched");
        (await Count($"SELECT COUNT(*) FROM [TelemetryEvents] WHERE [ExerciseId] = '{seed.Exercise}'"))
            .Should().Be(1, "existing telemetry survives untouched");
    }

    /// <summary>The legacy (pre-A1) rows seeded for the A1 deploy-script test, by raw SQL in the pre-A1 schema.</summary>
    private sealed record LegacyIdentityRows(
        Guid Exercise,
        Guid Controller,
        Guid Admin,
        Guid ControllerAssignment,
        Guid AdminAssignment,
        Guid PersonaId,
        Guid ParticipantAccount,
        Guid PioAccount,
        Guid ControllerSession,
        Guid AdminSession,
        Guid ParticipantSession,
        Guid Post,
        DateTimeOffset WentLiveAt)
    {
        public static async Task<LegacyIdentityRows> SeedAsync(ScriptDatabase database)
        {
            var org = Organization.DefaultOrganizationId;
            var exercise = await database.InsertTenantExerciseAsync();
            var controller = Guid.NewGuid();
            var admin = Guid.NewGuid();
            var controllerAssignment = Guid.NewGuid();
            var adminAssignment = Guid.NewGuid();
            var personaId = Guid.NewGuid();
            var participantAccount = Guid.NewGuid();
            var pioAccount = Guid.NewGuid();
            var controllerSession = Guid.NewGuid();
            var adminSession = Guid.NewGuid();
            var participantSession = Guid.NewGuid();
            var post = Guid.NewGuid();
            var wentLiveAt = new DateTimeOffset(2026, 10, 1, 13, 0, 0, TimeSpan.Zero);
            const string wentLivePayload = "{\"from\":\"staged\",\"to\":\"live\"}";

            await database.ExecuteAsync($"""
                INSERT INTO [StaffUsers] ([Id], [OrganizationId], [ExternalSubject], [DisplayName], [CreatedAt]) VALUES
                    ('{controller}', '{org}', N'idp|{controller:N}', N'Legacy Controller', SYSDATETIMEOFFSET()),
                    ('{admin}', '{org}', N'idp|{admin:N}', N'Legacy Admin', SYSDATETIMEOFFSET());
                INSERT INTO [StaffAssignments] ([Id], [StaffUserId], [ExerciseId], [Role], [CreatedAt]) VALUES
                    ('{controllerAssignment}', '{controller}', '{exercise}', N'controller', SYSDATETIMEOFFSET()),
                    ('{adminAssignment}', '{admin}', '{exercise}', N'orgAdmin', SYSDATETIMEOFFSET());
                INSERT INTO [Accounts] ([Id], [ExerciseId], [Username], [DisplayName], [Role], [PersonaId], [CreatedAt], [FailedLoginCount]) VALUES
                    ('{participantAccount}', '{exercise}', N'user_{participantAccount:N}', N'Legacy Participant', N'participant', '{personaId}', SYSDATETIMEOFFSET(), 0),
                    ('{pioAccount}', '{exercise}', N'user_{pioAccount:N}', N'Legacy PIO', N'pio', NULL, SYSDATETIMEOFFSET(), 0);
                INSERT INTO [Sessions] ([Id], [TokenHash], [Kind], [ExerciseId], [PrincipalId], [StaffUserId], [AccountId], [PersonaId],
                                        [Role], [ActingHumanId], [IsReadOnly], [IssuedAt], [ExpiresAt], [RefreshExpiresAt]) VALUES
                    ('{controllerSession}', N'hash-{controllerSession:N}', N'staff', '{exercise}', N'{controller}', '{controller}', NULL, NULL,
                     N'controller', N'{controller}', 0, SYSDATETIMEOFFSET(), DATEADD(hour, 1, SYSDATETIMEOFFSET()), DATEADD(hour, 8, SYSDATETIMEOFFSET())),
                    ('{adminSession}', N'hash-{adminSession:N}', N'staff', '{exercise}', N'{admin}', '{admin}', NULL, NULL,
                     N'orgAdmin', N'{admin}', 0, SYSDATETIMEOFFSET(), DATEADD(hour, 1, SYSDATETIMEOFFSET()), DATEADD(hour, 8, SYSDATETIMEOFFSET())),
                    ('{participantSession}', N'hash-{participantSession:N}', N'participant', '{exercise}', N'{participantAccount}', NULL, '{participantAccount}', '{personaId}',
                     N'participant', N'{participantAccount}', 0, SYSDATETIMEOFFSET(), DATEADD(hour, 1, SYSDATETIMEOFFSET()), DATEADD(hour, 8, SYSDATETIMEOFFSET()));
                INSERT INTO [Posts] ([Id], [ExerciseId], [AuthorPersonaId], [Body], [CreatedScenarioTime], [Origin], [ActingHumanId], [CreatedWallClock])
                VALUES ('{post}', '{exercise}', '{personaId}', N'Legacy post', '2033-09-04T13:00:00+00:00', N'participant', N'human-legacy', SYSDATETIMEOFFSET());
                INSERT INTO [TelemetryEvents] ([EventId], [SchemaVersion], [ExerciseId], [EventType], [Channel], [Actor_Kind],
                                               [WallClockTime], [ScenarioTime], [TimeZone], [Payload], [EmittedAt])
                VALUES (N'{Guid.NewGuid()}', N'v0', '{exercise}', N'exercise.lifecycle.transitioned', N'system', N'system',
                        '{wentLiveAt:O}', '{wentLiveAt:O}', N'UTC', N'{wentLivePayload}', '{wentLiveAt:O}');
                """);

            return new LegacyIdentityRows(
                exercise, controller, admin, controllerAssignment, adminAssignment, personaId, participantAccount, pioAccount,
                controllerSession, adminSession, participantSession, post, wentLiveAt);
        }
    }

    private static async Task AssertWave4SchemaOverLegacyRowsAsync(ScriptDatabase database, Guid exerciseId, Guid postId)
    {
        (await database.TableExistsAsync("ExerciseRuntimeStates")).Should().BeTrue("the script must create [ExerciseRuntimeStates]");
        (await database.TableExistsAsync("PostEdits")).Should().BeTrue("the script must create [PostEdits]");

        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [Posts] WHERE [Id] = '{postId}' AND [Body] = N'Legacy post' " +
                "AND [EditCount] = 0 AND [LastEditedAt] IS NULL AND [LastEditedScenarioTime] IS NULL;"))
            .Should().Be(1, "an existing post survives untouched and reads EditCount = 0 through the column DEFAULT");
        (await database.ScalarAsync<int>($"SELECT COUNT(*) FROM [Exercises] WHERE [Id] = '{exerciseId}';"))
            .Should().Be(1, "an existing exercise survives untouched");
        (await database.ScalarAsync<int>($"SELECT COUNT(*) FROM [ExerciseRuntimeStates] WHERE [ExerciseId] = '{exerciseId}';"))
            .Should().Be(0, "the migration writes no runtime-state rows: an exercise with no row reads as running, unstarted");
    }

    private static async Task AssertDemoFeedbackSchemaOverLegacyRowsAsync(
        ScriptDatabase database, Guid exerciseId, Guid postId, Guid injectItemId)
    {
        (await database.TableExistsAsync("NoisePosts")).Should().BeTrue("the script must create [NoisePosts]");

        (await database.ScalarAsync<string>($"SELECT [NoiseLevel] FROM [Exercises] WHERE [Id] = '{exerciseId}';"))
            .Should().Be("off", "an existing exercise reads NoiseLevel = 'off' through the column DEFAULT");
        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [Posts] WHERE [Id] = '{postId}' AND [Body] = N'Legacy post' " +
                "AND [PinnedForAllAt] IS NULL AND [PinnedForAllByHumanId] IS NULL;"))
            .Should().Be(1, "an existing post survives untouched and is not pinned for everyone");
        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [InjectItems] WHERE [Id] = '{injectItemId}' AND [Title] = N'Legacy item' " +
                "AND [ExternalRef] IS NULL;"))
            .Should().Be(1, "an existing run-sheet item survives untouched with no MSEL reference");
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

        /// <summary>
        /// Inserts one exercise via raw SQL in the post-tenant-tier, pre-demo-feedback schema (no <c>NoiseLevel</c>).
        /// </summary>
        public async Task<Guid> InsertTenantExerciseAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [Exercises] ([Id], [OrganizationId], [Name], [TimeZone], [Status])
                VALUES ('{id}', '{Organization.DefaultOrganizationId}', N'Legacy Exercise {id:N}', N'UTC', N'live');
                """);
            return id;
        }

        /// <summary>Inserts one run-sheet item via raw SQL in the pre-demo-feedback schema (no <c>ExternalRef</c>).</summary>
        public async Task<Guid> InsertLegacyInjectItemAsync(Guid exerciseId)
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(ConnectionString, $"""
                INSERT INTO [InjectItems] ([Id], [ExerciseId], [Kind], [Title], [Order], [Status], [Version],
                                           [CreatedByHumanId], [CreatedAt], [UpdatedAt], [ShiftSeconds])
                VALUES ('{id}', '{exerciseId}', N'post', N'Legacy item', 1, N'pending', 1, '{Guid.NewGuid()}',
                        SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(), 0);
                """);
            return id;
        }

        /// <summary>Runs a non-query — raw SQL, independent of the entity model (used to seed legacy rows).</summary>
        public Task ExecuteAsync(string sql) => ExecuteNonQueryAsync(ConnectionString, sql);

        /// <summary>Runs a scalar query — raw SQL, independent of the entity model.</summary>
        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            var value = await command.ExecuteScalarAsync();
            return value is T typed
                ? typed
                : throw new InvalidOperationException($"Expected a {typeof(T).Name} from: {sql}");
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
