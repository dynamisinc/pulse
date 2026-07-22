namespace Pulse.WebApi.Tests.Features.EngineRuntime;

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
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Story 01 end-to-end loop coverage against a REAL SQL Server (Testcontainers): the scenario-time tick
/// (observe → decide → generate → enqueue → measure), the guard-before-human gate, the one-review-item-per-
/// burst CTL-034 contract, freeze/jump behaviour, the per-exercise scope (COR-001, extending the standing
/// isolation suite), and the XC-004 stage telemetry. Every test is <see cref="RequiresDockerFactAttribute"/>
/// (skips on a Docker-less machine, runs in CI against <see cref="FakeGenerationProvider"/>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ReactionLoopHostTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public ReactionLoopHostTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private ServiceProvider BuildHost(TimeProvider timeProvider, ReactionLoopHostOptions? options = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(timeProvider);
        if (options is not null)
        {
            services.AddSingleton(options);
        }

        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();

        return services.BuildServiceProvider();
    }

    private static Dictionary<string, EnginePersona> Cast(params string[] handles) =>
        handles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.Ordinal);

    private static Storyline SeededStoryline(Guid exerciseId, string title, IReadOnlyList<string> personaHandles)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: title,
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            participatingPersonas: personaHandles,
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(
        Guid exerciseId,
        IReadOnlyList<Storyline> storylines,
        Dictionary<string, EnginePersona> cast,
        AutonomyLevel level = AutonomyLevel.Suggest) => new()
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "America/Chicago",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = storylines,
            PersonasByHandle = cast,
            Autonomy = EngineAutonomyState.Create(exerciseId, level),
            ControllerDeskId = Guid.NewGuid(),
        };

    private async Task<ReactionTickResult> RunOneTickAsync(
        ServiceProvider host,
        ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId =
            registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    [RequiresDockerFact]
    public async Task Tick_WhenSilenceWindowBlows_EnqueuesOneReviewItem_AndEmitsEachStageEventOnce()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // 25 scenario minutes of silence → window (20) blows

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        var result = await RunOneTickAsync(host, registration);

        result.ReviewItemsEnqueued.Should().Be(1, "one blown storyline yields exactly one burst = one review item (CTL-034)");

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.EngineReviewItems.CountAsync()).Should().Be(1);

        // Each loop stage emitted exactly one XC-004 event for this single-storyline tick.
        var byType = await read.TelemetryEvents
            .GroupBy(e => e.EventType)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync();
        var counts = byType.ToDictionary(x => x.Key, x => x.Count, StringComparer.Ordinal);
        counts.GetValueOrDefault(EngineEventTypes.Observed).Should().Be(1, "one inaction trigger");
        counts.GetValueOrDefault(EngineEventTypes.Decided).Should().Be(1, "one intent");
        counts.GetValueOrDefault(EngineEventTypes.Generated).Should().Be(1, "one burst");
        counts.GetValueOrDefault(EngineEventTypes.Measured).Should().Be(1, "one storyline measured this tick");
        counts.GetValueOrDefault(EngineEventTypes.StorylineStateChanged).Should().Be(1, "the window-open transition");
    }

    [RequiresDockerFact]
    public async Task Tick_ReviewItem_IsScopedToItsExercise_AndNeverVisibleCrossExercise()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseA, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseA, "Water main contamination fears", cast.Keys.ToList());
        var result = await RunOneTickAsync(host, Registration(exerciseA, [storyline], cast));
        result.ReviewItemsEnqueued.Should().Be(1);

        // Exercise B sees none of exercise A's enqueued review items (fail closed).
        await using var readB = _fixture.CreateContext(ScopeFor(exerciseB));
        (await readB.EngineReviewItems.CountAsync()).Should().Be(
            0, "a tick for exercise A must never write into exercise B (COR-001)");

        // The rows exist under exercise A — the zero above is the filter, not a missing write.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.EngineReviewItems.IgnoreQueryFilters().CountAsync(i => i.ExerciseId == exerciseA))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Tick_WhileClockFrozenBelowTheWindow_AccruesNoSilence_AndSurfacesNothing()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(5)); // below the 20-minute window
        clock.Freeze(exerciseId);                    // freeze holds the minute at 5

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        // Advancing wall time changes nothing while frozen: two ticks accrue no scenario time.
        await RunOneTickAsync(host, registration);
        manualTime.Advance(TimeSpan.FromMinutes(60));
        var second = await RunOneTickAsync(host, registration);

        second.ReviewItemsEnqueued.Should().Be(0, "a frozen clock accrues no silence, so no window blows (COR-052)");
        storyline.Phase.Should().Be(StorylinePhase.Seeded, "the storyline never left Seeded while frozen");

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.EngineReviewItems.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Tick_AfterATimeJump_SurfacesTheStorylineThatBlewItsWindowDuringTheSkip()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        // A discrete time-jump (COR-051) leaps past the response window; the next tick surfaces the storyline.
        clock.Jump(exerciseId, 30);
        var result = await RunOneTickAsync(host, registration);

        result.ReviewItemsEnqueued.Should().Be(1, "the jump advanced the timers so the blown window surfaces on the next tick");
        storyline.Phase.Should().Be(StorylinePhase.Escalating);
    }

    [RequiresDockerFact]
    public async Task Tick_WithManyBlownStorylines_CapsReviewDecisionsAtTheCtl034Budget()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(30));

        var cast = Cast("@rosa", "@marcus");
        var storylines = Enumerable.Range(0, 8)
            .Select(i => SeededStoryline(exerciseId, $"Concern {i}", cast.Keys.ToList()))
            .ToList<Storyline>();

        var result = await RunOneTickAsync(host, Registration(exerciseId, storylines, cast));

        result.ReviewItemsEnqueued.Should().Be(
            WorkloadDemandMeter.BudgetPerMinute,
            "the loop must not demand more than ~6 review decisions per scenario minute (CTL-034) even with 8 blown storylines");
    }

    [RequiresDockerFact]
    public async Task HostedService_DrivesTheLoop_AndAFrozenExerciseIsSkipped()
    {
        var running = Guid.NewGuid();
        var frozen = Guid.NewGuid();

        // Real time source + a short heartbeat, so the BackgroundService actually ticks in this test.
        await using var host = BuildHost(TimeProvider.System, new ReactionLoopHostOptions
        {
            TickInterval = TimeSpan.FromMilliseconds(100),
        });

        var clock = host.GetRequiredService<IExerciseClock>();
        // Pre-start + jump both clocks past the window so the host does not have to wait 20 real minutes;
        // EnsureClockStarted will not restart an already-running/frozen clock.
        clock.Start(running, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(frozen, ScenarioStart, TimeZoneInfo.Utc);
        clock.Jump(running, 30);
        clock.Jump(frozen, 30);
        clock.Freeze(frozen);

        var castRunning = Cast("@rosa", "@marcus");
        var castFrozen = Cast("@rosa", "@marcus");
        var registry = host.GetRequiredService<IReactionLoopRegistry>();
        registry.Register(Registration(running, [SeededStoryline(running, "Running concern", castRunning.Keys.ToList())], castRunning));
        registry.Register(Registration(frozen, [SeededStoryline(frozen, "Frozen concern", castFrozen.Keys.ToList())], castFrozen));

        var loop = host.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<ReactionLoopHost>().Single();
        await loop.StartAsync(CancellationToken.None);
        try
        {
            await WaitUntilAsync(async () =>
            {
                await using var read = _fixture.CreateContext(ScopeFor(running));
                return await read.EngineReviewItems.CountAsync() > 0;
            });
        }
        finally
        {
            await loop.StopAsync(CancellationToken.None);
        }

        await using var readRunning = _fixture.CreateContext(ScopeFor(running));
        (await readRunning.EngineReviewItems.CountAsync()).Should().BeGreaterThan(
            0, "the hosted BackgroundService drives the loop for a running exercise");

        await using var readFrozen = _fixture.CreateContext(ScopeFor(frozen));
        (await readFrozen.EngineReviewItems.CountAsync()).Should().Be(
            0, "a freeze halts ticking, so the frozen exercise generated nothing (COR-052)");
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < TimeSpan.FromSeconds(20))
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("The reaction loop did not produce a review item within the timeout.");
    }
}
