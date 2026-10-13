namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Ops.EngineContentSeed;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// easy-login/02 — <see cref="RosterService"/> and <see cref="RosterQueryService"/> against real SQL Server: the rows a
/// real import writes (account, citizen persona with <c>Castable = false</c>, ExerciseRole), one save with partial
/// apply, a dry run that writes nothing at all, an idempotent re-upload, updates that never clear, the org-persona
/// rules, the link issuer seam and the XC-004 events, the single add, and the list (AC-1 to AC-7, telemetry).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RosterServiceTests
{
    private const string Header = "name,agency,role,email,personaHandle,signInName\n";

    private readonly MsSqlContainerFixture _fixture;

    public RosterServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private PulseDbContext Read(Guid exerciseId) => _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });

    [RequiresDockerFact]
    public async Task Import_ARow_CreatesAPasswordlessParticipantAndANonCastableCitizenPersona()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var result = await harness.Service.ImportAsync(
                Header + "Riley Chen,Fulco Fire,Captain,riley@example.test,,", dryRun: false);

            result.Outcome.Should().Be(RosterOutcome.Ok);
            var row = result.Report!.Rows.Should().ContainSingle().Subject;
            row.Status.Should().Be(RosterRowStatuses.Created);
            row.SignInName.Should().Be("rchen");
            row.PersonaHandle.Should().Be("riley_chen");
            row.PersonaCreated.Should().BeTrue();
        }

        await using var read = Read(world.ExerciseId);
        var account = await read.Accounts.SingleAsync();
        account.ExerciseId.Should().Be(world.ExerciseId, "stamped from the resolved scope");
        account.Username.Should().Be("rchen");
        account.DisplayName.Should().Be("Riley Chen");
        account.Role.Should().Be("participant", "no org persona means ExerciseRole participant (EL-1)");
        account.Agency.Should().Be("Fulco Fire");
        account.JobRole.Should().Be("Captain", "the CSV role column is a free-text job label, not an ExerciseRole");
        account.Email.Should().Be("riley@example.test");
        account.CredentialHash.Should().BeNull("the new paths set no password");
        account.PersonaAutoCreated.Should().BeTrue();

        var persona = await read.Personas.SingleAsync();
        account.PersonaId.Should().Be(persona.Id);
        persona.Handle.Should().Be("riley_chen");
        persona.DisplayName.Should().Be("Riley Chen");
        persona.Kind.Should().Be("human");
        persona.PersonaType.Should().Be("citizen");
        persona.Verified.Should().BeFalse();
        persona.AudienceBand.Should().Be("nano");
        persona.AudienceMagnitude.Should().Be(PersonaCastSeeder.DeriveAudienceMagnitude("nano", "riley_chen"));
        persona.Bio.Should().BeNull();
        persona.Castable.Should().BeFalse("EL-4: the engine must never voice a real participant's persona");
    }

    [RequiresDockerFact]
    public async Task Import_AnOrgHandle_BindsThatPersonaAsPio_AndTwoRowsKeepTheirOwnAccountsAndActingHumans()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        var orgId = await RosterSeed.PersonaAsync(_fixture, world.ExerciseId, "FulcoEM", "org");

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var result = await harness.Service.ImportAsync(
                Header + "Ana Lima,Fulco EM,,,@fulcoem,\nBen Cole,Fulco EM,,,FulcoEM,", dryRun: false);

            result.Report!.Rows.Should().OnlyContain(r => r.Status == RosterRowStatuses.Created && r.PersonaHandle == "FulcoEM" && !r.PersonaCreated);
        }

        await using var read = Read(world.ExerciseId);
        var accounts = await read.Accounts.OrderBy(a => a.DisplayName).ToListAsync();
        accounts.Should().HaveCount(2).And.OnlyContain(a => a.PersonaId == orgId && a.Role == "pio" && !a.PersonaAutoCreated);
        (await read.Personas.CountAsync()).Should().Be(1, "binding an org persona creates no persona");

        var humans = accounts.Select(a => ParticipantSessionRequests.For(a, world.ExerciseId).ActingHumanId).ToList();
        humans.Should().OnlyHaveUniqueItems("COR-018: two people on one org persona are two acting humans");
    }

    [RequiresDockerFact]
    public async Task Import_ADryRun_ReturnsTheSameReport_AndWritesNoAccountPersonaLinkOrEvent()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        await RosterSeed.PersonaAsync(_fixture, world.ExerciseId, "FulcoEM", "org");
        const string file = Header + "Riley Chen,Fulco Fire,,,,\nSam Ortiz,Fulco EM,,,@FulcoEM,\nBad Persona,,,,NoSuchOrg,";

        RosterImportResultDto dry;
        await using (var harness = RosterHarness.For(_fixture, world))
        {
            dry = (await harness.Service.ImportAsync(file, dryRun: true)).Report!;
            harness.Issuer!.Calls.Should().BeEmpty("a dry run issues no link");
        }

        await using (var read = Read(world.ExerciseId))
        {
            (await read.Accounts.CountAsync()).Should().Be(0, "a dry run writes no account");
            (await read.Personas.CountAsync()).Should().Be(1, "a dry run writes no persona (only the seeded org persona exists)");
            (await read.ParticipantLinks.CountAsync()).Should().Be(0, "a dry run writes no link");
            (await read.TelemetryEvents.CountAsync()).Should().Be(0, "a dry run emits no event");
        }

        RosterImportResultDto real;
        await using (var harness = RosterHarness.For(_fixture, world))
        {
            real = (await harness.Service.ImportAsync(file, dryRun: false)).Report!;
        }

        dry.DryRun.Should().BeTrue();
        real.DryRun.Should().BeFalse();
        real.Rows.Should().BeEquivalentTo(dry.Rows, "the dry run is the same report as the real run");
        (dry.CreatedCount, dry.FailedCount).Should().Be((2, 1));
    }

    [RequiresDockerFact]
    public async Task Import_PartialApply_ValidRowsCommit_AFailedRowWritesNothing()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var report = (await harness.Service.ImportAsync(
                Header + "A One,,,,,\nBad Email,,,not-an-email,,\nB Two,,,,,", dryRun: false)).Report!;

            report.Rows.Select(r => r.Status).Should().Equal(RosterRowStatuses.Created, RosterRowStatuses.Failed, RosterRowStatuses.Created);
            report.Rows[1].Message.Should().Be(RosterRowRules.EmailInvalidMessage);
            (report.TotalRows, report.CreatedCount, report.FailedCount).Should().Be((3, 2, 1));
        }

        await using var read = Read(world.ExerciseId);
        (await read.Accounts.Select(a => a.DisplayName).OrderBy(n => n).ToListAsync()).Should().Equal("A One", "B Two");
        (await read.Personas.CountAsync()).Should().Be(2, "the failed row created no persona");
    }

    [RequiresDockerFact]
    public async Task Import_TheSameFileTwice_IsIdempotent_NothingIsCreated_NoLinkRotates_NoEventIsEmitted()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        const string file = Header + "Riley Chen,Fulco Fire,Captain,riley@example.test,,\nTaylor Reed,,,,,\nBad,,,,NoSuchOrg,";

        await using (var first = RosterHarness.For(_fixture, world))
        {
            (await first.Service.ImportAsync(file, dryRun: false)).Report!.CreatedCount.Should().Be(2);
        }

        await using var before = Read(world.ExerciseId);
        var linksBefore = await before.ParticipantLinks.AsNoTracking().Select(l => new { l.Id, l.TokenHash }).ToListAsync();
        var eventsBefore = await before.TelemetryEvents.CountAsync();

        await using (var again = RosterHarness.For(_fixture, world))
        {
            var report = (await again.Service.ImportAsync(file, dryRun: false)).Report!;
            report.Rows.Select(r => r.Status).Should().Equal(RosterRowStatuses.Unchanged, RosterRowStatuses.Unchanged, RosterRowStatuses.Failed);
            again.Issuer!.Calls.Should().BeEmpty("an existing participant's link is never touched by a re-upload");
        }

        await using var after = Read(world.ExerciseId);
        (await after.Accounts.CountAsync()).Should().Be(2, "zero accounts created by the re-upload");
        (await after.Personas.CountAsync()).Should().Be(2, "zero personas created by the re-upload");
        (await after.ParticipantLinks.AsNoTracking().Select(l => new { l.Id, l.TokenHash }).ToListAsync())
            .Should().BeEquivalentTo(linksBefore, "zero links created or rotated");
        (await after.TelemetryEvents.CountAsync()).Should().Be(eventsBefore, "zero roster.imported rows for a re-upload that changed nothing");
    }

    [RequiresDockerFact]
    public async Task Import_AChangedRow_IsUpdatedAndPersisted_AndABlankCellNeverClears()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        var orgId = await RosterSeed.PersonaAsync(_fixture, world.ExerciseId, "FulcoPIO", "org");

        await using (var first = RosterHarness.For(_fixture, world))
        {
            await first.Service.ImportAsync(Header + "Riley Chen,Fulco Fire,Captain,riley@example.test,,", dryRun: false);
        }

        await using (var second = RosterHarness.For(_fixture, world))
        {
            var row = (await second.Service.ImportAsync(
                Header + "Riley Chen-Ng,Fulco Fire Dept,,,FulcoPIO,rchen", dryRun: false)).Report!.Rows.Single();

            row.Status.Should().Be(RosterRowStatuses.Updated);
            row.Message.Should().Be("agency, name changed; persona bound to @FulcoPIO.");
        }

        await using var read = Read(world.ExerciseId);
        var account = await read.Accounts.SingleAsync();
        account.DisplayName.Should().Be("Riley Chen-Ng", "matched by sign-in name, so the display name is corrected");
        account.Agency.Should().Be("Fulco Fire Dept");
        account.JobRole.Should().Be("Captain", "a blank cell never clears a stored value");
        account.Email.Should().Be("riley@example.test", "a blank cell never clears a stored value");
        account.PersonaId.Should().Be(orgId);
        account.Role.Should().Be("pio");
        account.PersonaAutoCreated.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Import_EmitsOneCountsOnlyRosterImportedEvent_AndALinkIssuedEventPerNewLink()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture, staffRole: "planner");

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            await harness.Service.ImportAsync(
                Header + "Riley Chen,Fulco Fire,,riley@example.test,,\nTaylor Reed,,,taylor@example.test,,\nBad,,,,NoSuchOrg,", dryRun: false);
            harness.Issuer!.Calls.Should().HaveCount(2, "every new participant gets a link before the response returns");
            harness.Issuer.IssuedBy.Should().OnlyContain(id => id == world.StaffUserId, "the provisioning staff user is the link's issuer");
        }

        await using var read = Read(world.ExerciseId);
        var events = await read.TelemetryEvents.AsNoTracking().ToListAsync();
        var links = await read.ParticipantLinks.AsNoTracking().ToListAsync();

        var imported = events.Should().ContainSingle(e => e.EventType == EasyLoginTelemetry.RosterImportedEventType).Subject;
        JsonDocument.Parse(imported.Payload!).RootElement.EnumerateObject().Select(p => (p.Name, p.Value.GetInt32()))
            .Should().Equal([("created", 2), ("updated", 0), ("unchanged", 0), ("failed", 1)], "counts only");
        imported.Target.Should().BeNull();

        var issued = events.Where(e => e.EventType == EasyLoginTelemetry.LinkIssuedEventType).ToList();
        issued.Should().HaveCount(2);
        issued.Select(e => e.Target!.EntityId).Should().BeEquivalentTo(links.Select(l => l.Id.ToString()));

        foreach (var e in events)
        {
            e.ExerciseId.Should().Be(world.ExerciseId);
            e.Channel.Should().Be("system");
            e.Actor.Kind.Should().Be("system");
            e.Actor.Role.Should().Be("planner", "the staff caller's role on this exercise");
            e.Actor.ActingHumanId.Should().Be(world.StaffUserId.ToString());
            e.TimeZone.Should().Be("America/New_York");
            e.Payload.Should().NotContainAny(["Riley", "riley@example.test", "taylor@example.test", "rchen"], "no name, email or sign-in name in telemetry");
        }
    }

    [RequiresDockerFact]
    public async Task Import_WithTheNullIssuer_StillProvisions_AndReportsNoLink()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);

        await using (var harness = RosterHarness.For(_fixture, world, realIssuer: false))
        {
            (await harness.Service.ImportAsync(Header + "Riley Chen,,,,,", dryRun: false)).Report!.CreatedCount.Should().Be(1);

            var listed = (await harness.Query.ListAsync())!.Participants.Should().ContainSingle().Subject;
            listed.Link.Status.Should().Be(RosterLinkStatuses.None, "before story 03 is wired a new participant simply has no link");
        }

        await using var read = Read(world.ExerciseId);
        (await read.TelemetryEvents.Select(e => e.EventType).ToListAsync()).Should().Equal(EasyLoginTelemetry.RosterImportedEventType);
    }

    [RequiresDockerFact]
    public async Task Add_CreatesOneParticipant_WithAnActiveLink_AndOnlyALinkEvent()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);

        RosterEntryDto entry;
        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var result = await harness.Service.AddAsync(new RosterRowWrite { Name = "Madonna", Agency = "Band", Email = "m@example.test" });

            result.Outcome.Should().Be(RosterOutcome.Ok);
            entry = result.Entry!;
        }

        entry.SignInName.Should().Be("madonna");
        entry.Persona!.Handle.Should().Be("madonna_2", "the public handle never equals a sign-in name, the row's own included");
        entry.Persona.AutoCreated.Should().BeTrue();
        entry.Persona.Kind.Should().Be("human");
        entry.ExerciseRole.Should().Be("participant");
        entry.Access.Should().Be(RosterAccessStates.Enabled);
        entry.LiveSessions.Should().Be(0);
        entry.Link.Status.Should().Be(RosterLinkStatuses.Active);
        entry.Link.JoinUrl.Should().StartWith(RosterSeed.FrontendBaseUrl + "/join/");
        entry.Email.Should().Be("m@example.test");

        await using var read = Read(world.ExerciseId);
        (await read.Accounts.SingleAsync()).Id.ToString().Should().Be(entry.Id);
        (await read.TelemetryEvents.Select(e => e.EventType).ToListAsync()).Should().Equal(
            [EasyLoginTelemetry.LinkIssuedEventType], "a single add is not an import; its one event is the link issue");
    }

    [RequiresDockerFact]
    public async Task Add_AnExistingKeyIsAConflict_AndAnInvalidFieldIsInvalid_AndNeitherWrites()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        await RosterSeed.AccountAsync(_fixture, world.ExerciseId, "jsmith", "Jane Smith", email: "jane@example.test");

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var byEmail = await harness.Service.AddAsync(new RosterRowWrite { Name = "Someone", Email = "JANE@example.test" });
            byEmail.Outcome.Should().Be(RosterOutcome.Conflict);
            byEmail.Error.Should().Be(RosterService.AlreadyOnRosterMessage);

            (await harness.Service.AddAsync(new RosterRowWrite { Name = "X", SignInName = "JSMITH" })).Outcome.Should().Be(RosterOutcome.Conflict);
            (await harness.Service.AddAsync(new RosterRowWrite { Name = " " })).Outcome.Should().Be(RosterOutcome.Invalid);
            (await harness.Service.AddAsync(new RosterRowWrite { Name = "A B", PersonaHandle = "Nobody" })).Error
                .Should().Be(RosterWorkspace.UnknownPersonaMessage);
        }

        await using var read = Read(world.ExerciseId);
        (await read.Accounts.CountAsync()).Should().Be(1, "a refused add writes nothing");
        (await read.TelemetryEvents.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task List_ShowsEveryParticipant_IncludingLegacyOnes_OrderedByName_WithLiveSessionsAndCapabilities()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        var legacy = await RosterSeed.AccountAsync(_fixture, world.ExerciseId, "zz-legacy", "Aiko Tanaka");
        await RosterSeed.AccountAsync(_fixture, world.ExerciseId, "staffish", "Zed Staff", role: "controller");

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            await harness.Service.ImportAsync(Header + "Riley Chen,Fulco Fire,Captain,riley@example.test,,", dryRun: false);
        }

        var now = DateTimeOffset.UtcNow;
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.AddRange(
                Session(world.ExerciseId, legacy.Id, expiresAt: now.AddMinutes(30), refreshExpiresAt: now.AddHours(8)),
                Session(world.ExerciseId, legacy.Id, expiresAt: now.AddMinutes(-5), refreshExpiresAt: now.AddHours(2)), // locked phone: refresh still open
                Session(world.ExerciseId, legacy.Id, expiresAt: now.AddMinutes(30), refreshExpiresAt: null, revoked: true),
                Session(world.ExerciseId, legacy.Id, expiresAt: now.AddMinutes(-5), refreshExpiresAt: now.AddMinutes(-1)));
            await seed.SaveChangesAsync();
        }

        await using var list = RosterHarness.Create(
            _fixture, world.ExerciseId, world.StaffSession, configuration: RosterSeed.Configuration(emailEndpoint: "https://acs.example.test"));
        var roster = (await list.Query.ListAsync())!;

        roster.JoinLinksAvailable.Should().BeTrue();
        roster.Capabilities.EmailLinks.Should().BeTrue("Email:Endpoint is configured");
        roster.Participants.Select(p => p.Name).Should().Equal(
            ["Aiko Tanaka", "Riley Chen"], "ordered by name; an account with a non-participant role is not on the roster");

        var aiko = roster.Participants[0];
        aiko.Agency.Should().BeNull("a legacy account shows no agency");
        aiko.Persona.Should().BeNull("omitted when the account has none");
        aiko.Link.Status.Should().Be(RosterLinkStatuses.None);
        aiko.LiveSessions.Should().Be(2, "not revoked and the access or refresh window still open");
        aiko.Access.Should().Be(RosterAccessStates.Enabled);

        var riley = roster.Participants[1];
        riley.Email.Should().Be("riley@example.test", "the roster is staff-only, so it carries the email (XC-002)");
        riley.Role.Should().Be("Captain");
        riley.Persona!.AutoCreated.Should().BeTrue();
        riley.Link.Status.Should().Be(RosterLinkStatuses.Active);
        riley.Link.JoinUrl.Should().NotBeNullOrEmpty();
        JsonSerializer.Serialize(roster).Should().NotContain(":null", "optional fields are omitted, never null");

        await using var noEmail = RosterHarness.For(_fixture, world);
        (await noEmail.Query.ListAsync())!.Capabilities.EmailLinks.Should().BeFalse("unset Email:Endpoint means the capability is off");
    }

    [RequiresDockerFact]
    public async Task Service_RefusesWithoutAStaffSession_ForAnEvaluator_AndWithNoScope()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        var evaluator = await RosterSeed.ExerciseAsync(_fixture, staffRole: "evaluator");

        await using (var anonymous = RosterHarness.Create(_fixture, world.ExerciseId, staff: null))
        {
            (await anonymous.Service.ImportAsync(Header + "A,,,,,", dryRun: false)).Outcome.Should().Be(RosterOutcome.Unauthenticated);
            (await anonymous.Service.AddAsync(new RosterRowWrite { Name = "A" })).Outcome.Should().Be(RosterOutcome.Unauthenticated);
        }

        await using (var observer = RosterHarness.For(_fixture, evaluator))
        {
            (await observer.Service.ImportAsync(Header + "A,,,,,", dryRun: false)).Outcome.Should().Be(RosterOutcome.Forbidden);
            (await observer.Service.AddAsync(new RosterRowWrite { Name = "A" })).Outcome.Should().Be(RosterOutcome.Forbidden);
        }

        await using (var unscoped = RosterHarness.Create(_fixture, scope: null, world.StaffSession))
        {
            (await unscoped.Service.ImportAsync(Header + "A,,,,,", dryRun: false)).Outcome.Should().Be(RosterOutcome.Unauthenticated);
            (await unscoped.Query.ListAsync()).Should().BeNull("an unresolved scope fails closed, never an empty or global roster");
        }

        await using var read = Read(world.ExerciseId);
        (await read.Accounts.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Import_AConcurrentClaimOfTheSameSignInName_IsRejudgedOnce_AndSteppedAround()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        var racing = new RacingLinkIssuer(_fixture, races: 1);

        await using (var harness = RosterHarness.Create(_fixture, world.ExerciseId, world.StaffSession, issuerOverride: _ => racing))
        {
            var report = (await harness.Service.ImportAsync(Header + "Riley Chen,,,,,", dryRun: false)).Report!;

            report.Rows.Single().Status.Should().Be(RosterRowStatuses.Created);
            report.Rows.Single().SignInName.Should().Be("rchen2", "the retry sees the name another request took (case-insensitively) and steps around it");
        }

        await using var read = Read(world.ExerciseId);
        (await read.Accounts.Select(a => a.Username).OrderBy(u => u).ToListAsync()).Should().Equal("RCHEN", "rchen2");
    }

    [RequiresDockerFact]
    public async Task Import_ARepeatedCollision_ReportsTheRowsFailed_AndWritesNothing_NeverA500()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);

        await using (var harness = RosterHarness.Create(
            _fixture, world.ExerciseId, world.StaffSession, issuerOverride: _ => new RacingLinkIssuer(_fixture, races: 2)))
        {
            var report = (await harness.Service.ImportAsync(Header + "Riley Chen,,,,,", dryRun: false)).Report!;

            var row = report.Rows.Single();
            row.Status.Should().Be(RosterRowStatuses.Failed);
            row.Message.Should().Be(RosterService.ConcurrentChangeMessage);
            (report.CreatedCount, report.FailedCount).Should().Be((0, 1));
        }

        await using (var harness = RosterHarness.Create(
            _fixture, world.ExerciseId, world.StaffSession, issuerOverride: _ => new RacingLinkIssuer(_fixture, races: 2)))
        {
            var add = await harness.Service.AddAsync(new RosterRowWrite { Name = "Taylor Reed" });
            add.Outcome.Should().Be(RosterOutcome.Conflict, "a single add that keeps colliding is a 409, never a 500");
        }

        await using var read = Read(world.ExerciseId);
        (await read.Accounts.CountAsync(a => a.DisplayName != "Concurrent Person")).Should().Be(0, "nothing of the roster's was written");
        (await read.Personas.CountAsync()).Should().Be(0);
        (await read.TelemetryEvents.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Import_AMatchedPersonalessParticipant_GetsANonCastableAutoPersona_NoLink_AndADryRunWritesNone()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        var legacy = await RosterSeed.AccountAsync(_fixture, world.ExerciseId, "madonna", "Madonna");
        const string file = Header + "Madonna,,,,,";

        await using (var dry = RosterHarness.For(_fixture, world))
        {
            var row = (await dry.Service.ImportAsync(file, dryRun: true)).Report!.Rows.Single();
            (row.Status, row.PersonaCreated, row.PersonaHandle).Should().Be((RosterRowStatuses.Updated, true, "madonna_2"));
        }

        await using (var read = Read(world.ExerciseId))
        {
            (await read.Personas.CountAsync()).Should().Be(0, "a dry run writes no persona");
        }

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var row = (await harness.Service.ImportAsync(file, dryRun: false)).Report!.Rows.Single();
            row.Status.Should().Be(RosterRowStatuses.Updated);
            row.PersonaCreated.Should().BeTrue();
            row.Message.Should().Be("persona created @madonna_2.");
            harness.Issuer!.Calls.Should().BeEmpty("a matched legacy participant gets no link here; staff reissue one (story 03)");
        }

        await using (var read = Read(world.ExerciseId))
        {
            var account = await read.Accounts.SingleAsync();
            var persona = await read.Personas.SingleAsync();
            account.Id.Should().Be(legacy.Id);
            account.PersonaId.Should().Be(persona.Id, "the persona row exists, so the reference does not dangle");
            account.PersonaAutoCreated.Should().BeTrue();
            account.Role.Should().Be("participant");
            persona.ExerciseId.Should().Be(world.ExerciseId, "stamped from the resolved scope");
            persona.Handle.Should().Be("madonna_2");
            persona.Kind.Should().Be("human");
            persona.Castable.Should().BeFalse("EL-4 holds for a persona created on re-upload too");
            (await read.ParticipantLinks.CountAsync()).Should().Be(0);
        }

        await using (var again = RosterHarness.For(_fixture, world))
        {
            (await again.Service.ImportAsync(file, dryRun: false)).Report!.Rows.Single().Status.Should().Be(RosterRowStatuses.Unchanged);
        }

        await using var after = Read(world.ExerciseId);
        (await after.Personas.CountAsync()).Should().Be(1, "the second upload creates nothing");
        (await after.TelemetryEvents.CountAsync(e => e.EventType == EasyLoginTelemetry.RosterImportedEventType)).Should().Be(
            1, "only the upload that wrote something is recorded");
    }

    [RequiresDockerFact]
    public async Task Import_TwoRowsReachingOnePersonByDifferentKeys_FailTheLater_AndTheReuploadIsStable()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        await RosterSeed.AccountAsync(_fixture, world.ExerciseId, "dwhitfield", "Dana Whitfield", agency: "Fulco EM", email: "dana@example.test");
        const string file = Header + "Dana Whitfield,Fulco EM,Ops Chief,,,dwhitfield\nDana Whitfield,Fulco EM,Planner,dana@example.test,,";

        await using (var first = RosterHarness.For(_fixture, world))
        {
            var rows = (await first.Service.ImportAsync(file, dryRun: false)).Report!.Rows;
            rows[0].Status.Should().Be(RosterRowStatuses.Updated);
            rows[1].Status.Should().Be(RosterRowStatuses.Failed);
            rows[1].Message.Should().Be("duplicate of row 1 (same person)");
        }

        await using var between = Read(world.ExerciseId);
        (await between.Accounts.SingleAsync()).JobRole.Should().Be("Ops Chief");
        var events = await between.TelemetryEvents.CountAsync();

        await using (var again = RosterHarness.For(_fixture, world))
        {
            (await again.Service.ImportAsync(file, dryRun: false)).Report!.Rows.Select(r => r.Status)
                .Should().Equal(RosterRowStatuses.Unchanged, RosterRowStatuses.Failed);
        }

        await using var after = Read(world.ExerciseId);
        (await after.Accounts.SingleAsync()).JobRole.Should().Be("Ops Chief", "no flip-flop between the two rows");
        (await after.TelemetryEvents.CountAsync()).Should().Be(events, "a stable re-upload emits no roster.imported");
    }

    internal static Session Session(Guid exerciseId, Guid accountId, DateTimeOffset expiresAt, DateTimeOffset? refreshExpiresAt, bool revoked = false) => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = Guid.NewGuid().ToString("N"),
        RefreshTokenHash = refreshExpiresAt is null ? null : Guid.NewGuid().ToString("N"),
        Kind = "participant",
        ExerciseId = exerciseId,
        PrincipalId = accountId.ToString(),
        AccountId = accountId,
        Role = "participant",
        ActingHumanId = accountId.ToString(),
        IssuedAt = DateTimeOffset.UtcNow.AddHours(-1),
        ExpiresAt = expiresAt,
        RefreshExpiresAt = refreshExpiresAt,
        RevokedAt = revoked ? DateTimeOffset.UtcNow.AddMinutes(-1) : null,
    };
}
