namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// <b>Easy-login story 06 lifecycle pin (EL-11), as amended by the one-rule ruling (Tom, 2026-10-19).</b> A day-long
/// participant session in a <c>completed</c> exercise refreshes into a live session and keeps the EXISTING
/// lifecycle-gate behaviour — participant data routes <c>403</c>, and <c>/api/overlay-state</c> served (COR-054's EndEx
/// overlay) — and its refresh is NOT refused. Refusing refresh at EndEx would sign participants out underneath the
/// overlay they are meant to see; this pin stops a later change from doing that silently. In <c>build</c> and
/// <c>archived</c> participant reads are refused, so under the one rule the refresh is refused too.
/// </summary>
/// <remarks>
/// The session is minted by the real <see cref="SessionIssuer"/> (day-capped) and renewed by the real
/// <see cref="SessionService"/>; its refreshed access token is then presented to the real gate through the real
/// token-backed <see cref="CurrentStaffSessionAccessor"/>, so a participant session is proven NOT to slip through the
/// staff exemption. The host's scope is the session's own bound exercise, as the session middleware sets it.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantDayLongLifecyclePinTests
{
    private const string SeededPostBody = "ENDEX MUST NOT SERVE THIS FEED";

    private readonly MsSqlContainerFixture _fixture;

    public ParticipantDayLongLifecyclePinTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData("completed", HttpStatusCode.OK)]
    public async Task AfterEndEx_ADayLongParticipantSession_StillRefreshes_AndTheGateBehavesAsBefore(
        string state,
        HttpStatusCode expectedOverlay)
    {
        var (exerciseId, issued) = await SeedAndIssueAsync(state);

        RefreshResult refreshed;
        await using (var refreshContext = _fixture.CreateContext())
        {
            refreshed = await ServiceFor(refreshContext).RefreshAsync(issued.RefreshToken);
        }

        refreshed.Outcome.Should().Be(
            RefreshOutcome.Refreshed, "EL-11: refresh is deliberately not refused in a '{0}' exercise", state);

        // Gate-1 S-1: the refreshed access token is a LIVE session, not merely a successful refresh response.
        await using (var sessionContext = _fixture.CreateContext())
        {
            var current = await ServiceFor(sessionContext).GetCurrentAsync(refreshed.SessionToken);
            current.Outcome.Should().Be(
                SessionQueryOutcome.Live, "after EndEx the refreshed participant session still resolves (GET /api/session 200)");
            current.Session!.ExerciseId.Should().Be(exerciseId, "and stays bound to its own exercise");
        }

        await using var host = await ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            exerciseId,
            configureServices: UseTheRealStaffSessionAccessor);

        var feed = await host.Client.SendAsync(RequestWith("/api/feed", refreshed.SessionToken!));
        feed.StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "participant data routes stay refused in '{0}', refreshed token or not", state);
        (await feed.Content.ReadAsStringAsync()).Should().NotContain(SeededPostBody);

        var overlay = await host.Client.SendAsync(RequestWith("/api/overlay-state", refreshed.SessionToken!));
        overlay.StatusCode.Should().Be(
            expectedOverlay, "the overlay carve-out is unchanged: served in completed (EndEx)");
    }

    /// <summary>
    /// One rule for all (2026-10-19): in <c>build</c> and <c>archived</c> participant reads are refused, so the same
    /// day-long participant session's refresh is refused too (the ordinary fail-closed 401, no rotation).
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    public async Task InAStateThatRefusesParticipantReads_ADayLongParticipantSession_IsNotRefreshed(string state)
    {
        var (_, issued) = await SeedAndIssueAsync(state);

        RefreshResult refreshed;
        await using (var refreshContext = _fixture.CreateContext())
        {
            refreshed = await ServiceFor(refreshContext).RefreshAsync(issued.RefreshToken);
        }

        refreshed.Outcome.Should().Be(
            RefreshOutcome.Invalid, "a '{0}' exercise refuses participant reads, so it refuses the participant refresh", state);
        refreshed.SessionToken.Should().BeNull();
    }

    /// <summary>Seeds an exercise in <paramref name="state"/> with one post and one enabled account, and issues that account a real day-capped participant session.</summary>
    private async Task<(Guid ExerciseId, SessionIssueResult Issued)> SeedAndIssueAsync(string state)
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, state));
            seed.Posts.Add(ExerciseLifecycleTestData.PostIn(exerciseId, SeededPostBody));

            // A real, enabled account: refresh renews a participant session only while one exists in its exercise
            // (easy-login Gate-2 S-1, fail closed).
            seed.Accounts.Add(new Account
            {
                Id = accountId,
                ExerciseId = exerciseId,
                Username = $"pin{accountId:N}"[..30],
                DisplayName = "Pat Participant",
                CreatedAt = DateTimeOffset.UtcNow,
                Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = "participant" },
            });
            await seed.SaveChangesAsync();
        }

        SessionIssueResult issued;
        await using (var issueContext = _fixture.CreateContext())
        {
            issued = await IssuerFor(issueContext).IssueAsync(ParticipantRequest(exerciseId, accountId));
        }

        issued.Session.RefreshExpiresAt.Should().Be(
            ExerciseDay.EndOfDayUtc("UTC", issued.Session.IssuedAt, 0), "the session under test is a day-capped one");
        return (exerciseId, issued);
    }

    private static SessionIssuer IssuerFor(PulseDbContext context) => new(
        context,
        Options.Create(new SessionOptions()),
        new ExerciseFactsReader(context),
        Options.Create(new EasyLoginOptions()),
        TimeProvider.System,
        NullLogger<SessionIssuer>.Instance);

    private static SessionService ServiceFor(PulseDbContext context) => new(
        context,
        Options.Create(new SessionOptions()),
        new ExerciseFactsReader(context),
        Options.Create(new EasyLoginOptions()),
        TimeProvider.System,
        NullLogger<SessionService>.Instance,
        TestScenarioNow.Over(context));

    private static SessionIssueRequest ParticipantRequest(Guid exerciseId, Guid accountId)
    {
        return new SessionIssueRequest
        {
            ExerciseId = exerciseId,
            Kind = "participant",
            Role = "participant",
            PrincipalId = accountId.ToString(),
            ActingHumanId = accountId.ToString(),
            IsReadOnly = false,
            AccountId = accountId,
        };
    }

    /// <summary>Swaps the stubbed staff-session accessor for the REAL token-backed one (as the S-005 gating test does).</summary>
    private static void UseTheRealStaffSessionAccessor(IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.RemoveAll<ICurrentStaffSessionAccessor>();
        services.AddScoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>();
    }

    private static HttpRequestMessage RequestWith(string route, string rawToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri(route, UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", rawToken);
        return request;
    }
}
