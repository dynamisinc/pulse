namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <b>AC3 / AC4 — the participant fail-closed gate, end to end over real HTTP and real SQL.</b> In
/// <c>build</c> / <c>completed</c> / <c>archived</c> the participant surface is NOT SERVED; staff sessions
/// and the pre-auth allowlist are untouched.
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

    /// <summary>AC3, the headline case: an archived/build/completed world serves no feed at all.</summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("completed")]
    [InlineData("archived")]
    public async Task InBuildCompletedOrArchived_TheParticipantFeedIsNotServed(string state)
    {
        var exerciseId = await SeedAsync(state, withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/feed", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "COR-032: participants access Staged and Live only — '{0}' is not participant-accessible", state);
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

    /// <summary>AC3: every covered route — the four social ones and all six shell GETs — is refused.</summary>
    [RequiresDockerTheory]
    [InlineData("/api/feed")]
    [InlineData("/api/personas")]
    [InlineData("/api/shell-state")]
    [InlineData("/api/chrome-config")]
    [InlineData("/api/brand-tokens")]
    [InlineData("/api/channel-nav-config")]
    [InlineData("/api/alerts")]
    [InlineData("/api/overlay-state")]
    public async Task InArchived_EveryCoveredGetRouteIsRefused(string route)
    {
        var exerciseId = await SeedAsync("archived", withPost: true);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "{0} is a covered participant-world route", route);
    }

    /// <summary>AC3: the templated thread read is covered too.</summary>
    [RequiresDockerFact]
    public async Task InArchived_TheThreadReadIsRefused()
    {
        var exerciseId = await SeedAsync("archived", withPost: true);
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

    /// <summary>A legacy row is gated by its MAPPED state, not by its spelling.</summary>
    [RequiresDockerTheory]
    [InlineData("active", HttpStatusCode.OK)]
    [InlineData("scheduled", HttpStatusCode.Forbidden)]
    [InlineData("complete", HttpStatusCode.Forbidden)]
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

    private Task<ExerciseLifecycleTestHost> StartAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = false,
        bool seedStaffAssignment = true)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        return ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            authenticatedStaff,
            seedStaffAssignment: seedStaffAssignment);
    }
}
