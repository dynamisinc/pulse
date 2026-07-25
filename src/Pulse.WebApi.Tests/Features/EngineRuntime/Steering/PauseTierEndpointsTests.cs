namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// HTTP integration tests for the server-authoritative pause-tier endpoints (world-steering/07) over a bespoke
/// minimal host wired EXACTLY as the orchestrator will wire it into <c>Program.cs</c> after Gate-2
/// (<c>AddPauseTierSteering()</c> + <c>MapPauseTierSteering()</c>), against the shared migrated Testcontainers
/// SQL Server. Proves the route mapping, that the REUSED
/// <see cref="Pulse.WebApi.Features.EngineRuntime.EngineCockpitStaffAuthorizationFilter"/> fails closed
/// (<c>401</c> unauthenticated/unscoped, <c>403</c> staff-but-unassigned, <c>200</c> assigned), that a Freeze
/// reaches the shipped <see cref="IExerciseClock"/>, and that the tier is recorded per exercise with no
/// client-supplied <c>exerciseId</c> ever honoured (COR-001). Every test is
/// <see cref="RequiresDockerFactAttribute"/> — the staff gate reads real assignment rows.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PauseTierEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PauseTierEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Routes_AreMappedExactlyOnce()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/steering/pause-tier").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/steering/pause-tier").Should().Be(1);
    }

    // ---- the reused staff gate: fail closed (COR-001/COR-005, XC-002) --------------------------

    [RequiresDockerFact]
    public async Task Post_NoStaffSession_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an unauthenticated caller must never reach a staff steering control");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse("the gate rejects before the clock is ever touched");
    }

    [RequiresDockerFact]
    public async Task Post_UnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an unresolved scope fails closed, never a default/empty-200 (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Post_StaffNotAssignedToResolvedExercise_Returns403_AndNeverFreezes()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await using var host = await StartHostAsync(
            resolvedExercise, authenticatedStaff: true, assignedExerciseId: assignedElsewhere);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a staff user not assigned to the resolved exercise must be rejected with 403 (COR-005)");
        host.Clock.IsFrozen(resolvedExercise).Should().BeFalse(
            "the gate rejects before the safety action reaches the clock");
    }

    [RequiresDockerFact]
    public async Task Get_NoStaffSession_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(Guid.NewGuid(), authenticatedStaff: false);

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task Get_AssignedStaff_Returns200WithTheRunningBaseline()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "a staff user assigned to the resolved exercise is authorized (COR-005)");
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("running");
        state.ClockFrozen.Should().BeFalse();
    }

    // ---- Freeze reaches the SHIPPED clock the reaction loop already checks (AC 1/2) -------------

    [RequiresDockerFact]
    public async Task Post_Freeze_OnAColdClock_StartsAndFreezesIt_ReportingTheTruth()
    {
        // CR-001: the DEFAULT state of a fresh host — no reaction loop has ticked, so nothing has ever called
        // IExerciseClock.Start for this exercise. The freeze must still be REAL, and the response must say so.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.IsFrozen(exerciseId).Should().BeFalse("no clock has been started for this exercise yet");
        host.Clock.IsRunning(exerciseId).Should().BeFalse();

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("freeze");
        state.ClockFrozen.Should().BeTrue(
            "the response must never claim a freeze the clock did not take — the console verifies this field");
        host.Clock.IsFrozen(exerciseId).Should().BeTrue(
            "ReactionLoopHost.TickExerciseAsync skips a tick on exactly this flag, so the engine is genuinely halted");
    }

    [RequiresDockerFact]
    public async Task Post_Freeze_OnAColdClock_ThenTheLoopsLazyStart_LeavesItFrozen()
    {
        // ReactionLoopHost.EnsureClockStarted starts a clock only when it is neither running NOR frozen, so a
        // freeze applied before the loop's first tick survives it (rather than the loop starting a RUNNING clock
        // under a console reading WORLD FROZEN).
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        var loopWouldStartTheClock =
            !host.Clock.IsRunning(exerciseId) && !host.Clock.IsFrozen(exerciseId);

        loopWouldStartTheClock.Should().BeFalse("the loop must leave the already-frozen clock exactly as it is");
        host.Clock.IsFrozen(exerciseId).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Post_Freeze_FreezesTheResolvedExercisesClock()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("freeze");
        state.ClockFrozen.Should().BeTrue();
        host.Clock.IsFrozen(exerciseId).Should().BeTrue(
            "ReactionLoopHost skips a tick entirely while IsFrozen — this is what makes Freeze genuinely halt the engine");
    }

    [RequiresDockerFact]
    public async Task Post_Resume_UnfreezesWithoutLosingScenarioTime()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });
        var frozenAtMinute = host.Clock.CurrentScenarioMinute(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "running", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(response)).Tier.Should().Be("running");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse();
        host.Clock.CurrentScenarioMinute(exerciseId).Should().Be(frozenAtMinute,
            "COR-050: the clock resumes from exactly the scenario minute it held — no scenario time is lost");
    }

    [RequiresDockerFact]
    public async Task Post_FreezeInExerciseA_NeverFreezesExerciseB()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseA);
        host.Clock.Start(exerciseA, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        host.Clock.Start(exerciseB, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        // The body deliberately carries a foreign exerciseId — it must be IGNORED for scoping (COR-001).
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", exerciseId = exerciseB });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Clock.IsFrozen(exerciseA).Should().BeTrue("the SERVER-resolved scope is the only scope");
        host.Clock.IsFrozen(exerciseB).Should().BeFalse(
            "COR-001: a client-supplied exerciseId is never honoured — a Freeze on A can never touch B's clock");
        host.Registry.GetTier(exerciseB).Should().Be(PauseTier.Running);
    }

    [RequiresDockerFact]
    public async Task Post_NonFreezeTier_LeavesTheClockRunning()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "engine", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(response)).Tier.Should().Be("engine");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse(
            "Engine-paused never stops scenario time — only Freeze does");
    }

    [RequiresDockerFact]
    public async Task Get_AfterAPost_ResyncsTheRecordedTier()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("freeze", "the GET is the console's resync read");
        state.ClockFrozen.Should().BeTrue();
    }

    // ---- CR-001 over HTTP: a refused freeze is a 409, not a 500 (WR-103) -----------------------

    [RequiresDockerFact]
    public async Task Post_Freeze_WhenTheClockRefuses_Returns409_AndRecordsNothing()
    {
        // The whole frontend revert hangs off this STATUS: a 409 rejects the axios promise and the console falls
        // back to RUNNING, whereas a 500 would look like an infrastructure blip on an unknown state. Forced by
        // injecting a clock whose Freeze throws — the same RemoveAll + re-add the host already does for
        // IExerciseContext.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, clockOverride: new RefusingExerciseClock());

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "a freeze that cannot reach the clock fails closed with 409 — never a 200 claiming a pause, never a 500");
        host.Registry.GetTier(exerciseId).Should().Be(
            PauseTier.Running, "a refused freeze records NO tier, so a later GET cannot resurrect it");
    }

    [RequiresDockerFact]
    public async Task Get_AfterARefusedFreeze_StillReportsRunning()
    {
        // The console's failure path re-GETs to ask what is actually true (rather than guessing) — that read must
        // not report the freeze it just refused.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, clockOverride: new RefusingExerciseClock());
        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("running");
        state.ClockFrozen.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Post_NonFreezeTier_StillSucceeds_WhenTheClockWouldRefuseAFreeze()
    {
        // Only Freeze depends on the clock — Engine-paused must not be collateral damage.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, clockOverride: new RefusingExerciseClock());

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "engine", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(response)).Tier.Should().Be("engine");
    }

    // ---- validation (400s, never a silent guess) -----------------------------------------------

    [RequiresDockerFact]
    public async Task Post_UnknownTier_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "world-frozen", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        host.Registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    [RequiresDockerFact]
    public async Task Post_MissingActingHuman_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018: attribution is required");
        host.Registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    // ---- composition: the no-op overlay publisher default (story 08 swaps it) -------------------

    [RequiresDockerFact]
    public async Task AddPauseTierSteering_RegistersTheNoOpOverlayPublisherDefault()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        host.Services.GetRequiredService<IPauseOverlayPublisher>().Should().BeOfType<NullPauseOverlayPublisher>(
            "story 07 ships the no-op default via TryAddSingleton; story 08 replaces it with RemoveAll + AddSingleton");
        host.Services.GetRequiredService<PauseTierRegistry>().Should().BeSameAs(
            host.Services.GetRequiredService<PauseTierRegistry>(),
            "the registry is a singleton — one in-memory tier per exercise for the whole host");
    }

    // ---- host + helpers ------------------------------------------------------------------------

    private async Task<PauseTierTestHost> StartHostAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        IExerciseClock? clockOverride = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await PauseTierTestHost.StartAsync(
            _fixture.ConnectionString!, currentExerciseId, authenticatedStaff, assignedExerciseId, clockOverride);
    }

    /// <summary>
    /// A non-conforming clock that ACCEPTS a started exercise but refuses to freeze — the cheapest way to reach
    /// <see cref="PauseTierOutcome.ClockUnavailable"/> over real HTTP (WR-103). Everything else behaves.
    /// </summary>
    private sealed class RefusingExerciseClock : IExerciseClock
    {
        public void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone)
        {
        }

        public void Freeze(Guid exerciseId) =>
            throw new InvalidOperationException("This clock cannot be frozen.");

        public void Unfreeze(Guid exerciseId)
        {
        }

        public void Jump(Guid exerciseId, int scenarioMinutes)
        {
        }

        public int CurrentScenarioMinute(Guid exerciseId) => 0;

        public DateTimeOffset? CurrentScenarioTime(Guid exerciseId) => null;

        public bool IsFrozen(Guid exerciseId) => false;

        public bool IsRunning(Guid exerciseId) => true;
    }

    private static async Task<PauseTierWireState> ReadStateAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        return new PauseTierWireState(
            doc.RootElement.GetProperty("tier").GetString(),
            doc.RootElement.GetProperty("clockFrozen").GetBoolean());
    }

    /// <summary>The staff-only wire projection, read back field-for-field (XC-002: tier + clock state only).</summary>
    private sealed record PauseTierWireState(string? Tier, bool ClockFrozen);

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// A minimal host wired exactly as the orchestrator's future <c>Program.cs</c> edit will wire story 07
    /// (<c>AddPauseTierSteering</c> + <c>MapPauseTierSteering</c>) on top of its prerequisites — persistence +
    /// exercise scoping, the shipped exercise clock, and B2's staff identity (the reused gate) — against the
    /// shared Testcontainers database.
    /// </summary>
    private sealed class PauseTierTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private PauseTierTestHost(WebApplication app)
        {
            _app = app;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public IServiceProvider Services => _app.Services;

        /// <summary>The one shipped clock the pause tier drives (a singleton) — asserted on directly.</summary>
        public IExerciseClock Clock => _app.Services.GetRequiredService<IExerciseClock>();

        /// <summary>The one pause-tier registry (a singleton) — asserted on directly.</summary>
        public PauseTierRegistry Registry => _app.Services.GetRequiredService<PauseTierRegistry>();

        public static async Task<PauseTierTestHost> StartAsync(
            string connectionString,
            Guid? currentExerciseId,
            bool authenticatedStaff = true,
            Guid? assignedExerciseId = null,
            IExerciseClock? clockOverride = null)
        {
            // The staff caller the REUSED cockpit authorization filter gates on. A default host is an
            // authenticated staff user ASSIGNED to the resolved exercise; the denial tests flip these knobs.
            var staffUserId = Guid.NewGuid();
            var accessor = authenticatedStaff
                ? new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
                : new StubCurrentStaffSessionAccessor(null);

            if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddExerciseClock();
            builder.Services.AddPauseTierSteering();

            // A test may substitute a non-conforming clock to force the fail-closed 409 path (WR-103).
            if (clockOverride is not null)
            {
                builder.Services.RemoveAll<IExerciseClock>();
                builder.Services.AddSingleton(clockOverride);
            }

            // B2's staff-identity dependency the reused filter resolves per request (the orchestrator wires
            // AddStaffIdentity before the steering feature in production).
            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

            // The server-authoritative request scope (fixed per host; null = the fail-closed case).
            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapPauseTierSteering();
            await app.StartAsync();

            return new PauseTierTestHost(app);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        /// <summary>
        /// Seeds the <see cref="Exercise"/> + <see cref="StaffAssignment"/> rows the reused cockpit gate reads
        /// (via <see cref="StaffAssignmentService.GetAssignmentsAsync"/>). Both are unscoped entities, so the
        /// write-guard needs no resolved exercise scope here.
        /// </summary>
        private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseSqlServer(connectionString)
                .Options;

            await using var context = new PulseDbContext(options);
            context.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                Name = "Pause Tier Test Exercise",
                TimeZone = "UTC",
                Status = "active",
            });
            context.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = "controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await context.SaveChangesAsync();
        }
    }
}
