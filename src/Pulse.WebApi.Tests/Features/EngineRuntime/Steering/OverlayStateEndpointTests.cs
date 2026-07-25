namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ParticipantShell;
using Xunit;

/// <summary>
/// HTTP tests for this story's ONE edit to the shared participant-shell endpoints
/// (<c>GET /api/overlay-state</c>, world-steering/08; CTL-023, COR-001, XC-001, XC-002) over a minimal host wired
/// as the orchestrator will wire it (<c>AddPauseParticipantOverlay()</c> + the already-wired
/// <c>MapParticipantShellEndpoints()</c>). Docker-free: this endpoint touches no database — its only dependencies
/// are the resolved <see cref="IExerciseContext"/> and the in-memory overlay store.
///
/// <para>Proves the route now serves the LIVE per-exercise value instead of the hardcoded <c>'none'</c> constant
/// (so a participant who joins or refreshes MID-Freeze still lands on the holding page — AC4), that it still
/// FAILS CLOSED with <c>401</c> on an unresolved scope, that a participant scoped to exercise B can never read
/// exercise A's Freeze (COR-001, always-Critical), that the body carries no staff field (XC-002), and that the
/// endpoint keeps working (as the pre-story <c>'none'</c>) if the overlay slice is not wired — it must never take
/// the other five shell-config endpoints down with it.</para>
/// </summary>
public sealed class OverlayStateEndpointTests
{
    private static readonly Uri OverlayStateRoute = new("/api/overlay-state", UriKind.Relative);

    [Fact]
    public async Task Get_BeforeAnyFreeze_ReturnsTheClearedNoneState()
    {
        await using var host = await TestHost.StartAsync(Guid.NewGuid());

        var body = await host.GetOverlayStateAsync();

        body.GetProperty("state").GetString().Should().Be("none");
        body.GetProperty("register").GetString().Should().Be(
            "in-fiction", "the exact hyphenated wire literal the frozen client's union expects");
        body.GetProperty("message").GetString().Should().BeEmpty();
    }

