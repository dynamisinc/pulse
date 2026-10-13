namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// easy-login/02 (Isolation AC, XC-001/COR-001, always-Critical) — the roster case of the standing isolation suite.
/// Real SQL Server, two exercises per test, fresh ids. A staff caller of exercise A can neither list, match, update nor
/// bind anything in exercise B: B's persona handle is indistinguishable from an unknown handle, B's people never match
/// or block A's rows, B's sessions never count, every row written is stamped with A's resolved scope, and an
/// unresolved scope fails CLOSED (no roster at all, never every exercise's). Each "nothing" is paired with a proof that
/// the B rows exist (IgnoreQueryFilters), so a zero is the filter closing the door, not an empty table.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RosterIsolationTests
{
    private const string Header = "name,agency,role,email,personaHandle,signInName\n";

    private readonly MsSqlContainerFixture _fixture;

    public RosterIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task APersonaHandleFromExerciseB_FailsExactlyLikeAnUnknownHandle_AndBindsNothing()
    {
        var a = await RosterSeed.ExerciseAsync(_fixture);
        var b = await RosterSeed.ExerciseAsync(_fixture);
        var bOrg = await RosterSeed.PersonaAsync(_fixture, b.ExerciseId, $"BOrg{Guid.NewGuid():N}"[..20], "org");

        await using var probe = _fixture.CreateContext();
        var bHandle = (await probe.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == bOrg)).Handle;

        await using (var harness = RosterHarness.For(_fixture, a))
        {
            var report = (await harness.Service.ImportAsync(
                Header + $"Cross Row,,,,{bHandle},\nUnknown Row,,,,NoSuchHandleAnywhere,", dryRun: false)).Report!;

            report.Rows.Should().OnlyContain(r => r.Status == RosterRowStatuses.Failed);
            report.Rows[0].Message.Should().Be(report.Rows[1].Message, "another exercise's handle must be indistinguishable from an unknown one");
            report.Rows[0].Message.Should().Be(RosterWorkspace.UnknownPersonaMessage);

            var add = await harness.Service.AddAsync(new RosterRowWrite { Name = "Cross Add", PersonaHandle = "@" + bHandle });
            add.Outcome.Should().Be(RosterOutcome.Invalid);
            add.Error.Should().Be(RosterWorkspace.UnknownPersonaMessage);
        }

        await using var all = _fixture.CreateContext();
        (await all.Accounts.IgnoreQueryFilters().CountAsync(x => x.PersonaId == bOrg)).Should().Be(0, "nothing was bound to B's persona");
        (await all.Accounts.IgnoreQueryFilters().CountAsync(x => x.ExerciseId == a.ExerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task TheList_InExerciseA_ShowsOnlyA_AndNeverCountsBsSessions()
    {
        var a = await RosterSeed.ExerciseAsync(_fixture);
        var b = await RosterSeed.ExerciseAsync(_fixture);
        var inA = await RosterSeed.AccountAsync(_fixture, a.ExerciseId, "anna", "Anna In A");
        var inB = await RosterSeed.AccountAsync(_fixture, b.ExerciseId, "bert", "Bert In B", email: "bert@example.test");

        var now = DateTimeOffset.UtcNow;
        await using (var seed = _fixture.CreateContext())
        {
            // A session carrying A's account id but bound to exercise B: the explicit ExerciseId predicate must drop it.
            seed.Sessions.Add(RosterServiceTests.Session(b.ExerciseId, inA.Id, now.AddMinutes(30), now.AddHours(8)));
            seed.Sessions.Add(RosterServiceTests.Session(b.ExerciseId, inB.Id, now.AddMinutes(30), now.AddHours(8)));
            await seed.SaveChangesAsync();
        }

        await using var harness = RosterHarness.For(_fixture, a);
        var roster = (await harness.Query.ListAsync())!;

        var only = roster.Participants.Should().ContainSingle("exercise A's roster lists exercise A's people only").Subject;
        only.Id.Should().Be(inA.Id.ToString());
        only.LiveSessions.Should().Be(0, "Session is not exercise-scoped; a session bound to B never counts on A's roster");

        await using var all = _fixture.CreateContext();
        (await all.Accounts.IgnoreQueryFilters().AnyAsync(x => x.Id == inB.Id)).Should().BeTrue("B's person exists; A simply cannot see them");
    }

    [RequiresDockerFact]
    public async Task AnImportInA_NeverMatchesOrUpdatesAPersonInB_AndBsNamesNeverBlockAs()
    {
        var a = await RosterSeed.ExerciseAsync(_fixture);
        var b = await RosterSeed.ExerciseAsync(_fixture);
        var bPerson = await RosterSeed.AccountAsync(_fixture, b.ExerciseId, "jsmith", "Jane Smith", agency: "Fulco EM", email: "jane@example.test");
        await RosterSeed.PersonaAsync(_fixture, b.ExerciseId, "jane_smith", "human");

        await using (var harness = RosterHarness.For(_fixture, a))
        {
            // Every identity key of this row names B's person: sign-in name, email, and name + agency.
            var row = (await harness.Service.ImportAsync(
                Header + "Jane Smith,Fulco EM,Chief,jane@example.test,,jsmith\nJane Smith,Other,,,,", dryRun: false)).Report!.Rows;

            row[0].Status.Should().Be(RosterRowStatuses.Created, "B's person is invisible to A, so A's row creates A's own person");
            row[0].SignInName.Should().Be("jsmith", "B's sign-in name does not make it taken in A");
            row[0].PersonaHandle.Should().Be("jane_smith", "B's handle does not make it taken in A");
            row[1].SignInName.Should().Be("jsmith2", "only A's own names are stepped around");
        }

        await using var all = _fixture.CreateContext();
        var untouched = await all.Accounts.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == bPerson.Id);
        untouched.JobRole.Should().BeNull("A's import never updates B's person");
        untouched.ExerciseId.Should().Be(b.ExerciseId);
    }

    [RequiresDockerFact]
    public async Task EveryRowAnImportWrites_IsStampedWithTheResolvedScope()
    {
        var a = await RosterSeed.ExerciseAsync(_fixture);

        await using (var harness = RosterHarness.For(_fixture, a))
        {
            await harness.Service.ImportAsync(Header + "Riley Chen,,,,,\nTaylor Reed,,,,,", dryRun: false);
        }

        await using var all = _fixture.CreateContext();
        var accountIds = await all.Accounts.IgnoreQueryFilters().Where(x => x.DisplayName == "Riley Chen" || x.DisplayName == "Taylor Reed")
            .Where(x => x.ExerciseId == a.ExerciseId).Select(x => x.Id).ToListAsync();
        accountIds.Should().HaveCount(2);

        (await all.Personas.IgnoreQueryFilters().Where(p => p.ExerciseId == a.ExerciseId).CountAsync()).Should().Be(2);
        (await all.ParticipantLinks.IgnoreQueryFilters().Where(l => accountIds.Contains(l.AccountId)).Select(l => l.ExerciseId).ToListAsync())
            .Should().HaveCount(2).And.OnlyContain(id => id == a.ExerciseId);
        (await all.TelemetryEvents.IgnoreQueryFilters().Where(e => e.ExerciseId == a.ExerciseId).CountAsync()).Should().Be(3);
    }

    [RequiresDockerFact]
    public async Task AnUnresolvedOrEmptyScope_SeesNoRoster_AndWritesNothing()
    {
        var a = await RosterSeed.ExerciseAsync(_fixture);
        await RosterSeed.AccountAsync(_fixture, a.ExerciseId, "anna", "Anna In A");

        foreach (var scope in new Guid?[] { null, Guid.Empty })
        {
            await using var harness = RosterHarness.Create(_fixture, scope, a.StaffSession);

            (await harness.Query.ListAsync()).Should().BeNull("fail closed: no scope means no roster, never every exercise's");
            (await harness.Service.ImportAsync(Header + "Zed,,,,,", dryRun: false)).Outcome.Should().Be(RosterOutcome.Unauthenticated);
            (await harness.Service.AddAsync(new RosterRowWrite { Name = "Zed" })).Outcome.Should().Be(RosterOutcome.Unauthenticated);
        }

        await using var all = _fixture.CreateContext();
        (await all.Accounts.IgnoreQueryFilters().AnyAsync(x => x.DisplayName == "Zed")).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task AStaffUserOfB_ScopedToA_IsForbidden_EvenThoughTheyControlB()
    {
        var a = await RosterSeed.ExerciseAsync(_fixture);
        var b = await RosterSeed.ExerciseAsync(_fixture);

        // B's controller presents a request scoped to A, where they hold no assignment.
        await using var harness = RosterHarness.Create(_fixture, a.ExerciseId, b.StaffSession);

        (await harness.Service.ImportAsync(Header + "Zed,,,,,", dryRun: false)).Outcome.Should().Be(RosterOutcome.Forbidden);
        (await harness.Service.AddAsync(new RosterRowWrite { Name = "Zed" })).Outcome.Should().Be(RosterOutcome.Forbidden);
    }
}
