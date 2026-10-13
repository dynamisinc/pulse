namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/03 (Isolation AC, XC-001/COR-001 — always-Critical), extending the standing isolation suite
/// (<see cref="EasyLoginIsolationTests"/>, <c>QueryFilterIsolationTests</c>). Every test FAILS CLOSED: an account id from
/// exercise B is a <c>404</c> on exercise A indistinguishable from an unknown id (and B's rows provably exist and stay
/// untouched); a token minted in B and presented on A's host is the uniform <c>401</c> (and B learns nothing of it); the
/// session termination carries explicit <c>ExerciseId</c> AND <c>AccountId</c> predicates, so B's sessions survive every
/// action in A, even a session row in B that names A's account id; and an unset or empty scope reaches nothing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonalLinkIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PersonalLinkIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task StaffActions_OnAnotherExercisesAccountId_Are404_IndistinguishableFromAnUnknownId_AndTouchNothing()
    {
        var exerciseA = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var exerciseB = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var staffA = await PersonalLinkSeed.StaffAsync(_fixture, exerciseA.Id);
        var accountB = await PersonalLinkSeed.AccountAsync(_fixture, exerciseB.Id);
        var (linkB, tokenB) = await PersonalLinkSeed.LinkAsync(_fixture, accountB);
        var sessionB = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exerciseB.Id, accountB.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exerciseA.Hostname, staffA.RawToken);

        foreach (var action in new[] { "link/reissue", "link/revoke", "disable", "enable" })
        {
            using var crossExercise = await PersonalLinksTestHost.ActionAsync(staffClient, accountB.Id, action);
            using var unknown = await PersonalLinksTestHost.ActionAsync(staffClient, Guid.NewGuid(), action);

            crossExercise.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0}: B's account does not exist on A", action);
            unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
            crossExercise.Content.Headers.ContentType?.ToString().Should().Be(unknown.Content.Headers.ContentType?.ToString());
            Comparable(await PersonalLinksTestHost.JsonAsync(crossExercise)).Should().Be(
                Comparable(await PersonalLinksTestHost.JsonAsync(unknown)),
                "{0}: a cross-exercise id must be indistinguishable from an unknown one", action);
        }

        // B's rows exist (the 404 is the filter closing the door, not an empty table) and are untouched.
        await using var unfiltered = _fixture.CreateContext();
        var storedLink = await unfiltered.ParticipantLinks.IgnoreQueryFilters().AsNoTracking().SingleAsync(l => l.Id == linkB.Id);
        storedLink.TokenHash.Should().Be(ParticipantLinkTokens.Hash(tokenB));
        storedLink.RevokedAt.Should().BeNull();
        storedLink.Generation.Should().Be(1);
        (await unfiltered.Accounts.IgnoreQueryFilters().AsNoTracking().SingleAsync(a => a.Id == accountB.Id)).DisabledAt.Should().BeNull();
        (await PersonalLinkSeed.ReadSessionAsync(_fixture, sessionB.Id)).RevokedAt.Should().BeNull();
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exerciseB.Id)).Should().BeEmpty("nothing was done in B");
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exerciseA.Id)).Should().BeEmpty("a 404 is not an action");
    }

    [RequiresDockerFact]
    public async Task ATokenMintedInB_PresentedOnAsHost_IsTheUniform401_AndLeavesBUntouched()
    {
        var exerciseA = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var exerciseB = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var accountB = await PersonalLinkSeed.AccountAsync(_fixture, exerciseB.Id);
        var (_, tokenB) = await PersonalLinkSeed.LinkAsync(_fixture, accountB);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var onA = host.Client(exerciseA.Hostname);

        using var crossHost = await PersonalLinksTestHost.JoinAsync(onA, tokenB);
        using var unknown = await PersonalLinksTestHost.JoinAsync(onA, ParticipantLinkTokens.Generate());

        crossHost.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "B's token is not a token on A's host");
        unknown.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await crossHost.Content.ReadAsByteArrayAsync()).Should().BeEmpty();
        (await unknown.Content.ReadAsByteArrayAsync()).Should().BeEmpty();

        var storedB = await PersonalLinkSeed.ReadLinkAsync(_fixture, exerciseB.Id, accountB.Id);
        storedB!.UseCount.Should().Be(0, "a refused cross-host attempt is not a use of B's link");
        storedB.LastUsedAt.Should().BeNull();
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exerciseB.Id, accountB.Id)).LastLoginAt.Should().BeNull();

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Sessions.AsNoTracking().AnyAsync(s => s.AccountId == accountB.Id)).Should().BeFalse("no session was minted for B's account");
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exerciseB.Id)).Should().BeEmpty("B is never told of the attempt");
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exerciseA.Id)).Should().HaveCount(2).And.OnlyContain(
            e => e.Actor.Kind == "system" && e.Target == null, "A records two identity-less failures, naming nobody");
    }

    [RequiresDockerFact]
    public async Task SessionTermination_IsBoundedByExerciseAndAccount_BsSessionsSurviveEveryActionInA()
    {
        var exerciseA = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var exerciseB = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var staffA = await PersonalLinkSeed.StaffAsync(_fixture, exerciseA.Id);
        var accountA = await PersonalLinkSeed.AccountAsync(_fixture, exerciseA.Id);
        var neighbourA = await PersonalLinkSeed.AccountAsync(_fixture, exerciseA.Id);
        var accountB = await PersonalLinkSeed.AccountAsync(_fixture, exerciseB.Id);
        await PersonalLinkSeed.LinkAsync(_fixture, accountA);

        // The ExerciseId predicate's own witness: a session row bound to exercise B that names A's account id. Only an
        // explicit ExerciseId predicate keeps an action in A off it (Session has no global filter).
        var bNamingA = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exerciseB.Id, accountA.Id);
        var bOwn = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exerciseB.Id, accountB.Id);
        var aNeighbour = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exerciseA.Id, neighbourA.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exerciseA.Hostname, staffA.RawToken);

        foreach (var action in new[] { "link/reissue", "link/revoke", "disable", "enable" })
        {
            var aOwn = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exerciseA.Id, accountA.Id);

            using var response = await PersonalLinksTestHost.ActionAsync(staffClient, accountA.Id, action);
            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} on A's own participant", action);

            if (action == "enable")
            {
                (await PersonalLinkSeed.ReadSessionAsync(_fixture, aOwn.Id)).RevokedAt.Should().BeNull("enable ends nothing");
            }
            else
            {
                (await PersonalLinkSeed.ReadSessionAsync(_fixture, aOwn.Id)).RevokedAt.Should().NotBeNull("{0} ends A's own session", action);
            }

            (await PersonalLinkSeed.ReadSessionAsync(_fixture, bNamingA.Id)).RevokedAt.Should().BeNull(
                "{0} in A must never touch a session bound to B, even one naming A's account id", action);
            (await PersonalLinkSeed.ReadSessionAsync(_fixture, bOwn.Id)).RevokedAt.Should().BeNull("{0}: B's own sessions are untouched", action);
            (await PersonalLinkSeed.ReadSessionAsync(_fixture, aNeighbour.Id)).RevokedAt.Should().BeNull(
                "{0}: only the target account's sessions end", action);
        }
    }

    [RequiresDockerTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StaffActions_WithAnUnsetOrEmptyScope_ReachNothing(bool emptyGuid)
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var session = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        Guid? scope = emptyGuid ? Guid.Empty : null;

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        var service = AccessService(context, scope, staff);

        foreach (var run in new Func<Guid, Task<ParticipantAccessResult>>[]
        {
            id => service.ReissueAsync(id),
            id => service.RevokeAsync(id),
            id => service.DisableAsync(id),
            id => service.EnableAsync(id),
        })
        {
            (await run(account.Id)).Outcome.Should().Be(ParticipantAccessOutcome.Unauthenticated, "an unresolved scope fails closed");
        }

        (await PersonalLinkSeed.ReadSessionAsync(_fixture, session.Id)).RevokedAt.Should().BeNull();
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).DisabledAt.Should().BeNull();
        (await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id)).Should().BeNull("no link was issued");
    }

    [RequiresDockerFact]
    public async Task StaffActions_ByAStaffSessionBoundToAnotherExercise_FailClosed_EvenIfTheScopeSaysA()
    {
        // Defence in depth: the service re-checks that the staff session's bound exercise IS the resolved scope.
        var exerciseA = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var exerciseB = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var staffOnB = await PersonalLinkSeed.StaffAsync(_fixture, exerciseB.Id);
        var accountA = await PersonalLinkSeed.AccountAsync(_fixture, exerciseA.Id);

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseA.Id });
        var result = await AccessService(context, exerciseA.Id, staffOnB).DisableAsync(accountA.Id);

        result.Outcome.Should().Be(ParticipantAccessOutcome.Unauthenticated);
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exerciseA.Id, accountA.Id)).DisabledAt.Should().BeNull();
    }

    private static ParticipantAccessService AccessService(PulseDbContext context, Guid? scope, SeededStaff staff) =>
        new(
            context,
            new ExerciseContext { CurrentExerciseId = scope },
            new StubCurrentStaffSessionAccessor(staff.Current),
            PersonalLinkSeed.LinkService(context, scope),
            new RosterLinkDtoFactory(PersonalLinkSeed.Protector(), new JoinUrlBuilder(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build())),
            new ExerciseFactsReader(context),
            new ManualTimeProvider(DateTimeOffset.UtcNow));

    /// <summary>A ProblemDetails body without its per-request trace id.</summary>
    private static string Comparable(JsonElement problem) =>
        string.Join("|", problem.EnumerateObject()
            .Where(p => p.Name != "traceId")
            .OrderBy(p => p.Name, StringComparer.Ordinal)
            .Select(p => $"{p.Name}={p.Value}"));
}
