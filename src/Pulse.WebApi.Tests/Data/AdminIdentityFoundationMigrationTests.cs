namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Data.SqlTypes;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// identity-auth-roles/16 (#572, Tier-2) — the <c>AdminIdentityFoundation</c> migration over a seeded legacy database:
/// backfill correctness (People per StaffUser with the same id, Enrollments from StaffAssignments with the same ids and
/// from Accounts, orgAdmin → planner + OrgRole, slugs, FirstLiveAt, the lead controller, Sessions.PersonId and the
/// revoked orgAdmin sessions), no orphan sentinels, and an idempotent Down→Up round trip.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class AdminIdentityFoundationMigrationTests
{
    private const string PreviousMigration = "20261015192237_DemoFeedbackWave4RuntimeAndEdits";
    private const string MigrationUnderTest = "20261016181208_AdminIdentityFoundation";

    private readonly MsSqlContainerFixture _fixture;

    public AdminIdentityFoundationMigrationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Up_BackfillsOnePersonPerStaffUser_WithTheSameId_AndKeepsEveryStaffForeignKeyValid()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        var staff = await db.InsertStaffUserAsync("Jane Controller");
        await db.InsertStaffSessionAsync(staff, exercise, "controller");

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [People] WHERE [Id] = '{staff}' AND [Email] IS NULL AND [DisplayName] = N'Jane Controller' AND [OrganizationId] = '{Organization.DefaultOrganizationId}'"))
            .Should().Be(1, "every staff user gets a person with the SAME id (legacy rows have no email until invited)");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.foreign_keys WHERE name = 'FK_StaffUsers_People_Id'"))
            .Should().Be(1, "the staff facet's id is a foreign key to the person");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [StaffUserId] = '{staff}' AND [PersonId] = '{staff}'"))
            .Should().Be(1, "a staff session's person is its staff user (shared key)");
    }

    [RequiresDockerFact]
    public async Task Up_MovesStaffAssignmentsToEnrollments_WithTheSameIds_AndMapsOrgAdminToPlannerPlusOrgRole()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        var controller = await db.InsertStaffUserAsync("Controller");
        var admin = await db.InsertStaffUserAsync("Admin");
        var controllerAssignment = await db.InsertAssignmentAsync(controller, exercise, "controller");
        var adminAssignment = await db.InsertAssignmentAsync(admin, exercise, "orgAdmin");
        var adminSession = await db.InsertStaffSessionAsync(admin, exercise, "orgAdmin");
        var controllerSession = await db.InsertStaffSessionAsync(controller, exercise, "controller");

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<string>($"SELECT [Role] FROM [Enrollments] WHERE [Id] = '{controllerAssignment}' AND [PersonId] = '{controller}'"))
            .Should().Be("controller", "a staff assignment becomes an enrollment with the SAME id");
        (await db.ScalarAsync<string>($"SELECT [Role] FROM [Enrollments] WHERE [Id] = '{adminAssignment}'"))
            .Should().Be("planner", "an orgAdmin assignment becomes a planner enrollment, keeping today's access");
        (await db.ScalarAsync<string>($"SELECT [OrgRole] FROM [People] WHERE [Id] = '{admin}'")).Should().Be("orgAdmin");
        (await db.ScalarAsync<string?>($"SELECT [OrgRole] FROM [People] WHERE [Id] = '{controller}'")).Should().BeNull();
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.tables WHERE name = 'StaffAssignments'")).Should().Be(0);
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{adminSession}' AND [RevokedAt] IS NOT NULL"))
            .Should().Be(1, "a live session minted from the retired orgAdmin exercise role is revoked");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{controllerSession}' AND [RevokedAt] IS NULL"))
            .Should().Be(1, "an ordinary staff session is untouched");
    }

    [RequiresDockerFact]
    public async Task Up_RevokesALiveOrgAdminSession_SoItsAccessAndRefreshTokensBoth401Afterwards()
    {
        // Copilot fold D: an exercise-scoped orgAdmin session is a shape the new contract rejects; the person signs in
        // again and gets an org-scope session. Proved at the token level, through the real session service.
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        var admin = await db.InsertStaffUserAsync("Admin");
        await db.InsertAssignmentAsync(admin, exercise, "orgAdmin");
        const string accessToken = "legacy-org-admin-access";
        const string refreshToken = "legacy-org-admin-refresh";
        var sessionId = await db.InsertStaffSessionAsync(admin, exercise, "orgAdmin", accessToken, refreshToken);
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{sessionId}' AND [RevokedAt] IS NULL"))
            .Should().Be(1, "precondition: the pair is live before the migration");

        await db.MigrateToAsync(MigrationUnderTest);

        await using var after = db.CreateContext();
        (await SessionServiceOver(after).GetCurrentAsync(accessToken)).Outcome.Should().NotBe(
            SessionQueryOutcome.Live, "the old access token no longer authenticates (GET /api/session → 401)");
        (await SessionServiceOver(after).RefreshAsync(refreshToken)).Outcome.Should().Be(
            RefreshOutcome.Invalid, "and the old refresh token cannot mint a replacement (POST /api/session/refresh → 401)");
    }

    [RequiresDockerFact]
    public async Task Up_RevokesLiveParticipantSessions_MintedFromLegacyStaffRoleAccounts_AndLeavesParticipantsLive()
    {
        // L-6: a participant-kind session minted before the deploy from an account carrying a STAFF role fails the
        // client's world check after A1; the migration revokes it like the retired orgAdmin sessions.
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        var staffSessions = new List<Guid>();
        foreach (var role in new[] { "planner", "controller", "evaluator", "orgAdmin" })
        {
            var account = await db.InsertAccountAsync(exercise, role, personaId: null);
            staffSessions.Add(await db.InsertParticipantSessionAsync(account, exercise, role));
        }

        var participantAccount = await db.InsertAccountAsync(exercise, "participant", Guid.NewGuid());
        var participantSession = await db.InsertParticipantSessionAsync(participantAccount, exercise, "participant");
        var pioAccount = await db.InsertAccountAsync(exercise, "pio", personaId: null);
        var pioSession = await db.InsertParticipantSessionAsync(pioAccount, exercise, "pio");

        await db.MigrateToAsync(MigrationUnderTest);

        foreach (var id in staffSessions)
        {
            (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{id}' AND [RevokedAt] IS NOT NULL"))
                .Should().Be(1, "a live participant session minted from a staff-role account is revoked by the migration");
        }

        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] IN ('{participantSession}', '{pioSession}') AND [RevokedAt] IS NULL"))
            .Should().Be(2, "participant-world sessions (participant, pio) are untouched");
    }

    [RequiresDockerFact]
    public async Task Up_AddsTheSessionScopeCheck_ThatHoldsOverEveryLegacyRow_AndRejectsANullExerciseNonOrgAdminRow()
    {
        // M-6: CK_Sessions_ExerciseId_OrgAdminOnly — "ExerciseId IS NOT NULL OR Role = 'orgAdmin'", one direction only.
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        (await db.ScalarAsync<bool>("SELECT c.[is_nullable] FROM sys.columns c WHERE c.[object_id] = OBJECT_ID('Sessions') AND c.[name] = 'ExerciseId'"))
            .Should().BeFalse("before A1 Sessions.ExerciseId is NOT NULL, so no legacy row can carry a null exercise");

        var exercise = await db.InsertExerciseAsync("live");
        var admin = await db.InsertStaffUserAsync("Admin");
        var controller = await db.InsertStaffUserAsync("Controller");
        await db.InsertAssignmentAsync(admin, exercise, "orgAdmin");
        await db.InsertAssignmentAsync(controller, exercise, "controller");
        var legacyOrgAdminSession = await db.InsertStaffSessionAsync(admin, exercise, "orgAdmin");
        await db.InsertStaffSessionAsync(controller, exercise, "controller");
        var account = await db.InsertAccountAsync(exercise, "participant", Guid.NewGuid());
        await db.InsertParticipantSessionAsync(account, exercise, "participant");

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.check_constraints
            WHERE [name] = 'CK_Sessions_ExerciseId_OrgAdminOnly' AND [parent_object_id] = OBJECT_ID('Sessions')
              AND [is_not_trusted] = 0 AND [is_disabled] = 0
            """)).Should().Be(1, "the constraint exists, enabled, and was validated WITH CHECK against every existing row");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM [Sessions] WHERE NOT ([ExerciseId] IS NOT NULL OR [Role] = 'orgAdmin')"))
            .Should().Be(0, "every legacy row the migration can see satisfies the constraint");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{legacyOrgAdminSession}' AND [ExerciseId] = '{exercise}' AND [RevokedAt] IS NOT NULL"))
            .Should().Be(1, "a legacy revoked orgAdmin row keeps its exercise — the reverse direction is deliberately not constrained");

        var reject = async () => await db.InsertSessionRowAsync(exerciseId: null, kind: "staff", role: "controller");
        (await reject.Should().ThrowAsync<SqlException>("a null-exercise session is an orgAdmin-only shape"))
            .Which.Number.Should().Be(547, "547 is a CHECK constraint violation");

        var orgScope = await db.InsertSessionRowAsync(exerciseId: null, kind: "staff", role: "orgAdmin");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Sessions] WHERE [Id] = '{orgScope}' AND [ExerciseId] IS NULL"))
            .Should().Be(1, "an org-scope orgAdmin session is the one valid null-exercise row");
    }

    private static SessionService SessionServiceOver(PulseDbContext context) => new(
        context,
        Microsoft.Extensions.Options.Options.Create(new SessionOptions()),
        new Pulse.WebApi.Features.Identity.EasyLogin.ExerciseFactsReader(context),
        Microsoft.Extensions.Options.Options.Create(new Pulse.WebApi.Features.Identity.EasyLogin.EasyLoginOptions()),
        TimeProvider.System,
        Microsoft.Extensions.Logging.Abstractions.NullLogger<SessionService>.Instance);

    [RequiresDockerFact]
    public async Task Up_GivesEveryAccountAnEnrollment_CopyingRoleAndPersona_AndLeavesNoOrphanSentinel()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        var personaId = Guid.NewGuid();
        var participant = await db.InsertAccountAsync(exercise, "participant", personaId);
        var pio = await db.InsertAccountAsync(exercise, "pio", personaId: null);

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>($"""
            SELECT COUNT(*) FROM [Accounts] a JOIN [Enrollments] e ON e.[Id] = a.[EnrollmentId]
            WHERE a.[Id] = '{participant}' AND e.[Role] = 'participant' AND e.[PersonaId] = '{personaId}'
              AND e.[ExerciseId] = '{exercise}' AND e.[PersonId] IS NULL
            """)).Should().Be(1, "the account's role and persona move to its enrollment (a one-off: no person)");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Accounts] a JOIN [Enrollments] e ON e.[Id] = a.[EnrollmentId] WHERE a.[Id] = '{pio}' AND e.[Role] = 'pio'"))
            .Should().Be(1);
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM [Accounts] WHERE [EnrollmentId] = '00000000-0000-0000-0000-000000000000'"))
            .Should().Be(0, "no account may be left on the empty sentinel");
        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.default_constraints dc
            JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
            WHERE (dc.parent_object_id = OBJECT_ID('Accounts') AND c.name = 'EnrollmentId')
               OR (dc.parent_object_id = OBJECT_ID('Organizations') AND c.name = 'Slug')
            """)).Should().Be(0, "no default constraint is left behind to mint an orphan on a raw insert");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Accounts') AND name IN ('Role', 'PersonaId')"))
            .Should().Be(0, "Accounts.Role and Accounts.PersonaId are dropped");
    }

    [RequiresDockerFact]
    public async Task Up_BackfillsUniqueSlugsFromNames()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var first = await db.InsertOrganizationAsync($"Acme Emergency {suffix}", DateTimeOffset.UtcNow.AddDays(-2));
        var second = await db.InsertOrganizationAsync($"ACME  emergency--{suffix}!", DateTimeOffset.UtcNow.AddDays(-1));
        var symbols = await db.InsertOrganizationAsync($"*** {suffix[..0]}***", DateTimeOffset.UtcNow);

        await db.MigrateToAsync(MigrationUnderTest);

        var expected = OrganizationSlug.FromName($"Acme Emergency {suffix}");
        (await db.ScalarAsync<string>($"SELECT [Slug] FROM [Organizations] WHERE [Id] = '{first}'"))
            .Should().Be(expected, "the T-SQL backfill applies the same rule as OrganizationSlug.FromName");
        (await db.ScalarAsync<string>($"SELECT [Slug] FROM [Organizations] WHERE [Id] = '{second}'"))
            .Should().Be(expected + "-2", "a colliding slug is suffixed, so the unique index holds");
        (await db.ScalarAsync<string>($"SELECT [Slug] FROM [Organizations] WHERE [Id] = '{symbols}'")).Should().Be("org");
        (await db.ScalarAsync<string>($"SELECT [Slug] FROM [Organizations] WHERE [Id] = '{Organization.DefaultOrganizationId}'"))
            .Should().Be(OrganizationSlug.FromName(Organization.DefaultOrganizationName));
    }

    [RequiresDockerFact]
    public async Task Up_BackfillsFirstLiveAt_FromTheLifecycleTransition_TheBootstrapEvent_OrNotAtAll()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var transitioned = await db.InsertExerciseAsync("paused");
        var transitionAt = new DateTimeOffset(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);
        await db.InsertTelemetryAsync(transitioned, "exercise.lifecycle.transitioned", "{\"from\":\"staged\",\"to\":\"live\"}", transitionAt);
        await db.InsertTelemetryAsync(transitioned, "exercise.lifecycle.transitioned", "{\"from\":\"live\",\"to\":\"paused\"}", transitionAt.AddHours(1));

        var bootstrapped = await db.InsertExerciseAsync("live");
        var bootstrappedAt = new DateTimeOffset(2026, 8, 15, 9, 30, 0, TimeSpan.Zero);
        await db.InsertTelemetryAsync(bootstrapped, "exercise.bootstrapped", "{}", bootstrappedAt);

        var neverLive = await db.InsertExerciseAsync("build");
        // All four sources absent: no lifecycle transition, no exercise.bootstrapped event, no post, and CreatedAt NULL.
        var noEvidence = await db.InsertExerciseAsync("completed");

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<DateTimeOffset?>($"SELECT [FirstLiveAt] FROM [Exercises] WHERE [Id] = '{transitioned}'"))
            .Should().Be(transitionAt, "the first lifecycle transition to live");
        (await db.ScalarAsync<DateTimeOffset?>($"SELECT [FirstLiveAt] FROM [Exercises] WHERE [Id] = '{bootstrapped}'"))
            .Should().Be(bootstrappedAt, "bootstrap creates exercises directly in live — its event is the first-live evidence");
        (await db.ScalarAsync<DateTimeOffset?>($"SELECT [FirstLiveAt] FROM [Exercises] WHERE [Id] = '{neverLive}'"))
            .Should().BeNull("a build exercise has never been live");
        (await db.ScalarAsync<DateTimeOffset?>($"SELECT [FirstLiveAt] FROM [Exercises] WHERE [Id] = '{noEvidence}'"))
            .Should().NotBeNull(
                "an exercise past staged is NEVER left without FirstLiveAt — with no transition, no bootstrap event, no post and "
                + "a NULL CreatedAt (all four sources absent), the migration time is the final fallback");
    }

    [RequiresDockerFact]
    public async Task Up_MakesExactlyOneControllerTheLead_TheEarliestCreated_TiebreakTheLowestId()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var at = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);

        var exercise = await db.InsertExerciseAsync("live");
        var late = await db.InsertAssignmentAsync(await db.InsertStaffUserAsync("Late"), exercise, "controller", at.AddHours(1));
        var early = await db.InsertAssignmentAsync(await db.InsertStaffUserAsync("Early"), exercise, "controller", at);
        await db.InsertAssignmentAsync(await db.InsertStaffUserAsync("Planner"), exercise, "planner", at.AddHours(-1));

        var tied = await db.InsertExerciseAsync("live");
        var tiedIds = new List<Guid>();
        for (var i = 0; i < 3; i++)
        {
            tiedIds.Add(await db.InsertAssignmentAsync(await db.InsertStaffUserAsync($"Tied {i}"), tied, "controller", at));
        }

        var noControllers = await db.InsertExerciseAsync("live");
        await db.InsertAssignmentAsync(await db.InsertStaffUserAsync("Only planner"), noControllers, "planner", at);

        // L-1: an account-backed controller (PersonId NULL) created EARLIER than every person controller is never the lead.
        var withAccountController = await db.InsertExerciseAsync("live");
        var accountController = await db.InsertAccountAsync(withAccountController, "controller", personaId: null, at.AddDays(-1));
        var personController = await db.InsertAssignmentAsync(
            await db.InsertStaffUserAsync("Person controller"), withAccountController, "controller", at);

        var onlyAccountController = await db.InsertExerciseAsync("live");
        await db.InsertAccountAsync(onlyAccountController, "controller", personaId: null, at.AddDays(-1));

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<Guid>($"SELECT [Id] FROM [Enrollments] WHERE [ExerciseId] = '{exercise}' AND [IsLead] = 1"))
            .Should().Be(early, "the earliest-created controller becomes the lead");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] = '{late}' AND [IsLead] = 0")).Should().Be(1);

        var lowest = tiedIds.OrderBy(id => new SqlGuid(id)).First();
        (await db.ScalarAsync<Guid>($"SELECT [Id] FROM [Enrollments] WHERE [ExerciseId] = '{tied}' AND [IsLead] = 1"))
            .Should().Be(lowest, "a CreatedAt tie is broken by the lowest id (SQL Server uniqueidentifier order)");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [ExerciseId] = '{noControllers}' AND [IsLead] = 1"))
            .Should().Be(0, "an exercise with no controller has no lead");
        (await db.ScalarAsync<Guid>($"SELECT [Id] FROM [Enrollments] WHERE [ExerciseId] = '{withAccountController}' AND [IsLead] = 1"))
            .Should().Be(personController, "only a person-backed controller can lead, even when an account-backed one is older");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] = '{accountController}' AND [IsLead] = 0"))
            .Should().Be(1);
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [ExerciseId] = '{onlyAccountController}' AND [IsLead] = 1"))
            .Should().Be(0, "an exercise whose only controller is account-backed has no lead");
    }

    [RequiresDockerFact]
    public async Task DownThenUp_RestoresTheLegacyShape_ThenConvergesOnTheSameEnrollments()
    {
        await using var db = await LegacyDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        var controller = await db.InsertStaffUserAsync("Controller");
        var admin = await db.InsertStaffUserAsync("Admin");
        var controllerAssignment = await db.InsertAssignmentAsync(controller, exercise, "controller");
        var adminAssignment = await db.InsertAssignmentAsync(admin, exercise, "orgAdmin");
        var personaId = Guid.NewGuid();
        var account = await db.InsertAccountAsync(exercise, "participant", personaId);

        await db.MigrateToAsync(MigrationUnderTest);
        await db.MigrateToAsync(PreviousMigration);

        (await db.ScalarAsync<string>($"SELECT [Role] FROM [StaffAssignments] WHERE [Id] = '{controllerAssignment}' AND [StaffUserId] = '{controller}'"))
            .Should().Be("controller", "Down restores the assignment with its SAME id");
        (await db.ScalarAsync<string>($"SELECT [Role] FROM [StaffAssignments] WHERE [Id] = '{adminAssignment}'"))
            .Should().Be("orgAdmin", "the org admin's planner enrollment is restored as the orgAdmin assignment it came from");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Accounts] WHERE [Id] = '{account}' AND [Role] = 'participant' AND [PersonaId] = '{personaId}'"))
            .Should().Be(1, "Down gives the account back its role and persona");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.tables WHERE name IN ('People', 'Enrollments', 'OrgAuditEvents', 'LoginChoices', 'LoginChoiceCandidates')"))
            .Should().Be(0);

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] IN ('{controllerAssignment}', '{adminAssignment}', '{account}')"))
            .Should().Be(3, "the re-Up converges on the same enrollment ids (assignments keep theirs; an account's reuses its id)");
        (await db.ScalarAsync<string>($"SELECT [Role] FROM [Enrollments] WHERE [Id] = '{adminAssignment}'")).Should().Be("planner");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM [Accounts] WHERE [EnrollmentId] = [Id]")).Should().Be(1);
    }

    private sealed class LegacyDatabase : IAsyncDisposable
    {
        private readonly string _master;
        private readonly string _name;

        private LegacyDatabase(string master, string name, string connectionString)
        {
            _master = master;
            _name = name;
            ConnectionString = connectionString;
        }

        private string ConnectionString { get; }

        public static async Task<LegacyDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            var name = $"PulseA1Test_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }.ConnectionString;
            await ExecuteAsync(master, $"CREATE DATABASE [{name}];");
            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }.ConnectionString;
            return new LegacyDatabase(master, name, connectionString);
        }

        public async Task MigrateToAsync(string target)
        {
            await using var context = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);
            await context.Database.GetService<IMigrator>().MigrateAsync(target);
        }

        public async Task<Guid> InsertOrganizationAsync(string name, DateTimeOffset createdAt)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(ConnectionString, $"INSERT INTO [Organizations] ([Id], [Name], [CreatedAt]) VALUES ('{id}', N'{name}', '{createdAt:O}');");
            return id;
        }

        public async Task<Guid> InsertExerciseAsync(string status)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [Exercises] ([Id], [Name], [TimeZone], [Status], [ComplianceChromeEnabled], [WatermarkEnabled],
                                         [IsPracticeMode], [OrganizationId])
                VALUES ('{id}', N'Legacy {id:N}', N'UTC', N'{status}', 1, 1, 0, '{Organization.DefaultOrganizationId}');
                """);
            return id;
        }

        public async Task<Guid> InsertStaffUserAsync(string displayName)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [StaffUsers] ([Id], [OrganizationId], [ExternalSubject], [DisplayName], [CreatedAt])
                VALUES ('{id}', '{Organization.DefaultOrganizationId}', N'idp|{id:N}', N'{displayName}', SYSDATETIMEOFFSET());
                """);
            return id;
        }

        public async Task<Guid> InsertAssignmentAsync(Guid staffUserId, Guid exerciseId, string role, DateTimeOffset? createdAt = null)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [StaffAssignments] ([Id], [StaffUserId], [ExerciseId], [Role], [CreatedAt])
                VALUES ('{id}', '{staffUserId}', '{exerciseId}', N'{role}', '{(createdAt ?? DateTimeOffset.UtcNow):O}');
                """);
            return id;
        }

        public async Task<Guid> InsertAccountAsync(Guid exerciseId, string role, Guid? personaId, DateTimeOffset? createdAt = null)
        {
            var id = Guid.NewGuid();
            var persona = personaId is { } p ? $"'{p}'" : "NULL";
            var created = createdAt is { } c ? $"'{c:O}'" : "SYSDATETIMEOFFSET()";
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [Accounts] ([Id], [ExerciseId], [Username], [DisplayName], [Role], [PersonaId], [CreatedAt], [FailedLoginCount])
                VALUES ('{id}', '{exerciseId}', N'user_{id:N}', N'Legacy Participant', N'{role}', {persona}, {created}, 0);
                """);
            return id;
        }

        public async Task<Guid> InsertStaffSessionAsync(
            Guid staffUserId, Guid exerciseId, string role, string? accessToken = null, string? refreshToken = null)
        {
            var id = Guid.NewGuid();
            var tokenHash = accessToken is null ? $"hash-{id:N}" : SessionTokens.Hash(accessToken);
            var refreshHash = refreshToken is null ? "NULL" : $"N'{SessionTokens.Hash(refreshToken)}'";
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [Sessions] ([Id], [TokenHash], [RefreshTokenHash], [Kind], [ExerciseId], [PrincipalId], [StaffUserId],
                                        [Role], [ActingHumanId], [IsReadOnly], [IssuedAt], [ExpiresAt], [RefreshExpiresAt])
                VALUES ('{id}', N'{tokenHash}', {refreshHash}, N'staff', '{exerciseId}', N'{staffUserId}', '{staffUserId}',
                        N'{role}', N'{staffUserId}', 0, SYSDATETIMEOFFSET(), DATEADD(hour, 1, SYSDATETIMEOFFSET()),
                        DATEADD(hour, 8, SYSDATETIMEOFFSET()));
                """);
            return id;
        }

        public async Task<Guid> InsertParticipantSessionAsync(Guid accountId, Guid exerciseId, string role)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [Sessions] ([Id], [TokenHash], [Kind], [ExerciseId], [PrincipalId], [AccountId],
                                        [Role], [ActingHumanId], [IsReadOnly], [IssuedAt], [ExpiresAt], [RefreshExpiresAt])
                VALUES ('{id}', N'hash-{id:N}', N'participant', '{exerciseId}', N'{accountId}', '{accountId}',
                        N'{role}', N'{accountId}', 0, SYSDATETIMEOFFSET(), DATEADD(hour, 1, SYSDATETIMEOFFSET()),
                        DATEADD(hour, 8, SYSDATETIMEOFFSET()));
                """);
            return id;
        }

        /// <summary>A raw post-A1 session row (nullable exercise), for probing the Sessions CHECK.</summary>
        public async Task<Guid> InsertSessionRowAsync(Guid? exerciseId, string kind, string role)
        {
            var id = Guid.NewGuid();
            var exercise = exerciseId is { } e ? $"'{e}'" : "NULL";
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [Sessions] ([Id], [TokenHash], [Kind], [ExerciseId], [PrincipalId], [Role], [ActingHumanId],
                                        [IsReadOnly], [IssuedAt], [ExpiresAt])
                VALUES ('{id}', N'hash-{id:N}', N'{kind}', {exercise}, N'{id}', N'{role}', N'{id}', 0,
                        SYSDATETIMEOFFSET(), DATEADD(hour, 1, SYSDATETIMEOFFSET()));
                """);
            return id;
        }

        public PulseDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);

        public async Task InsertTelemetryAsync(Guid exerciseId, string eventType, string payload, DateTimeOffset at)
        {
            await ExecuteAsync(ConnectionString, $"""
                INSERT INTO [TelemetryEvents] ([EventId], [SchemaVersion], [ExerciseId], [EventType], [Channel], [Actor_Kind],
                                               [WallClockTime], [ScenarioTime], [TimeZone], [Payload], [EmittedAt])
                VALUES (N'{Guid.NewGuid()}', N'v0', '{exerciseId}', N'{eventType}', N'system', N'system',
                        '{at:O}', '{at:O}', N'UTC', N'{payload}', '{at:O}');
                """);
        }

        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            var value = await command.ExecuteScalarAsync();
            return value is null or DBNull ? default! : (T)value;
        }

        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await ExecuteAsync(
                _master,
                $"IF DB_ID('{_name}') IS NOT NULL BEGIN ALTER DATABASE [{_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_name}]; END");
        }

        private static async Task ExecuteAsync(string connectionString, string sql)
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }
}
