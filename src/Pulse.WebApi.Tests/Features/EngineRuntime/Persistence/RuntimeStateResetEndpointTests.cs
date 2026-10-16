namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// demo-feedback story 18 over HTTP, on a host composed the way seam S-5 will compose <c>Program.cs</c>
/// (<c>AddExerciseRuntimePersistence()</c> + <c>MapRuntimeStateReset()</c> beside the pause-tier slice): the
/// controller-only <c>POST /api/steering/runtime-state/reset</c> (DF-28; 405 on GET, 401/403 fail-closed, exercise
/// scoped, idempotent, one <c>steering.runtime_reset</c> event, hard delete of the row), the <c>persisted</c> flag on
/// the pause-tier POST, and a full restart — a second host over the same database whose hosted-service startup
/// brings the Freeze and the participant holding page back.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RuntimeStateResetEndpointTests
{
    private static readonly DateTimeOffset WallStart = new(2026, 10, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly Uri ResetUri = new(ExerciseRuntimePersistenceEndpoints.ResetRoute, UriKind.Relative);
    private static readonly Uri PauseTierUri = new("/api/steering/pause-tier", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public RuntimeStateResetEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ResetRoute_IsMappedExactlyOnce_AsAPost()
    {
        await using var host = await StartAsync(await SeedAsync());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        dataSource.Endpoints.OfType<RouteEndpoint>()
            .Count(endpoint => string.Equals(endpoint.RoutePattern.RawText, ExerciseRuntimePersistenceEndpoints.ResetRoute, StringComparison.Ordinal)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") ?? false))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Get_OnTheResetRoute_Answers405()
    {
        // Story 27's Test-FreezeResume.ps1 detects story 18 by exactly this: 405 = deployed, 404 = pre-18.
        await using var host = await StartAsync(await SeedAsync());

        var response = await host.Client.GetAsync(ResetUri);

        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed, "the reset route is POST-only");
    }

    [RequiresDockerFact]
    public async Task Post_NoStaffSession_Is401_AndResetsNothing()
    {
        var seed = await SeedAsync();
        await using var host = await StartAsync(seed, authenticatedStaff: false);
        await host.Registry.SetTierAsync(seed.ExerciseId, PauseTier.Engine, "controller-1");

        var response = await host.Client.PostAsync(ResetUri, null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        host.Registry.GetTier(seed.ExerciseId).Should().Be(PauseTier.Engine);
    }

    [RequiresDockerFact]
    public async Task Post_UnresolvedScope_Is401()
    {
        await using var host = await StartAsync(await SeedAsync(), resolvedExercise: Guid.Empty);

        var response = await host.Client.PostAsync(ResetUri, null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Post_AsEvaluator_Is403_AndResetsNothing()
    {
        var seed = await SeedAsync(role: "evaluator");
        await using var host = await StartAsync(seed);
        await host.Registry.SetTierAsync(seed.ExerciseId, PauseTier.Engine, "controller-1");

        var response = await host.Client.PostAsync(ResetUri, null);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "only a controller may reset (the pause-tier POST's filters)");
        host.Registry.GetTier(seed.ExerciseId).Should().Be(PauseTier.Engine);
        (await ReadRowAsync(seed.ExerciseId)).Should().NotBeNull();
    }

    [RequiresDockerFact]
    public async Task Post_AfterAFreeze_ResetsTierClockAndOverlay_DeletesTheRow_AndEmitsOneEvent()
    {
        var seed = await SeedAsync();
        await using var host = await StartAsync(seed);
        (await host.Client.PostAsJsonAsync(PauseTierUri, new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "in-fiction" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        var frozenOverlay = await host.ReadOverlayAsync(seed.ExerciseId);
        frozenOverlay.State.Should().Be("pause");
        (await ReadRowAsync(seed.ExerciseId)).Should().NotBeNull();
        await host.FlushClockWritesAsync();

        var response = await host.Client.PostAsync(ResetUri, null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Should().Be(new WireState("running", false, true));
        host.Registry.GetTier(seed.ExerciseId).Should().Be(PauseTier.Running);
        host.Clock.IsRunning(seed.ExerciseId).Should().BeFalse("the clock is cleared to unstarted");
        host.Clock.IsFrozen(seed.ExerciseId).Should().BeFalse();

        var overlay = await host.ReadOverlayAsync(seed.ExerciseId);
        overlay.State.Should().Be("none");
        overlay.Sequence.Should().BeGreaterThan(frozenOverlay.Sequence, "overlay none is published with the next sequence");

        (await ReadRowAsync(seed.ExerciseId)).Should().BeNull("the reset hard-deletes the row (machine state, 17 Gate-1 L-2)");
        var events = await ReadEventsAsync(seed.ExerciseId, RuntimeStateResetService.RuntimeResetEventType);
        events.Should().ContainSingle("the reset emits exactly one steering.runtime_reset");
        var resetEvent = events.Single();
        resetEvent.Channel.Should().Be("system");
        resetEvent.Actor.Kind.Should().Be("system");
        resetEvent.Actor.ActingHumanId.Should().Be(seed.StaffUserId.ToString());
        resetEvent.WallClockTime.Should().Be(WallStart);
        using var payload = JsonDocument.Parse(resetEvent.Payload!);
        payload.RootElement.GetProperty("previousTier").GetString().Should().Be("freeze");
        payload.RootElement.GetProperty("clockWasFrozen").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Post_IsIdempotent()
    {
        var seed = await SeedAsync();
        await using var host = await StartAsync(seed);
        await host.Registry.SetTierAsync(seed.ExerciseId, PauseTier.Engine, "controller-1");

        var first = await host.Client.PostAsync(ResetUri, null);
        var second = await host.Client.PostAsync(ResetUri, null);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(second)).Should().Be(new WireState("running", false, true));
        (await ReadRowAsync(seed.ExerciseId)).Should().BeNull();
        (await ReadEventsAsync(seed.ExerciseId, RuntimeStateResetService.RuntimeResetEventType)).Should().HaveCount(2,
            "every reset is its own audited action");
    }

    [RequiresDockerFact]
    public async Task Post_ResetsOnlyTheResolvedExercise()
    {
        var seed = await SeedAsync();
        var other = await SeedAsync();
        await using var host = await StartAsync(seed);
        await host.Registry.SetTierAsync(seed.ExerciseId, PauseTier.Engine, "controller-1");
        await host.Registry.SetTierAsync(
            other.ExerciseId, PauseTier.Freeze, "controller-2", new PauseClockStart(WallStart, TimeZoneInfo.Utc), OverlayStateWire.InFiction);
        var otherOverlay = host.Overlay.Get(other.ExerciseId);

        var response = await host.Client.PostAsync(ResetUri, null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Registry.GetTier(other.ExerciseId).Should().Be(PauseTier.Freeze, "a reset of A never touches B (COR-001)");
        host.Clock.IsFrozen(other.ExerciseId).Should().BeTrue();
        host.Overlay.Get(other.ExerciseId).Should().Be(otherOverlay);
        (await ReadRowAsync(other.ExerciseId))!.PauseTier.Should().Be("freeze", "B's row is untouched");
        (await ReadEventsAsync(other.ExerciseId, RuntimeStateResetService.RuntimeResetEventType)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task PauseTierPost_WritesThrough_AndReportsPersistedTrue()
    {
        var seed = await SeedAsync();
        await using var host = await StartAsync(seed);

        var response = await host.Client.PostAsJsonAsync(PauseTierUri, new { tier = "engine", actingHumanId = "human-controller-01" });

        (await ReadStateAsync(response)).Should().Be(new WireState("engine", false, true));
        (await ReadRowAsync(seed.ExerciseId))!.PauseTier.Should().Be("engine");
    }

    [RequiresDockerFact]
    public async Task PauseTierPost_WhenTheWriteFails_Is200_PersistedFalse_AndTheTierStands()
    {
        var seed = await SeedAsync();
        await using var host = await StartAsync(seed, failingStore: true);

        var response = await host.Client.PostAsJsonAsync(PauseTierUri, new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "a failed write-through never fails the safety action");
        (await ReadStateAsync(response)).Should().Be(new WireState("freeze", true, false));
        host.Registry.GetTier(seed.ExerciseId).Should().Be(PauseTier.Freeze, "never rolled back");
    }

    [RequiresDockerFact]
    public async Task ARestartedHost_BringsTheFreezeAndTheHoldingPageBack_OnStartup()
    {
        var seed = await SeedAsync();
        var time = new FakeTimeProvider(WallStart);
        OverlayWire before;

        await using (var first = await StartAsync(seed, time: time))
        {
            (await first.Client.PostAsJsonAsync(PauseTierUri, new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "in-fiction" }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
            before = await first.ReadOverlayAsync(seed.ExerciseId);
            before.State.Should().Be("pause");
        }

        time.Advance(TimeSpan.FromMinutes(10));

        // A NEW host over the same database: its hosted-service startup runs the rehydrator before serving.
        await using var second = await StartAsync(seed, time: time);

        var tier = await second.Client.GetAsync(PauseTierUri);
        (await ReadStateAsync(tier)).Should().Be(new WireState("freeze", true, true), "Freeze stays Freeze across a restart");
        var after = await second.ReadOverlayAsync(seed.ExerciseId);
        after.Should().Be(before, "a participant reloading after the restart still sees the holding page");

        (await second.Client.PostAsJsonAsync(PauseTierUri, new { tier = "running", actingHumanId = "human-controller-01" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await second.ReadOverlayAsync(seed.ExerciseId)).Sequence.Should().Be(before.Sequence + 1, "DF-27: monotonic across the restart");
    }

    // ---- helpers ---------------------------------------------------------------------------------------------

    private async Task<Seed> SeedAsync(string role = "controller")
    {
        var seed = new Seed(Guid.NewGuid(), Guid.NewGuid(), role);
        await using var context = _fixture.CreateContext();
        context.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = seed.ExerciseId,
            Name = "Runtime Reset Test Exercise",
            TimeZone = "UTC",
            Status = "live",
        });
        context.StaffUsers.Add(StaffTenantSeed.StaffUserFor(seed.StaffUserId));
        context.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            PersonId = seed.StaffUserId,
            ExerciseId = seed.ExerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync();
        return seed;
    }

    private Task<ResetTestHost> StartAsync(
        Seed seed,
        bool authenticatedStaff = true,
        Guid? resolvedExercise = null,
        bool failingStore = false,
        FakeTimeProvider? time = null) =>
        ResetTestHost.StartAsync(
            _fixture.ConnectionString!,
            seed,
            authenticatedStaff,
            resolvedExercise ?? seed.ExerciseId,
            failingStore,
            time ?? new FakeTimeProvider(WallStart));

    private async Task<ExerciseRuntimeState?> ReadRowAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await context.ExerciseRuntimeStates.AsNoTracking().SingleOrDefaultAsync();
    }

    private async Task<System.Collections.Generic.List<TelemetryEvent>> ReadEventsAsync(Guid exerciseId, string eventType)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await context.TelemetryEvents.AsNoTracking().Where(e => e.EventType == eventType).ToListAsync();
    }

    private static async Task<WireState> ReadStateAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return new WireState(
            document.RootElement.GetProperty("tier").GetString()!,
            document.RootElement.GetProperty("clockFrozen").GetBoolean(),
            document.RootElement.GetProperty("persisted").GetBoolean());
    }

    private sealed record Seed(Guid ExerciseId, Guid StaffUserId, string Role);

    private sealed record WireState(string Tier, bool ClockFrozen, bool Persisted);

    private sealed record OverlayWire(string State, string Register, long Sequence);

    /// <summary>
    /// The pause-tier test host's composition plus story 18's two lines, over the shared database, with a fixed staff
    /// caller and a fixed resolved scope, and an optional always-failing store.
    /// </summary>
    private sealed class ResetTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private ResetTestHost(WebApplication app)
        {
            _app = app;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public IServiceProvider Services => _app.Services;

        public PauseTierRegistry Registry => _app.Services.GetRequiredService<PauseTierRegistry>();

        public IExerciseClock Clock => _app.Services.GetRequiredService<IExerciseClock>();

        public OverlayStateService Overlay => _app.Services.GetRequiredService<OverlayStateService>();

        public Task FlushClockWritesAsync() => _app.Services.GetRequiredService<ExerciseClockWriteThrough>().FlushAsync();

        /// <summary>
        /// Reads the participant <c>GET /api/overlay-state</c> (state + register), paired with the store's sequence for
        /// <paramref name="exerciseId"/> — the GET body carries no sequence; the push (<c>OverlayStateChanged</c>)
        /// carries the store's.
        /// </summary>
        public async Task<OverlayWire> ReadOverlayAsync(Guid exerciseId)
        {
            var response = await Client.GetAsync(new Uri("/api/overlay-state", UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return new OverlayWire(
                document.RootElement.GetProperty("state").GetString()!,
                document.RootElement.GetProperty("register").GetString()!,
                Overlay.Get(exerciseId).Sequence);
        }

        public static async Task<ResetTestHost> StartAsync(
            string connectionString,
            Seed seed,
            bool authenticatedStaff,
            Guid resolvedExercise,
            bool failingStore,
            FakeTimeProvider time)
        {
            var accessor = new StubCurrentStaffSessionAccessor(authenticatedStaff
                ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = seed.StaffUserId }
                : null);

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            builder.Services.RemoveAll<TimeProvider>();
            builder.Services.AddSingleton<TimeProvider>(time);
            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();

            // Story 18 FIRST, where S-5 puts it (before every ticking hosted service).
            builder.Services.AddExerciseRuntimePersistence();
            builder.Services.Configure<ExerciseRuntimePersistenceOptions>(options => options.RehydrateRetryBudgetSeconds = 0);

            builder.Services.AddExerciseClock();
            builder.Services.AddPauseTierSteering();
            builder.Services.AddExerciseConfiguration();
            builder.Services.AddExerciseLifecycle();
            builder.Services.AddSignalR();
            builder.Services.AddPauseParticipantOverlay();

            if (failingStore)
            {
                builder.Services.RemoveAll<IExerciseRuntimeStateStore>();
                builder.Services.AddSingleton<IExerciseRuntimeStateStore>(
                    new InMemoryRuntimeStateStore { FailWith = new InvalidOperationException("SQL is down") });
            }

            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);
            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext
            {
                CurrentExerciseId = resolvedExercise == Guid.Empty ? null : resolvedExercise,
            });

            var app = builder.Build();
            app.MapPauseTierSteering();
            app.MapRuntimeStateReset();
            app.MapParticipantShellEndpoints();
            await app.StartAsync();

            return new ResetTestHost(app);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }
    }
}
