namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// HTTP tests for the participant read <c>GET /api/overlay-state</c> (world-steering/08; CTL-023, COR-001,
/// XC-001, XC-002) over a host composed exactly as <c>Program.cs</c> composes it — 01b's
/// <c>AddExerciseConfiguration()</c> defaults, then <c>AddExerciseLifecycle()</c>'s projections, then this
/// story's <c>AddPauseParticipantOverlay()</c> — against the shared migrated real SQL Server.
///
/// <para><b>This story no longer edits the endpoint (Tom's ruling, 2026-07-27).</b> The handler in the shared
/// <c>ParticipantShellEndpoints.cs</c> is byte-identical to <c>main</c>; the pause state reaches participants by
/// contributing <see cref="SteeringPauseOverlayProjection"/> to the <see cref="IOverlayStateProjection"/> seam
/// behind it, which composes the lifecycle rather than bypassing it. So these tests now drive a REAL exercise row
/// (the projection needs its lifecycle status) and are Docker-gated, where before they ran against a bespoke
/// database-free host.</para>
///
/// <para>Proves the route serves the LIVE per-exercise pause state rather than a constant (so a participant who
/// joins or refreshes MID-Freeze still lands on the holding page — AC4), that it still FAILS CLOSED with
/// <c>401</c> on an unresolved scope, that a participant scoped to exercise B can never read exercise A's Freeze
/// (COR-001, always-Critical), that the body carries no staff field (XC-002), and that the lifecycle projection
/// still serves correctly when this story's slice is absent — pause is simply missing, and the other five
/// shell-config endpoints are untouched.</para>
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OverlayStateEndpointTests
{
    private static readonly Uri OverlayStateRoute = new("/api/overlay-state", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public OverlayStateEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Get_BeforeAnyFreeze_ReturnsTheClearedNoneState()
    {
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);

        var body = await GetOverlayStateAsync(host);

        body.GetProperty("state").GetString().Should().Be("none");
        body.GetProperty("register").GetString().Should().Be(
            "in-fiction", "the exact hyphenated wire literal the frozen client's union expects");
        body.GetProperty("message").GetString().Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Get_AfterAFreeze_ReturnsTheLiveHoldingPageState_NotTheStaticConstant()
    {
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);
        Freeze(host, exerciseId);

        var body = await GetOverlayStateAsync(host);

        body.GetProperty("state").GetString().Should().Be(
            "pause",
            "AC1/AC4: the contributed projection reads the per-exercise OverlayStateService — a participant "
            + "refreshing mid-Freeze must be seeded with the holding page, not the lifecycle's 'none'");
        body.GetProperty("register").GetString().Should().Be("out-of-fiction");
    }

    [RequiresDockerFact]
    public async Task Get_AfterAResume_ReturnsTheClearedStateAgain()
    {
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);
        Freeze(host, exerciseId);
        Resume(host, exerciseId);

        var body = await GetOverlayStateAsync(host);

        body.GetProperty("state").GetString().Should().Be("none", "AC3: a resumed world seeds no holding page");
    }

    // ---- AC1/AC5 end to end: the controller's SELECTED register reaches the participant GET ------

    [RequiresDockerTheory]
    [InlineData("in-fiction")]
    [InlineData("out-of-fiction")]
    public async Task Get_AfterAFreezeThroughTheWiredRegistry_ReportsTheSelectedRegister(string selected)
    {
        // The real chain, DI-wired: PauseTierRegistry.SetTierAsync (what POST /api/steering/pause-tier calls)
        // -> the real IPauseOverlayPublisher -> OverlayStateService -> the contributed projection -> HTTP.
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);

        var result = await FreezeThroughTheRegistryAsync(host, exerciseId, selected);

        result.Outcome.Should().Be(PauseTierOutcome.Applied);
        var body = await GetOverlayStateAsync(host);
        body.GetProperty("state").GetString().Should().Be("pause");
        body.GetProperty("register").GetString().Should().Be(
            selected,
            "AC1/AC5: the register the controller selected is what the participant's shell reads — otherwise the "
            + "selection would be a control that does nothing");
    }

    [RequiresDockerTheory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("sideways")]
    public async Task Get_AfterAFreezeWithAnInvalidRegister_ReportsOutOfFiction(string? selected)
    {
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);

        var result = await FreezeThroughTheRegistryAsync(host, exerciseId, selected);

        result.Outcome.Should().Be(
            PauseTierOutcome.Applied, "a presentation typo must never block the Freeze itself");
        var body = await GetOverlayStateAsync(host);
        body.GetProperty("register").GetString().Should().Be(
            "out-of-fiction",
            "client input is validated and fails closed to the conservative register — wrongly staying in-fiction "
            + "would HIDE a real stop from participants");
    }

    [RequiresDockerFact]
    public async Task Get_AfterAResumeThroughTheWiredRegistry_ClearsToNoneInFiction()
    {
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);
        await FreezeThroughTheRegistryAsync(host, exerciseId, "in-fiction");

        var resumed = await Registry(host).SetTierAsync(
            exerciseId, PauseTier.Running, "human-controller-01", ClockStart, "in-fiction");

        resumed.Outcome.Should().Be(PauseTierOutcome.Applied);
        var body = await GetOverlayStateAsync(host);
        body.GetProperty("state").GetString().Should().Be("none");
        body.GetProperty("register").GetString().Should().Be("in-fiction", "AC3's cleared shape");
    }

    [RequiresDockerFact]
    public async Task Get_AsExerciseB_NeverSeesAFreezeAppliedToExerciseAThroughTheRegistry()
    {
        // BOTH exercises are seeded RUNNING, so A's freeze is genuinely participant-visible in A. Left unseeded, A
        // would be suppressed by the CR-001 precedence gate (a missing row reads null → fail closed) and B's 'none'
        // would prove nothing at all — the isolation assertion would pass for the wrong reason.
        var exerciseA = await SeedAsync();
        var exerciseB = await SeedAsync();
        await using var host = await StartAsync(exerciseB);

        await FreezeThroughTheRegistryAsync(host, exerciseA, "in-fiction");

        (await GetOverlayStateAsync(host)).GetProperty("state").GetString().Should().Be(
            "none",
            "COR-001: the whole wired chain stays per-exercise — B's participants see nothing of A's Freeze");
        OverlayStore(host).Get(exerciseA).State.Should().Be("pause", "while A's really is frozen");
    }

    [RequiresDockerFact]
    public async Task Get_UnresolvedScope_Returns401_NeverAnEmptyButOk200()
    {
        await using var host = await StartAsync(currentExerciseId: null);

        var response = await host.Client.GetAsync(OverlayStateRoute);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "the fail-closed shape of this handler is unchanged by this story (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Get_ParticipantInExerciseB_NeverSeesExerciseAsFreeze()
    {
        // The always-Critical cross-exercise proof: A is frozen, but this request's SERVER-resolved scope is B.
        // A is written to the store DIRECTLY here (standing in for a controller's Freeze), so it needs no row —
        // but it gets one anyway, so this test and its registry-driven sibling above differ only in the mechanism.
        var exerciseA = await SeedAsync();
        var exerciseB = await SeedAsync();
        await using var host = await StartAsync(exerciseB);
        Freeze(host, exerciseA);

        var body = await GetOverlayStateAsync(host);

        body.GetProperty("state").GetString().Should().Be(
            "none",
            "COR-001/XC-001: a participant in exercise B must never receive exercise A's Freeze — not via the push, "
            + "and not via this GET");

        OverlayStore(host).Get(exerciseA).State.Should().Be(
            "pause",
            "and the zero is the SCOPE closing the door, not an empty store: A's frozen state does exist");
    }

    [RequiresDockerFact]
    public async Task Get_ResponseCarriesOnlyParticipantSafeKeys()
    {
        var exerciseId = await SeedAsync();
        await using var host = await StartAsync(exerciseId);
        Freeze(host, exerciseId);

        var response = await host.Client.GetAsync(OverlayStateRoute);
        var raw = await response.Content.ReadAsStringAsync();

        using var document = JsonDocument.Parse(raw);
        document.RootElement.EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(
            ["state", "register", "message"],
            "the frozen OverlayStateResponse triple is FILLED, never reshaped — the store's additive 'sequence' is "
            + "deliberately not projected onto this body (the frontend's wire guard types it optional, and a "
            + "sequence-less GET re-bases its stale-push cutoff permissively rather than stranding it)");
        raw.Should().NotContain("actingHumanId", "XC-002/COR-018: staff attribution never crosses to a participant read");
        raw.Should().NotContain("exerciseId", "the scope is server-resolved; it is never echoed to the participant");
        raw.Should().NotContain("tier", "the PauseTier vocabulary is STAFF-world and never reaches the fiction");
    }

    /// <summary>
    /// The replacement for this suite's old "the endpoint survives an unwired overlay slice" guarantee. The
    /// workaround it pinned (an optional <c>RequestServices.GetService</c> read inside the shared handler) is gone
    /// with the handler edit itself, so the equivalent guarantee for the new shape is asserted instead: without
    /// <c>AddPauseParticipantOverlay()</c> the LIFECYCLE projection still serves <c>/api/overlay-state</c>
    /// correctly — a COR-032 paused world still renders its holding page — and pause is simply absent rather than
    /// the endpoint (or its five siblings) breaking.
    /// </summary>
    [RequiresDockerFact]
    public async Task Get_WhenTheOverlaySliceIsNotWired_TheLifecycleProjectionStillServes_AndPauseIsSimplyAbsent()
    {
        var liveExercise = await SeedAsync(ExerciseLifecycleStates.Live);
        var pausedExercise = await SeedAsync(ExerciseLifecycleStates.Paused);

        await using var live = await StartAsync(liveExercise, wireOverlaySlice: false);
        await using var paused = await StartAsync(pausedExercise, wireOverlaySlice: false);

        using (var scope = live.Services.GetRequiredService<IServiceScopeFactory>().CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IOverlayStateProjection>().Should()
                .BeOfType<LifecycleOverlayStateProjection>(
                    "without this story's Replace the seam is AddExerciseLifecycle()'s projection, undecorated");
        }

        var liveBody = await GetOverlayStateAsync(live);
        liveBody.GetProperty("state").GetString().Should().Be(
            "none", "a live exercise nobody froze is unchanged — and no pause can arrive with the slice unwired");

        var pausedBody = await GetOverlayStateAsync(paused);
        pausedBody.GetProperty("state").GetString().Should().Be(
            "pause",
            "the COR-032 lifecycle holding page must keep working with the world-steering slice absent — this "
            + "story contributes to that read, it does not own it");

        // And the five sibling shell-config GETs are untouched either way.
        (await live.Client.GetAsync(new Uri("/api/shell-state", UriKind.Relative))).StatusCode
            .Should().Be(HttpStatusCode.OK, "story 08 must never be able to take the participant shell down");
    }

    // ---- host + helpers ------------------------------------------------------------------------

    /// <summary>Where a never-started scenario clock is started, so a Freeze genuinely takes (CR-001).</summary>
    private static PauseClockStart ClockStart { get; } = new(DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

    /// <summary>The one overlay store (a singleton) — written directly to stand in for a controller's Freeze.</summary>
    private static OverlayStateService OverlayStore(ExerciseLifecycleTestHost host) =>
        host.Services.GetRequiredService<OverlayStateService>();

    /// <summary>The DI-wired pause-tier registry — drives the REAL publisher, as the POST endpoint does.</summary>
    private static PauseTierRegistry Registry(ExerciseLifecycleTestHost host) =>
        host.Services.GetRequiredService<PauseTierRegistry>();

    /// <summary>Applies the overlay write a controller's Freeze produces for <paramref name="exerciseId"/>.</summary>
    private static void Freeze(ExerciseLifecycleTestHost host, Guid exerciseId)
    {
        var store = OverlayStore(host);
        store.Apply(exerciseId, "pause", "out-of-fiction", store.NextSequence(exerciseId));
    }

    /// <summary>Applies the overlay write a controller's Resume produces for <paramref name="exerciseId"/>.</summary>
    private static void Resume(ExerciseLifecycleTestHost host, Guid exerciseId)
    {
        var store = OverlayStore(host);
        store.Apply(exerciseId, "none", "in-fiction", store.NextSequence(exerciseId));
    }

    /// <summary>
    /// Drives a Freeze through the WIRED registry — the same call <c>POST /api/steering/pause-tier</c> makes — so
    /// the real publisher, the store, the contributed projection and the participant GET are all exercised.
    /// </summary>
    private static Task<PauseTierResult> FreezeThroughTheRegistryAsync(
        ExerciseLifecycleTestHost host, Guid exerciseId, string? overlayRegister) =>
        Registry(host).SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart, overlayRegister);

    private static async Task<JsonElement> GetOverlayStateAsync(ExerciseLifecycleTestHost host)
    {
        var response = await host.Client.GetAsync(OverlayStateRoute);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var raw = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.Clone();
    }

    /// <summary>Seeds a fresh exercise row in the given lifecycle state (default: a RUNNING world).</summary>
    private async Task<Guid> SeedAsync(string status = ExerciseLifecycleStates.Live)
    {
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        await context.SaveChangesAsync();

        return exerciseId;
    }

    /// <summary>
    /// A host wired in <c>Program.cs</c>'s order: 01b's config defaults, then <c>AddExerciseLifecycle()</c>, then
    /// (unless <paramref name="wireOverlaySlice"/> is <c>false</c>) this story's slice, whose <c>Replace</c> of the
    /// overlay seam MUST come last — see <c>AddPauseParticipantOverlay</c>'s ordering note.
    /// </summary>
    private Task<ExerciseLifecycleTestHost> StartAsync(Guid? currentExerciseId, bool wireOverlaySlice = true)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        return ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            configureServices: services =>
            {
                if (!wireOverlaySlice)
                {
                    return;
                }

                // SignalR (the shared hub's IHubContext — no second hub) + story 07's registry, then the overlay
                // slice, exactly as Program.cs orders them relative to AddExerciseLifecycle().
                services.AddSignalR();
                services.AddPauseTierSteering();
                services.AddPauseParticipantOverlay();
            });
    }
}
