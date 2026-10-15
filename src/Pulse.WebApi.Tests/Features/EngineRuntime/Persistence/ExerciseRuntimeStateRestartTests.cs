namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Time.Testing;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.WhiteNoise;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-feedback story 18 against real SQL: write-through on every applied change, and a SIMULATED RESTART — the
/// runtime singletons of "process A" are disposed and a brand-new set ("process B") is built over the SAME database
/// with wall time moved forward on a shared <see cref="FakeTimeProvider"/>; B's
/// <see cref="ExerciseRuntimeStateRehydrator"/> must then put the tier, clock and holding page back (DF-24..DF-27),
/// and the reaction loop's first tick must leave the restored clock alone.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseRuntimeStateRestartTests
{
    private static readonly DateTimeOffset WallStart = new(2026, 10, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ScenarioStart = new(2026, 3, 1, 8, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan LoopTick = TimeSpan.FromSeconds(1);

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseRuntimeStateRestartTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task EveryAppliedTierChange_IsWrittenThrough_AndUnchangedWritesNothing()
    {
        var time = new FakeTimeProvider(WallStart);
        var exerciseId = await SeedExerciseAsync();
        await using var process = StartProcess(time);
        var registry = process.GetRequiredService<PauseTierRegistry>();

        (await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1")).Persisted.Should().BeTrue();
        var afterEngine = await ReadRowAsync(exerciseId);
        afterEngine.Should().NotBeNull("an applied tier change writes the exercise's row through");
        afterEngine!.PauseTier.Should().Be("engine");
        afterEngine.UpdatedAt.Should().Be(WallStart);

        time.Advance(TimeSpan.FromSeconds(30));
        var unchanged = await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1");
        unchanged.Outcome.Should().Be(PauseTierOutcome.Unchanged);
        (await ReadRowAsync(exerciseId))!.UpdatedAt.Should().Be(WallStart, "an Unchanged outcome writes nothing");

        await registry.SetTierAsync(
            exerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(ScenarioStart, TimeZoneInfo.Utc), OverlayStateWire.InFiction);
        var afterFreeze = await ReadRowAsync(exerciseId);
        afterFreeze!.PauseTier.Should().Be("freeze");
        afterFreeze.ClockFrozen.Should().BeTrue();
        afterFreeze.ClockWallAnchorUtc.Should().Be(time.GetUtcNow(), "the wall anchor is server UTC, never a monotonic timestamp");
        afterFreeze.OverlayState.Should().Be("pause", "the published holding page is persisted with the tier");
        afterFreeze.OverlayRegister.Should().Be("in-fiction");
        afterFreeze.OverlaySequence.Should().BeGreaterThan(0);
    }

    [RequiresDockerFact]
    public async Task ClockOnlyChanges_AreWrittenThroughByTheQueue_WithAUtcWallAnchor()
    {
        var time = new FakeTimeProvider(WallStart);
        var exerciseId = await SeedExerciseAsync();
        await using var process = StartProcess(time);
        var clock = process.GetRequiredService<IExerciseClock>();
        var queue = process.GetRequiredService<ExerciseClockWriteThrough>();

        // What ReactionLoopHost.EnsureClockStarted does on a registered exercise's first tick.
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        await queue.FlushAsync();

        var started = await ReadRowAsync(exerciseId);
        started.Should().NotBeNull("a clock Start alone is persisted (fire-and-observe)");
        started!.PauseTier.Should().Be("running");
        started.ClockScenarioStart.Should().Be(ScenarioStart);
        started.ClockTimeZone.Should().Be(TimeZoneInfo.Utc.Id);
        started.ClockElapsedAtAnchorTicks.Should().Be(0);
        started.ClockWallAnchorUtc.Should().Be(WallStart);
        started.ClockFrozen.Should().BeFalse();

        time.Advance(TimeSpan.FromMinutes(3));
        clock.Jump(exerciseId, 5);
        await queue.FlushAsync();

        var jumped = await ReadRowAsync(exerciseId);
        jumped!.ClockElapsedAtAnchorTicks.Should().Be(TimeSpan.FromMinutes(8).Ticks, "3 minutes run + a 5-minute jump");
        jumped.ClockWallAnchorUtc.Should().Be(WallStart.AddMinutes(3));
    }

    [RequiresDockerFact]
    public async Task Restart_RestoresTheEngineTier_AndARunningClock_TenMinutesFurtherOn()
    {
        var time = new FakeTimeProvider(WallStart);
        var exerciseId = await SeedExerciseAsync();

        await using (var processA = StartProcess(time))
        {
            processA.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
            time.Advance(TimeSpan.FromMinutes(5));
            (await processA.GetRequiredService<PauseTierRegistry>().SetTierAsync(exerciseId, PauseTier.Engine, "controller-1"))
                .Persisted.Should().BeTrue();
        }

        time.Advance(TimeSpan.FromMinutes(10)); // the downtime
        await using var processB = StartProcess(time);
        await RehydrateAsync(processB);

        processB.GetRequiredService<PauseTierRegistry>().GetTier(exerciseId).Should().Be(PauseTier.Engine, "DF-26");
        var clock = processB.GetRequiredService<IExerciseClock>();
        clock.IsRunning(exerciseId).Should().BeTrue();
        clock.CurrentScenarioMinute(exerciseId).Should().Be(15, "DF-25: a running clock keeps advancing through downtime");
        clock.CurrentScenarioTime(exerciseId).Should().Be(ScenarioStart.AddMinutes(15));
    }

    [RequiresDockerFact]
    public async Task Restart_DuringFreeze_RestoresTheFrozenMinute_TheHoldingPage_AndTheNextSequenceIsHigher()
    {
        var time = new FakeTimeProvider(WallStart);
        var exerciseId = await SeedExerciseAsync();
        long sequenceBefore;

        await using (var processA = StartProcess(time))
        {
            processA.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
            time.Advance(TimeSpan.FromMinutes(7));
            await processA.GetRequiredService<PauseTierRegistry>().SetTierAsync(
                exerciseId, PauseTier.Freeze, "controller-1", overlayRegister: OverlayStateWire.InFiction);
            sequenceBefore = processA.GetRequiredService<OverlayStateService>().Get(exerciseId).Sequence;
            sequenceBefore.Should().BeGreaterThan(0);
        }

        time.Advance(TimeSpan.FromMinutes(10));
        await using var processB = StartProcess(time);
        await RehydrateAsync(processB);

        var registry = processB.GetRequiredService<PauseTierRegistry>();
        var clock = processB.GetRequiredService<IExerciseClock>();
        var overlay = processB.GetRequiredService<OverlayStateService>();

        registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze, "Freeze stays Freeze (DF-26)");
        clock.IsFrozen(exerciseId).Should().BeTrue();
        clock.CurrentScenarioMinute(exerciseId).Should().Be(7, "a frozen clock comes back at the same minute (DF-25)");
        overlay.Get(exerciseId).Should().Be(
            new OverlayStateSnapshot(OverlayStateWire.Pause, OverlayStateWire.InFiction, string.Empty, sequenceBefore),
            "participants who reload after the restart still land on the holding page");
        WhiteNoiseService.IsTierOrClockStopped(registry, clock, exerciseId).Should().BeTrue(
            "a restored Freeze still stops white noise (DF-13)");

        await registry.SetTierAsync(exerciseId, PauseTier.Running, "controller-1");

        overlay.Get(exerciseId).State.Should().Be(OverlayStateWire.None);
        overlay.Get(exerciseId).Sequence.Should().Be(sequenceBefore + 1, "DF-27: the first publish after a restore is persisted + 1");
        time.Advance(TimeSpan.FromMinutes(1));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(8, "Resume continues from the same scenario minute");
    }

    [RequiresDockerFact]
    public async Task Restart_RestoresEachExercise_OnlyFromItsOwnRow()
    {
        var time = new FakeTimeProvider(WallStart);
        var frozen = await SeedExerciseAsync();
        var engine = await SeedExerciseAsync();
        var untouched = await SeedExerciseAsync();

        await using (var processA = StartProcess(time))
        {
            var registry = processA.GetRequiredService<PauseTierRegistry>();
            await registry.SetTierAsync(frozen, PauseTier.Freeze, "controller-1", new PauseClockStart(ScenarioStart, TimeZoneInfo.Utc));
            await registry.SetTierAsync(engine, PauseTier.Engine, "controller-1");
        }

        time.Advance(TimeSpan.FromMinutes(10));
        await using var processB = StartProcess(time);
        await RehydrateAsync(processB);

        var restored = processB.GetRequiredService<PauseTierRegistry>();
        var clock = processB.GetRequiredService<IExerciseClock>();
        var overlay = processB.GetRequiredService<OverlayStateService>();
        restored.GetTier(frozen).Should().Be(PauseTier.Freeze);
        restored.GetTier(engine).Should().Be(PauseTier.Engine);
        clock.IsFrozen(engine).Should().BeFalse("A's frozen clock is never applied to B (COR-001)");
        overlay.Get(engine).State.Should().Be(OverlayStateWire.None, "A's holding page is never shown to B");
        restored.GetTier(untouched).Should().Be(PauseTier.Running);
        clock.IsRunning(untouched).Should().BeFalse();
        overlay.Get(untouched).Should().Be(OverlayStateService.Cleared);
    }

    [RequiresDockerFact]
    public async Task Rehydrate_SkipsAnUnparseableRow_AndStillRestoresTheOthers()
    {
        var time = new FakeTimeProvider(WallStart);
        var bad = await SeedExerciseAsync();
        var good = await SeedExerciseAsync();
        await InsertRowAsync(new ExerciseRuntimeState
        {
            ExerciseId = bad,
            PauseTier = "freeze",
            ClockScenarioStart = ScenarioStart, // partly-set clock columns: refused (L-3)
            ClockFrozen = true,
            OverlayState = "pause",
            OverlaySequence = 3,
            UpdatedAt = WallStart,
        });
        await InsertRowAsync(new ExerciseRuntimeState { ExerciseId = good, PauseTier = "injects", UpdatedAt = WallStart });

        await using var process = StartProcess(time);
        await RehydrateAsync(process);

        var registry = process.GetRequiredService<PauseTierRegistry>();
        registry.GetTier(bad).Should().Be(PauseTier.Running, "an unparseable row is skipped whole");
        process.GetRequiredService<IExerciseClock>().IsFrozen(bad).Should().BeFalse();
        process.GetRequiredService<OverlayStateService>().Get(bad).Should().Be(OverlayStateService.Cleared);
        registry.GetTier(good).Should().Be(PauseTier.Injects, "every other exercise is still restored");
    }

    [RequiresDockerFact]
    public async Task Restart_ThenTheReactionLoopsFirstTick_KeepsTheRestoredMinute_AndARestoredFreezeStaysHalted()
    {
        var time = new FakeTimeProvider(WallStart);
        var running = await SeedExerciseAsync();
        var frozen = await SeedExerciseAsync();

        await using (var processA = StartProcess(time))
        {
            var clockA = processA.GetRequiredService<IExerciseClock>();
            clockA.Start(running, ScenarioStart, TimeZoneInfo.Utc);
            clockA.Start(frozen, ScenarioStart, TimeZoneInfo.Utc);
            clockA.Jump(running, 30);
            clockA.Jump(frozen, 30);
            await processA.GetRequiredService<PauseTierRegistry>().SetTierAsync(frozen, PauseTier.Freeze, "controller-1");
            await processA.GetRequiredService<ExerciseClockWriteThrough>().FlushAsync();
        }

        time.Advance(TimeSpan.FromMinutes(10));
        await using var processB = StartProcess(time, withReactionLoop: true);
        await RehydrateAsync(processB);

        var clock = processB.GetRequiredService<IExerciseClock>();
        clock.CurrentScenarioMinute(running).Should().Be(40);
        clock.CurrentScenarioMinute(frozen).Should().Be(30);

        // The seed re-registers the loops after a restart; the loop's first tick then sees running/frozen clocks.
        var loops = processB.GetRequiredService<IReactionLoopRegistry>();
        loops.Register(Registration(running));
        loops.Register(Registration(frozen));

        var host = processB.GetServices<IHostedService>().OfType<ReactionLoopHost>().Single();
        await host.StartAsync(CancellationToken.None);
        try
        {
            // BackgroundService starts ExecuteAsync on its own task, so the loop's PeriodicTimer may not exist yet:
            // keep nudging fake time one heartbeat at a time (well under a scenario minute in total) until it ticks.
            await WaitUntilAsync(async () =>
            {
                if (await CountEventsAsync(running, EngineEventTypes.Measured) > 0)
                {
                    return true;
                }

                time.Advance(LoopTick);
                return false;
            });
        }
        finally
        {
            await host.StopAsync(CancellationToken.None);
        }

        clock.IsRunning(running).Should().BeTrue();
        clock.CurrentScenarioMinute(running).Should().Be(40, "the first tick never restarts a restored clock (ShouldStartClock)");
        clock.IsFrozen(frozen).Should().BeTrue();
        clock.CurrentScenarioMinute(frozen).Should().Be(30);
        (await CountEventsAsync(frozen, null)).Should().Be(0, "a restored Freeze still halts the engine: the tick is skipped");
    }

    // ---- process + data helpers --------------------------------------------------------------------------------

    /// <summary>One "process": the runtime singletons wired as Program.cs wires them, over the shared database.</summary>
    private ServiceProvider StartProcess(FakeTimeProvider time, bool withReactionLoop = false)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(time);
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(_fixture.ConnectionString));
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddPauseTierSteering();
        services.AddSignalR();
        services.AddPauseParticipantOverlay();
        services.AddExerciseRuntimePersistence();

        if (withReactionLoop)
        {
            services.AddSingleton(new ReactionLoopHostOptions { TickInterval = LoopTick });
            services.AddScoped<PostIngestService>();
            services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
            services.AddSingleton<IEngineReviewBroadcaster, RecordingReviewBroadcaster>();
            services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake provider
            services.AddEngineRuntimeSeams();
            services.AddReactionLoopHost();
        }

        return services.BuildServiceProvider();
    }

    private static async Task RehydrateAsync(ServiceProvider process)
    {
        var rehydrator = process.GetServices<IHostedService>().OfType<ExerciseRuntimeStateRehydrator>().Single();
        await rehydrator.StartAsync(CancellationToken.None);
    }

    private async Task<Guid> SeedExerciseAsync()
    {
        var exerciseId = Guid.NewGuid();
        await using var context = _fixture.CreateContext();
        context.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Runtime State Restart Test",
            TimeZone = "UTC",
            Status = "live",
        });
        await context.SaveChangesAsync();
        return exerciseId;
    }

    private async Task InsertRowAsync(ExerciseRuntimeState row)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = row.ExerciseId });
        context.ExerciseRuntimeStates.Add(row);
        await context.SaveChangesAsync();
    }

    private async Task<ExerciseRuntimeState?> ReadRowAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await context.ExerciseRuntimeStates.AsNoTracking().SingleOrDefaultAsync();
    }

    private async Task<int> CountEventsAsync(Guid exerciseId, string? eventType)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await context.TelemetryEvents.CountAsync(e => eventType == null || e.EventType == eventType);
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition)
    {
        var stopwatch = Stopwatch.StartNew();
        while (!await condition())
        {
            stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(15), "the loop's first tick should land promptly");
            await Task.Delay(250);
        }
    }

    private static ReactionLoopRegistration Registration(Guid exerciseId)
    {
        var cast = new Dictionary<string, EnginePersona>(StringComparer.Ordinal)
        {
            ["@rosa"] = new(Guid.NewGuid(), new PersonaDossier { Handle = "@rosa", DisplayName = "rosa", Type = PersonaType.Resident }),
        };

        // A long silence window, so the tick only MEASURES (no generation): the point is the clock, not the content.
        var storyline = Storyline.Create(
            exerciseId,
            title: "Water main contamination fears",
            expectation: "an official statement from the county",
            responseWindowMin: 600,
            participatingPersonas: cast.Keys.ToList(),
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);

        return new ReactionLoopRegistration
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "UTC",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = [storyline],
            PersonasByHandle = cast,
            Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
            ControllerDeskId = Guid.NewGuid(),
        };
    }
}