    [Fact]
    public async Task Get_AfterAFreeze_ReturnsTheLiveHoldingPageState_NotTheStaticConstant()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseId);
        host.Freeze(exerciseId);

        var body = await host.GetOverlayStateAsync();

        body.GetProperty("state").GetString().Should().Be(
            "pause",
            "AC1/AC4: the handler now reads the per-exercise OverlayStateService — a participant refreshing "
            + "mid-Freeze must be seeded with the holding page, not the hardcoded 'none'");
        body.GetProperty("register").GetString().Should().Be("out-of-fiction");
    }

    [Fact]
    public async Task Get_AfterAResume_ReturnsTheClearedStateAgain()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseId);
        host.Freeze(exerciseId);
        host.Resume(exerciseId);

        var body = await host.GetOverlayStateAsync();

        body.GetProperty("state").GetString().Should().Be("none", "AC3: a resumed world seeds no holding page");
    }

    // ---- AC1/AC5 end to end: the controller's SELECTED register reaches the participant GET ------

    [Theory]
    [InlineData("in-fiction")]
    [InlineData("out-of-fiction")]
    public async Task Get_AfterAFreezeThroughTheWiredRegistry_ReportsTheSelectedRegister(string selected)
    {
        // The real chain, DI-wired: PauseTierRegistry.SetTierAsync (what POST /api/steering/pause-tier calls)
        // -> the real IPauseOverlayPublisher -> OverlayStateService -> GET /api/overlay-state over HTTP.
        var exerciseId = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseId);

        var result = await host.FreezeThroughTheRegistryAsync(exerciseId, selected);

        result.Outcome.Should().Be(PauseTierOutcome.Applied);
        var body = await host.GetOverlayStateAsync();
        body.GetProperty("state").GetString().Should().Be("pause");
        body.GetProperty("register").GetString().Should().Be(
            selected,
            "AC1/AC5: the register the controller selected is what the participant's shell reads — otherwise the "
            + "selection would be a control that does nothing");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("sideways")]
    public async Task Get_AfterAFreezeWithAnInvalidRegister_ReportsOutOfFiction(string? selected)
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseId);

        var result = await host.FreezeThroughTheRegistryAsync(exerciseId, selected);

        result.Outcome.Should().Be(
            PauseTierOutcome.Applied, "a presentation typo must never block the Freeze itself");
        var body = await host.GetOverlayStateAsync();
        body.GetProperty("register").GetString().Should().Be(
            "out-of-fiction",
            "client input is validated and fails closed to the conservative register — wrongly staying in-fiction "
            + "would HIDE a real stop from participants");
    }

    [Fact]
    public async Task Get_AfterAResumeThroughTheWiredRegistry_ClearsToNoneInFiction()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseId);
        await host.FreezeThroughTheRegistryAsync(exerciseId, "in-fiction");

        var resumed = await host.Registry.SetTierAsync(
            exerciseId, PauseTier.Running, "human-controller-01", host.ClockStart, "in-fiction");

        resumed.Outcome.Should().Be(PauseTierOutcome.Applied);
        var body = await host.GetOverlayStateAsync();
        body.GetProperty("state").GetString().Should().Be("none");
        body.GetProperty("register").GetString().Should().Be("in-fiction", "AC3's cleared shape");
    }

    [Fact]
    public async Task Get_AsExerciseB_NeverSeesAFreezeAppliedToExerciseAThroughTheRegistry()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseB);

        await host.FreezeThroughTheRegistryAsync(exerciseA, "in-fiction");

        (await host.GetOverlayStateAsync()).GetProperty("state").GetString().Should().Be(
            "none",
            "COR-001: the whole wired chain stays per-exercise — B's participants see nothing of A's Freeze");
        host.OverlayState.Get(exerciseA).State.Should().Be("pause", "while A's really is frozen");
    }

    [Fact]
    public async Task Get_UnresolvedScope_Returns401_NeverAnEmptyButOk200()
    {
        await using var host = await TestHost.StartAsync(currentExerciseId: null);

        var response = await host.Client.GetAsync(OverlayStateRoute);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "the fail-closed shape of this handler is unchanged by this story (COR-001)");
    }

    [Fact]
    public async Task Get_ParticipantInExerciseB_NeverSeesExerciseAsFreeze()
    {
        // The always-Critical cross-exercise proof: A is frozen, but this request's SERVER-resolved scope is B.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseB);
        host.Freeze(exerciseA);

        var body = await host.GetOverlayStateAsync();

        body.GetProperty("state").GetString().Should().Be(
            "none",
            "COR-001/XC-001: a participant in exercise B must never receive exercise A's Freeze — not via the push, "
            + "and not via this GET");

        host.OverlayState.Get(exerciseA).State.Should().Be(
            "pause",
            "and the zero is the SCOPE closing the door, not an empty store: A's frozen state does exist");
    }

    [Fact]
    public async Task Get_ResponseCarriesOnlyParticipantSafeKeys()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await TestHost.StartAsync(exerciseId);
        host.Freeze(exerciseId);

        var response = await host.Client.GetAsync(OverlayStateRoute);
        var raw = await response.Content.ReadAsStringAsync();

        using var document = JsonDocument.Parse(raw);
        document.RootElement.EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(
            ["state", "register", "message", "sequence"]);
        raw.Should().NotContain("actingHumanId", "XC-002/COR-018: staff attribution never crosses to a participant read");
        raw.Should().NotContain("exerciseId", "the scope is server-resolved; it is never echoed to the participant");
    }

    [Fact]
    public async Task Get_WhenTheOverlaySliceIsNotWired_StillServesThePreStoryNoneConstant()
    {
        // Program.cs already maps the six shell-config GETs; AddPauseParticipantOverlay() lands as a SEPARATE,
        // serial edit. This endpoint must survive that window (and never invent an overlay).
        await using var host = await TestHost.StartAsync(Guid.NewGuid(), wireOverlaySlice: false);

        var body = await host.GetOverlayStateAsync();

        body.GetProperty("state").GetString().Should().Be("none");
        body.GetProperty("register").GetString().Should().Be("in-fiction");
    }

    /// <summary>
    /// A minimal host: the shell-config route group plus (optionally) this story's overlay registration, with a
    /// fixed server-resolved exercise scope. No database — this endpoint reads none.
    /// </summary>
    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private TestHost(WebApplication app)
        {
            _app = app;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        /// <summary>The one overlay store (a singleton) — written directly to stand in for a controller's Freeze.</summary>
        public OverlayStateService OverlayState => _app.Services.GetRequiredService<OverlayStateService>();

        /// <summary>The DI-wired pause-tier registry — drives the REAL publisher, as the POST endpoint does.</summary>
        public PauseTierRegistry Registry => _app.Services.GetRequiredService<PauseTierRegistry>();

        /// <summary>Where a never-started scenario clock is started, so a Freeze genuinely takes (CR-001).</summary>
        public PauseClockStart ClockStart { get; } = new(DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        public static async Task<TestHost> StartAsync(Guid? currentExerciseId, bool wireOverlaySlice = true)
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();

            if (wireOverlaySlice)
            {
                // Wired exactly as Program.cs will be: SignalR (the shared hub's IHubContext), the shipped clock,
                // story 07's pause-tier steering, then this story's overlay swap.
                builder.Services.AddSignalR();
                builder.Services.AddExerciseClock();
                builder.Services.AddPauseTierSteering();
                builder.Services.AddPauseParticipantOverlay();
            }

            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(
                _ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapParticipantShellEndpoints();
            await app.StartAsync();

            return new TestHost(app);
        }

        /// <summary>Applies the overlay write a controller's Freeze produces for <paramref name="exerciseId"/>.</summary>
        public void Freeze(Guid exerciseId) =>
            OverlayState.Apply(exerciseId, "pause", "out-of-fiction", OverlayState.NextSequence());

        /// <summary>Applies the overlay write a controller's Resume produces for <paramref name="exerciseId"/>.</summary>
        public void Resume(Guid exerciseId) =>
            OverlayState.Apply(exerciseId, "none", "in-fiction", OverlayState.NextSequence());

        /// <summary>
        /// Drives a Freeze through the WIRED registry — the same call
        /// <c>POST /api/steering/pause-tier</c> makes — so the real publisher, the store and the participant GET
        /// are all exercised, not just the store.
        /// </summary>
        /// <param name="exerciseId">The exercise to freeze.</param>
        /// <param name="overlayRegister">The controller's selected register (or an invalid value, to test coercion).</param>
        /// <returns>The registry's outcome.</returns>
        public Task<PauseTierResult> FreezeThroughTheRegistryAsync(Guid exerciseId, string? overlayRegister) =>
            Registry.SetTierAsync(
                exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart, overlayRegister);

        public async Task<JsonElement> GetOverlayStateAsync()
        {
            var response = await Client.GetAsync(OverlayStateRoute);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var raw = await response.Content.ReadAsStringAsync();
            using var document = JsonDocument.Parse(raw);
            return document.RootElement.Clone();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }
    }
}
