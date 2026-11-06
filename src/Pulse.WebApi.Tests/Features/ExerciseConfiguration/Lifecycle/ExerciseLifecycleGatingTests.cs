namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <b>AC3 / AC4 — the participant fail-closed gate, end to end over real HTTP and real SQL.</b> In
/// <c>build</c> / <c>archived</c> the participant surface is NOT SERVED; in <c>completed</c> it is the ended,
/// read-only review (Tom, 2026-10-19) — reads served, writes refused; staff sessions and the pre-auth allowlist are
/// untouched.
/// </summary>
/// <remarks>
/// <b>Why <c>/api/feed</c> is asserted by name, with a seeded post.</b> A shell-variant projection returning
/// <c>readOnly</c> would satisfy AC3's wording while <c>/api/feed</c> still handed a participant the posts of
/// an ARCHIVED world. Every refusal case below therefore asserts (a) the status is 403 and (b) the seeded
/// post body appears nowhere in the response — and the <c>live</c> control proves the same feed DOES serve
/// that post, so a refusal is the gate closing the door rather than an empty table.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseLifecycleGatingTests
{
    private const string SeededPostBody = "AN ARCHIVED WORLD MUST NEVER SERVE THIS";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseLifecycleGatingTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// AC3, the headline case: an archived/build world serves no feed at all. (<c>completed</c> used to be on this
    /// list; since the ended, read-only review it serves reads — see
    /// <see cref="InCompleted_TheFeedIsServed_ButThePostWriteIsRefused"/>.)
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    public async Task InBuildOrArchived_TheParticipantFeedIsNotServed(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "COR-032: '{0}' is not participant-accessible, and accepts no participant reads either", state);
        (await response.Content.ReadAsStringAsync()).Should().NotContain(
            SeededPostBody, "a projection returning readOnly would tick AC3 and still leak this post");
    }

    /// <summary>The control that makes the refusal meaningful: the very same feed DOES serve when Live.</summary>
    [RequiresDockerFact]
    public async Task InLive_TheSameFeedServesTheSeededPost()
    {
        var exerciseId = await SeedAsync("live", withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Contain(
            SeededPostBody, "so a 403 above is the gate closing the door, not an empty table");
    }

    /// <summary>The covered GET routes this slice host maps: the social reads and all six shell GETs.</summary>
    private static readonly string[] CoveredGetRouteList =
    [
        "/api/feed",
        "/api/personas",
        "/api/shell-state",
        "/api/chrome-config",
        "/api/brand-tokens",
        "/api/channel-nav-config",
        "/api/alerts",
        "/api/overlay-state",
    ];

    /// <summary>The covered GET routes, as theory data.</summary>
    public static TheoryData<string> CoveredGetRoutes => new(CoveredGetRouteList);

    /// <summary>The two states that stay FULLY closed (verb-blind), crossed with every covered GET route.</summary>
    public static TheoryData<string, string> ClosedStatesByCoveredGetRoute
    {
        get
        {
            var data = new TheoryData<string, string>();
            foreach (var state in new[] { "build", "archived" })
            {
                foreach (var route in CoveredGetRouteList)
                {
                    data.Add(state, route);
                }
            }

            return data;
        }
    }

    /// <summary>AC3: in build and archived every covered route — the social ones and all six shell GETs — is refused.</summary>
    [RequiresDockerTheory]
    [MemberData(nameof(ClosedStatesByCoveredGetRoute))]
    public async Task InBuildOrArchived_EveryCoveredGetRouteIsRefused(string state, string route)
    {
        var exerciseId = await SeedAsync(state, withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "{0} is a covered participant-world route and '{1}' serves no reads", route, state);
    }

    /// <summary>
    /// The ended, read-only review (Tom, 2026-10-19): in <c>completed</c> every covered GET this host maps is SERVED to
    /// a participant. The full route set (pinned, follow graph, suggestions, edit history) is driven through the real
    /// <c>Program</c> host in <c>EndedReadOnlyReviewGatingTests</c>.
    /// </summary>
    [RequiresDockerTheory]
    [MemberData(nameof(CoveredGetRoutes))]
    public async Task InCompleted_EveryCoveredGetRouteIsServed(string route)
    {
        var exerciseId = await SeedAsync("completed", withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.OK, "{0} is a participant READ, and a completed exercise accepts participant reads", route);
    }

    /// <summary>AC3: the templated thread read is covered too.</summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    public async Task InBuildOrArchived_TheThreadReadIsRefused(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(
            new Uri($"/api/threads/{Guid.NewGuid()}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    /// <summary>AC3: the one participant WRITE is refused before the handler runs, so nothing is persisted.</summary>
    [RequiresDockerFact]
    public async Task InArchived_ThePostWriteIsRefusedBeforeTheHandlerRuns()
    {
        var exerciseId = await SeedAsync("archived", withPost: false);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/posts", UriKind.Relative), NewPostBody());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await using var context = _fixture.CreateContext();
        var written = await context.Posts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(p => p.ExerciseId == exerciseId);

        written.Should().Be(0, "the gate short-circuits ahead of the ingest service — nothing partial is written");
    }

    /// <summary>
    /// <b>The ended, read-only review (Tom, 2026-10-19), replacing decision 2's overlay-only carve-out.</b> In
    /// <c>completed</c> the feed is SERVED (with the run's content) and the overlay endpoint answers too, but the
    /// participant post write is refused by the gate with <c>403</c> before its handler runs, so nothing is written.
    /// This test used to pin "completed feed → 403"; that is now wrong by design.
    /// </summary>
    [RequiresDockerFact]
    public async Task InCompleted_TheFeedIsServed_ButThePostWriteIsRefused()
    {
        var exerciseId = await SeedAsync("completed", withPost: true);
        await using var host = await StartAsync(exerciseId);

        var feed = await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative));
        feed.StatusCode.Should().Be(HttpStatusCode.OK, "a completed run's content stays readable to participants");
        (await feed.Content.ReadAsStringAsync()).Should().Contain(
            SeededPostBody, "the review serves the run's real content, not an empty page");

        (await host.Client.GetAsync(new Uri("/api/overlay-state", UriKind.Relative))).StatusCode.Should().Be(
            HttpStatusCode.OK, "the overlay endpoint carries the 'ended' flag the shell renders");

        var write = await host.Client.PostAsJsonAsync(new Uri("/api/posts", UriKind.Relative), NewPostBody());
        write.StatusCode.Should().Be(HttpStatusCode.Forbidden, "every participant write is refused once the exercise has ended");

        await using var context = _fixture.CreateContext();
        (await context.Posts.IgnoreQueryFilters().AsNoTracking().CountAsync(p => p.ExerciseId == exerciseId))
            .Should().Be(1, "only the seeded post exists: the gate short-circuits ahead of the ingest service");
    }

    /// <summary>
    /// Decision 2's boundary: the carve-out is <c>completed</c> alone. <c>build</c> and <c>archived</c> stay
    /// FULLY closed, so AC3's letter still holds for those two — there is no EndEx to show in either.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    [InlineData("running")]
    public async Task InBuildOrArchived_EvenTheOverlayEndpointIsRefused(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: false);
        await using var host = await StartAsync(exerciseId);

        (await host.Client.GetAsync(new Uri("/api/overlay-state", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.Forbidden, "'{0}' has no overlay a participant may see", state);
    }

    /// <summary>AC3: Staged, Live and Paused are served. Paused in particular — the holding page must render.</summary>
    [RequiresDockerTheory]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    public async Task InStagedLiveOrPaused_TheParticipantSurfaceIsServed(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: true);
        await using var host = await StartAsync(exerciseId);

        (await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK);
        (await host.Client.GetAsync(new Uri("/api/overlay-state", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK, "a paused world must still be able to serve its holding page (AC6)");
    }

    /// <summary>
    /// A legacy row is gated by its MAPPED state, not by its spelling: <c>complete</c> reads as <c>completed</c>, whose
    /// participant READS are served (the ended, read-only review).
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("active", HttpStatusCode.OK)]
    [InlineData("scheduled", HttpStatusCode.Forbidden)]
    [InlineData("complete", HttpStatusCode.OK)]
    public async Task ALegacyRow_IsGatedByItsMappedState(string legacy, HttpStatusCode expected)
    {
        var exerciseId = await SeedAsync(legacy, withPost: true);
        await using var host = await StartAsync(exerciseId);

        (await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative))).StatusCode.Should().Be(expected);
    }

    /// <summary>Fail closed: an unrecognized status literal serves no participant anything.</summary>
    [RequiresDockerFact]
    public async Task AnUnknownStatusLiteral_FailsClosed()
    {
        var exerciseId = await SeedAsync("running", withPost: true);
        await using var host = await StartAsync(exerciseId);

        (await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.Forbidden, "a typo in the column must blank the world, not open an unknown one");
    }

    /// <summary>AC4: a live STAFF session is exempt — staff working in Build is the point of Build.</summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("completed")]
    [InlineData("archived")]
    public async Task AStaffSession_IsExemptFromTheGate(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: true);
        await using var host = await StartAsync(exerciseId, authenticatedStaff: true);

        (await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK, "staff must be able to work in a '{0}' exercise", state);
        (await host.Client.GetAsync(new Uri("/api/shell-state", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK, "including previewing the participant shell as they build it");
    }

    /// <summary>
    /// AC4: the staff exemption is a LIFECYCLE exemption, not an authorization decision — it does not require
    /// an assignment to the resolved exercise (every staff-only endpoint carries its own COR-005 gate).
    /// </summary>
    [RequiresDockerFact]
    public async Task TheStaffExemption_DoesNotDoubleAsAnAuthorizationGate()
    {
        var exerciseId = await SeedAsync("build", withPost: true);
        await using var host = await StartAsync(exerciseId, authenticatedStaff: true, seedStaffAssignment: false);

        (await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK, "the gate asks 'is this a staff session', not 'is this staff authorized'");
    }

    /// <summary>
    /// <b>AC4's subtlest claim, named directly (reviewer S-005):</b> a COR-015 shared read-only
    /// (<c>readonly</c>-KIND) session lands on the PARTICIPANT side of the staff exemption. It is a view-only
    /// observer of the fiction, not a staff console, so a build-state exercise refuses it exactly as it refuses
    /// a participant.
    /// </summary>
    /// <remarks>
    /// Driven through the REAL <see cref="CurrentStaffSessionAccessor"/> over real session rows rather than the
    /// stub, and paired with a live <c>staff</c>-kind session on the same host — otherwise a mis-wired accessor
    /// would make the refusal vacuous (everything would be gated). The staff control proves the exemption is
    /// genuinely reachable on this host and that the read-only kind is what excludes the observer from it.
    /// </remarks>
    [RequiresDockerFact]
    public async Task ASharedReadOnlySession_IsGatedLikeAParticipant_NotExemptAsStaff()
    {
        var exerciseId = await SeedAsync("build", withPost: true);
        var readOnlyToken = await SeedSessionAsync(exerciseId, kind: "readonly", staffUserId: null);
        var staffToken = await SeedSessionAsync(exerciseId, kind: "staff", staffUserId: Guid.NewGuid());

        await using var host = await StartAsync(exerciseId, configureServices: UseTheRealStaffSessionAccessor);

        var observer = await host.Client.SendAsync(FeedRequestWith(readOnlyToken));
        observer.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "a COR-015 shared observer is a participant-world viewer — the staff exemption is for staff KINDS only");
        (await observer.Content.ReadAsStringAsync()).Should().NotContain(
            SeededPostBody, "the observer must not be handed a build-state world's posts");

        var staff = await host.Client.SendAsync(FeedRequestWith(staffToken));
        staff.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "the control: the same host DOES exempt a live staff-kind session, so the refusal above is the KIND, " +
            "not a mis-wired accessor gating everyone");
    }

    /// <summary>
    /// The ended, read-only review applies to a COR-015 shared read-only (<c>readonly</c>-kind) session exactly as to a
    /// participant: in <c>completed</c> it may READ the feed, its write is refused by the gate (403), and in
    /// <c>archived</c> even the read is refused. Driven through the real token-backed staff-session accessor, so the
    /// observer is provably not riding the staff exemption.
    /// </summary>
    [RequiresDockerFact]
    public async Task ASharedReadOnlySession_InCompleted_ReadsButCannotWrite_AndInArchivedIsRefused()
    {
        var completed = await SeedAsync("completed", withPost: true);
        var completedToken = await SeedSessionAsync(completed, kind: "readonly", staffUserId: null);

        await using (var host = await StartAsync(completed, configureServices: UseTheRealStaffSessionAccessor))
        {
            var read = await host.Client.SendAsync(FeedRequestWith(completedToken));
            read.StatusCode.Should().Be(HttpStatusCode.OK, "a shared observer may read an ended exercise like a participant");
            (await read.Content.ReadAsStringAsync()).Should().Contain(SeededPostBody);

            using var write = new HttpRequestMessage(HttpMethod.Post, new Uri("/api/posts", UriKind.Relative))
            {
                Content = JsonContent.Create(NewPostBody()),
            };
            write.Headers.Authorization = new AuthenticationHeaderValue("Bearer", completedToken);
            (await host.Client.SendAsync(write)).StatusCode.Should().Be(
                HttpStatusCode.Forbidden, "no write reaches an ended exercise, whoever the non-staff caller is");
        }

        var archived = await SeedAsync("archived", withPost: true);
        var archivedToken = await SeedSessionAsync(archived, kind: "readonly", staffUserId: null);

        await using (var host = await StartAsync(archived, configureServices: UseTheRealStaffSessionAccessor))
        {
            var read = await host.Client.SendAsync(FeedRequestWith(archivedToken));
            read.StatusCode.Should().Be(HttpStatusCode.Forbidden, "an archived world serves no reads, to an observer either");
            (await read.Content.ReadAsStringAsync()).Should().NotContain(SeededPostBody);
        }
    }

    /// <summary>AC4: an un-listed route (the pre-auth allowlist stand-in) is untouched in every state.</summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    public async Task ThePreAuthAllowlistIsNeverGated(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: false);
        await using var host = await StartAsync(exerciseId);

        (await host.Client.GetAsync(new Uri("/api/exercise-context", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK, "gating the resolver endpoint would strand every client, staff included");
    }

    /// <summary>
    /// An unresolved scope stays the endpoints' own fail-closed <c>401</c> — the gate must not relabel an
    /// unauthenticated request as a forbidden one, nor change six endpoints' shipped status contract.
    /// </summary>
    [RequiresDockerFact]
    public async Task WithAnUnresolvedScope_TheGatePassesThroughToTheEndpointsOwn401()
    {
        await using var host = await StartAsync(currentExerciseId: null);

        (await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
        (await host.Client.GetAsync(new Uri("/api/shell-state", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// Isolation (always-Critical): the gate reads the SERVER-resolved exercise only. A request that names a
    /// different, live exercise in its query string is still refused by the archived world it is scoped to.
    /// </summary>
    [RequiresDockerFact]
    public async Task TheGateReadsTheResolvedScopeOnly_ANamedOtherExerciseChangesNothing()
    {
        var archived = await SeedAsync("archived", withPost: true);
        var live = await SeedAsync("live", withPost: false);

        await using var host = await StartAsync(archived);

        var response = await host.Client.GetAsync(
            new Uri($"/api/feed?exerciseId={live}", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "a client-supplied exercise id is never a scope selector (COR-001) — it cannot unlock another world");
    }

    /// <summary>Swaps the stubbed staff-session accessor for the REAL token-backed one (see the S-005 test).</summary>
    private static void UseTheRealStaffSessionAccessor(IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.RemoveAll<ICurrentStaffSessionAccessor>();
        services.AddScoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>();
    }

    private static HttpRequestMessage FeedRequestWith(string rawToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/api/feed", UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", rawToken);
        return request;
    }

    private static object NewPostBody() => new
    {
        authorPersonaId = Guid.NewGuid().ToString(),
        text = "should never be persisted",
        scenarioTime = "2033-03-01T12:00:00Z",
        timeZone = "UTC",
        origin = "participant",
    };

    private async Task<Guid> SeedAsync(string status, bool withPost)
    {
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        if (withPost)
        {
            context.Posts.Add(ExerciseLifecycleTestData.PostIn(exerciseId, SeededPostBody));
        }

        await context.SaveChangesAsync();

        return exerciseId;
    }

    /// <summary>Seeds a live session row of the given kind and returns the RAW token to present.</summary>
    private async Task<string> SeedSessionAsync(Guid exerciseId, string kind, Guid? staffUserId)
    {
        var rawToken = SessionTokens.Generate();
        var now = DateTimeOffset.UtcNow;

        await using var context = _fixture.CreateContext();
        context.Sessions.Add(new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = (staffUserId ?? Guid.NewGuid()).ToString(),
            StaffUserId = staffUserId,
            Role = staffUserId is null ? "participant" : "controller",
            ActingHumanId = $"human-{Guid.NewGuid()}",
            IsReadOnly = staffUserId is null,
            IssuedAt = now,
            ExpiresAt = now.AddHours(1),
        });

        await context.SaveChangesAsync();

        return rawToken;
    }

    private Task<ExerciseLifecycleTestHost> StartAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = false,
        bool seedStaffAssignment = true,
        Action<IServiceCollection>? configureServices = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        return ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            authenticatedStaff,
            seedStaffAssignment: seedStaffAssignment,
            configureServices: configureServices);
    }
}
