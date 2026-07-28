namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The staff lifecycle HTTP surface over real SQL: the status contract (200/400/401/403/404/409), the staff
/// gate, and the isolation guarantee that a transition can only ever touch the SERVER-resolved exercise.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseLifecycleEndpointsTests
{
    private const string LifecycleRoute = "/api/staff/exercise-lifecycle";
    private const string TransitionRoute = "/api/staff/exercise-lifecycle/transition";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseLifecycleEndpointsTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>AC2: the read exposes the canonical state, its allowed transitions and its behaviour hooks.</summary>
    [RequiresDockerFact]
    public async Task GetLifecycle_ReturnsTheStateItsAllowedTransitionsAndItsBehaviourHooks()
    {
        var exerciseId = await SeedAsync("build");
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri(LifecycleRoute, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var root = await ReadJsonAsync(response);
        root.GetProperty("state").GetString().Should().Be("build");
        root.GetProperty("allowedTransitions").EnumerateArray().Select(e => e.GetString())
            .Should().Equal(["staged"]);
        root.GetProperty("behaviour").GetProperty("clockRuns").GetBoolean().Should().BeFalse();
        root.GetProperty("exerciseId").GetString().Should().Be(exerciseId.ToString());
    }

    /// <summary>AC2: an allowed transition returns 200 with the new state and persists it.</summary>
    [RequiresDockerFact]
    public async Task Transition_Allowed_Returns200AndPersistsTheNewState()
    {
        var exerciseId = await SeedAsync("staged");
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri(TransitionRoute, UriKind.Relative), new { to = "live" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(response)).GetProperty("state").GetString().Should().Be("live");
        (await ReadStatusAsync(exerciseId)).Should().Be("live");
    }

    /// <summary>AC2, the headline: a disallowed transition is a 409 and the state does not change.</summary>
    [RequiresDockerTheory]
    [InlineData("build", "live")]
    [InlineData("staged", "completed")]
    [InlineData("live", "archived")]
    [InlineData("archived", "live")]
    [InlineData("live", "live")]
    public async Task Transition_Disallowed_Returns409AndChangesNothing(string from, string to)
    {
        var exerciseId = await SeedAsync(from);
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri(TransitionRoute, UriKind.Relative), new { to });

        response.StatusCode.Should().Be(
            HttpStatusCode.Conflict, "'{0}' -> '{1}' is not a COR-032 transition", from, to);
        (await ReadStatusAsync(exerciseId)).Should().Be(from, "a refused transition leaves the state untouched");
    }

    /// <summary>A target outside the vocabulary is a 400, distinctly from the machine's 409.</summary>
    [RequiresDockerTheory]
    [InlineData("ended")]
    [InlineData("in_progress")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Transition_WithANonVocabularyTarget_Returns400(string? to)
    {
        var exerciseId = await SeedAsync("live");
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri(TransitionRoute, UriKind.Relative), new { to });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "'{0}' is not a COR-032 literal", to ?? "(null)");
        (await ReadStatusAsync(exerciseId)).Should().Be("live", "a rejected request persists nothing");
    }

    /// <summary>
    /// A LEGACY target literal is accepted (the four stay valid through the transition) but always persists
    /// the CANONICAL spelling — so no request can write <c>complete</c> back into the column.
    /// </summary>
    [RequiresDockerFact]
    public async Task Transition_WithALegacyTargetLiteral_PersistsTheCanonicalSpelling()
    {
        var exerciseId = await SeedAsync("live");
        await using var host = await StartAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri(TransitionRoute, UriKind.Relative), new { to = "complete" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "'complete' folds onto the canonical 'completed'");
        (await ReadStatusAsync(exerciseId)).Should().Be(
            "completed", "COR-032 names the state 'completed' — the legacy spelling is never written back");
    }

    /// <summary>XC-002: no staff session, no lifecycle surface — fail closed with 401.</summary>
    [RequiresDockerFact]
    public async Task WithoutAStaffSession_BothRoutesAre401()
    {
        var exerciseId = await SeedAsync("live");
        await using var host = await StartAsync(exerciseId, authenticatedStaff: false);

        (await host.Client.GetAsync(new Uri(LifecycleRoute, UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);

        var transition = await host.Client.PostAsJsonAsync(
            new Uri(TransitionRoute, UriKind.Relative), new { to = "paused" });
        transition.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await ReadStatusAsync(exerciseId)).Should().Be("live");
    }

    /// <summary>An unresolved scope fails closed with 401 — never a default/empty 200.</summary>
    [RequiresDockerFact]
    public async Task WithAnUnresolvedScope_TheReadIs401()
    {
        await using var host = await StartAsync(currentExerciseId: null);

        (await host.Client.GetAsync(new Uri(LifecycleRoute, UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// <b>AC9 — the cross-exercise transition attempt (isolation, always-Critical).</b> There is no exercise
    /// id anywhere in the surface, so the only way to aim at another exercise is to hold a staff session
    /// assigned elsewhere — which the shared COR-005 gate refuses with 403, leaving BOTH exercises untouched.
    /// </summary>
    [RequiresDockerFact]
    public async Task ACrossExerciseTransitionAttempt_Is403AndMovesNeitherExercise()
    {
        var target = await SeedAsync("live");
        var otherExercise = await SeedAsync("build");

        // A staff caller whose assignment is to a DIFFERENT exercise than the resolved scope.
        await using var host = await StartAsync(
            target, authenticatedStaff: true, assignedExerciseId: otherExercise);

        var response = await host.Client.PostAsJsonAsync(
            new Uri(TransitionRoute, UriKind.Relative), new { to = "paused" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "COR-005: staff must be assigned to the resolved exercise");
        (await ReadStatusAsync(target)).Should().Be("live", "the resolved exercise must not move");
        (await ReadStatusAsync(otherExercise)).Should().Be(
            "build", "and the exercise the caller IS assigned to must not move either — it was never the scope");
    }

    /// <summary>The route surface takes no exercise id, so an id in the query string is simply ignored.</summary>
    [RequiresDockerFact]
    public async Task AClientSuppliedExerciseId_IsNeverAScopeSelector()
    {
        var scoped = await SeedAsync("staged");
        var otherExercise = await SeedAsync("staged");

        await using var host = await StartAsync(scoped);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"{TransitionRoute}?exerciseId={otherExercise}", UriKind.Relative), new { to = "live" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStatusAsync(scoped)).Should().Be("live", "the SERVER-resolved scope is the only target");
        (await ReadStatusAsync(otherExercise)).Should().Be(
            "staged", "a client-supplied id is the exact cross-exercise vector COR-001 forbids");
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task<Guid> SeedAsync(string status)
    {
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        await context.SaveChangesAsync();

        return exerciseId;
    }

    private async Task<string> ReadStatusAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.Exercises.AsNoTracking()
            .Where(e => e.Id == exerciseId).Select(e => e.Status).SingleAsync();
    }

    private Task<ExerciseLifecycleTestHost> StartAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        return ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            authenticatedStaff,
            assignedExerciseId);
    }
}
