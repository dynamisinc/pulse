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
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Addressing;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// The ENGINE PAUSED tier is enforced by the reaction loop itself (CTL-023; world-steering/03 "Pause engine halts new
/// E8 content", world-steering/07 UAT "no new review items / no engine.generated while ENGINE PAUSED"). Under the tier
/// a tick makes no provider call, emits no <c>engine.generated</c> and enqueues no review item, while MEASURE and the
/// scenario clock keep running; resuming fires no catch-up burst; Freeze is unchanged; and one exercise's tier never
/// holds another's loop (COR-001). The gate under test is the in-memory tier read, not SQL behavior, so the harness
/// runs on the EF in-memory provider (as <c>AmbientLoopHarness</c> does) and every test is a plain <see cref="FactAttribute"/>;
/// the central query filter still applies, so the per-exercise reads are scoped exactly as in production.
/// </summary>
public sealed class ReactionLoopEnginePauseTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private static ServiceProvider BuildHost(TimeProvider timeProvider, CountingGenerationProvider provider, ReactionLoopHostOptions? options = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(timeProvider);
        if (options is not null)
        {
            services.AddSingleton(options);
        }

        services.AddScoped<IExerciseContext, ExerciseContext>();
        var dbName = $"engine-pause-{Guid.NewGuid():N}";
        services.AddDbContext<PulseDbContext>(o => o.UseInMemoryDatabase(dbName));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
        services.AddSingleton<IEngineReviewBroadcaster>(new RecordingReviewBroadcaster());

        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake

        // Registered after AddEngineGeneration so the generate stage resolves the counting wrapper.
        services.AddSingleton<IGenerationProvider>(provider);

        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();

        // The SAME singleton the pause-tier endpoint writes in production (AddPauseTierSteering).
        services.AddSingleton(sp => new PauseTierRegistry(
            sp.GetRequiredService<IExerciseClock>(), new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance));

        return services.BuildServiceProvider();
    }

    private static Dictionary<string, EnginePersona> Cast(params string[] handles) =>
        handles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.Ordinal);

    private static Storyline SeededStoryline(Guid exerciseId, string title, IReadOnlyList<string> handles, int responseWindowMin = 20)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: title,
            expectation: "an official statement from the county",
            responseWindowMin: responseWindowMin,
            participatingPersonas: handles,
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(
        Guid exerciseId,
        IReadOnlyList<Storyline> storylines,
        Dictionary<string, EnginePersona> cast) => new()
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "America/Chicago",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = storylines,
            PersonasByHandle = cast,
            Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
            ControllerDeskId = Guid.NewGuid(),
        };

    private static async Task<ReactionTickResult> RunOneTickAsync(ServiceProvider host, ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId =
            registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    /// <summary>Runs <paramref name="query"/> against a context scoped to <paramref name="exerciseId"/> (COR-001).</summary>
    private static async Task<T> ReadAsync<T>(ServiceProvider host, Guid exerciseId, Func<PulseDbContext, Task<T>> query)
    {
        await using var scope = host.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        return await query(scope.ServiceProvider.GetRequiredService<PulseDbContext>());
    }

    private static async Task<Dictionary<string, int>> EventCountsAsync(ServiceProvider host, Guid exerciseId)
    {
        var rows = await ReadAsync(host, exerciseId, read => read.TelemetryEvents
            .GroupBy(e => e.EventType)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync());
        return rows.ToDictionary(x => x.Key, x => x.Count, StringComparer.Ordinal);
    }

    private static Task<int> ReviewItemCountAsync(ServiceProvider host, Guid exerciseId) =>
        ReadAsync(host, exerciseId, read => read.EngineReviewItems.CountAsync());

    [Fact]
    public async Task Tick_WhileEnginePaused_GeneratesNothing_ButMeasureAndTheClockKeepRunning()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        host.GetRequiredService<PauseTierRegistry>().Restore(exerciseId, PauseTier.Engine);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // past the 20-minute window

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        var first = await RunOneTickAsync(host, registration);
        manualTime.Advance(TimeSpan.FromMinutes(10));
        var second = await RunOneTickAsync(host, registration);

        first.ReviewItemsEnqueued.Should().Be(0, "ENGINE PAUSED halts new engine content (world-steering/03)");
        second.ReviewItemsEnqueued.Should().Be(0, "the hold lasts for as long as the tier does");
        first.InactionTriggers.Should().Be(0, "a held loop raises no inaction trigger");
        provider.Calls.Should().Be(0, "a held loop never calls the generation provider");
        (await ReviewItemCountAsync(host, exerciseId)).Should().Be(0, "nothing reaches the review queue (story 07 UAT)");

        var counts = await EventCountsAsync(host, exerciseId);
        counts.GetValueOrDefault(EngineEventTypes.Generated).Should().Be(0, "no engine.generated while ENGINE PAUSED");
        counts.GetValueOrDefault(EngineEventTypes.Decided).Should().Be(0, "no decide stage ran");
        counts.GetValueOrDefault(EngineEventTypes.Observed).Should().Be(0, "no trigger was observed for work that will not run");
        counts.GetValueOrDefault(EngineEventTypes.Measured).Should().Be(2, "MEASURE still runs every tick");

        clock.IsFrozen(exerciseId).Should().BeFalse("the Engine tier never freezes the scenario clock");
        second.ScenarioMinute.Should().Be(35, "scenario time keeps moving under the Engine tier");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(35, "the officials' silence still accrues in real scenario time");
        storyline.Phase.Should().Be(StorylinePhase.Escalating, "the world keeps living: the window still opened");
    }

    [Fact]
    public async Task Tick_WhileEnginePaused_AnOfficialPostStillAddressesItsStoryline_ButNoReplyIsGenerated()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        host.GetRequiredService<PauseTierRegistry>().Restore(exerciseId, PauseTier.Engine);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // past the 20-minute window

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);
        registration.ResponseMatching.EnableAutoConfirm(); // so a plausible answer resolves straight to a match

        host.GetRequiredService<IAddressingInbox>().Enqueue(
            exerciseId,
            new AddressingObservation(
                AddressingSource.OfficialPost,
                Guid.NewGuid().ToString(),
                "County update on #WaterIssues: do not drink tap water until further notice."));

        var result = await RunOneTickAsync(host, registration);

        storyline.Phase.Should().Be(StorylinePhase.Addressed, "the participant's answer is a world event, and the world keeps living");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0, "the answer resets the silence clock even while the engine is held");
        provider.Calls.Should().Be(0, "the response reply burst is new engine content, so it is not generated");
        result.ReviewItemsEnqueued.Should().Be(0);
        (await ReviewItemCountAsync(host, exerciseId)).Should().Be(0, "no reply draft reaches the review queue");
        (await EventCountsAsync(host, exerciseId)).GetValueOrDefault(EngineEventTypes.Generated).Should().Be(0);
    }

    [Fact]
    public async Task Tick_WhileEnginePaused_WithTheCadenceGateDisabled_StillRaisesNoTrigger()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        host.GetRequiredService<PauseTierRegistry>().Restore(exerciseId, PauseTier.Engine);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = new ReactionLoopRegistration
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "America/Chicago",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = [storyline],
            PersonasByHandle = cast,
            Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
            ControllerDeskId = Guid.NewGuid(),

            // Cadence 0 disables the observe-stage gate, so the re-based marker cannot suppress the trigger: only the
            // held tick's explicit drop does.
            RateConfig = RateGovernanceConfig.Default with { MinMinutesBetweenInactionReactions = 0 },
        };

        var first = await RunOneTickAsync(host, registration);
        manualTime.Advance(TimeSpan.FromMinutes(1));
        var second = await RunOneTickAsync(host, registration);

        first.InactionTriggers.Should().Be(0, "a held tick raises no trigger even with the cadence gate off");
        second.InactionTriggers.Should().Be(0);
        (first.ReviewItemsEnqueued + second.ReviewItemsEnqueued).Should().Be(0);
        provider.Calls.Should().Be(0);
        var counts = await EventCountsAsync(host, exerciseId);
        counts.GetValueOrDefault(EngineEventTypes.Observed).Should().Be(0);
        counts.GetValueOrDefault(EngineEventTypes.Generated).Should().Be(0);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Tick_WhenEnginePausedArrivesDuringAProviderCall_TheBurstIsDiscarded_AndNoFurtherCallIsMade(bool pauseMidTick)
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        var tiers = host.GetRequiredService<PauseTierRegistry>();
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // three storylines are due this tick

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storylines = Enumerable.Range(0, 3)
            .Select(i => SeededStoryline(exerciseId, $"Concern {i}", cast.Keys.ToList()))
            .ToList<Storyline>();
        var registration = Registration(exerciseId, storylines, cast);

        // The controller enters ENGINE PAUSED while the first burst is being generated (or, as the control, never).
        if (pauseMidTick)
        {
            provider.OnCall = () => tiers.Restore(exerciseId, PauseTier.Engine);
        }

        var result = await RunOneTickAsync(host, registration);
        var generated = (await EventCountsAsync(host, exerciseId)).GetValueOrDefault(EngineEventTypes.Generated);

        if (!pauseMidTick)
        {
            // Control: the same tick, unpaused, voices all three storylines, so the paused case's single call is the
            // re-check at work, not a demand or decide limit.
            provider.Calls.Should().Be(3, "three storylines are due this tick");
            result.ReviewItemsEnqueued.Should().Be(3);
            return;
        }

        provider.Calls.Should().Be(1, "no further provider call is made once the tier holds, even mid-tick");
        generated.Should().Be(1, "the in-flight call happened and carries its spend, so its engine.generated is kept");
        result.ReviewItemsEnqueued.Should().Be(0, "a burst whose generation finished after the pause took is discarded");
        (await ReviewItemCountAsync(host, exerciseId)).Should().Be(0, "nothing reaches the review queue after the pause");
    }

    [Fact]
    public async Task Tick_DrivenDirectlyUnderTheFreezeTier_GeneratesNothing()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        // The tier alone, with the clock left running: this bypasses the host's frozen-tick skip, so only the
        // driver's own Freeze backstop can hold the tick.
        host.GetRequiredService<PauseTierRegistry>().Restore(exerciseId, PauseTier.Freeze);

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var result = await RunOneTickAsync(host, Registration(exerciseId, [storyline], cast));

        result.ReviewItemsEnqueued.Should().Be(0, "the Freeze tier holds new engine content in the driver too");
        result.InactionTriggers.Should().Be(0);
        provider.Calls.Should().Be(0);
        (await EventCountsAsync(host, exerciseId)).GetValueOrDefault(EngineEventTypes.Generated).Should().Be(0);
    }

    [Fact]
    public async Task Resume_AfterEnginePause_FiresNoCatchUpBurst_ThenTheNormalCadenceResumes()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        var clock = host.GetRequiredService<IExerciseClock>();
        var tiers = host.GetRequiredService<PauseTierRegistry>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        // "Reacted" already fired once before the pause; "Late" first opens its (40-minute) window DURING the pause.
        var cast = Cast("@rosa", "@marcus", "@lena");
        var reacted = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var late = SeededStoryline(exerciseId, "Boil-water notice confusion", cast.Keys.ToList(), responseWindowMin: 40);
        var registration = Registration(exerciseId, [reacted, late], cast);

        manualTime.Advance(TimeSpan.FromMinutes(25));
        (await RunOneTickAsync(host, registration)).ReviewItemsEnqueued.Should().Be(1, "the running baseline reacts at minute 25");
        var callsBeforePause = provider.Calls;

        tiers.Restore(exerciseId, PauseTier.Engine);
        manualTime.Advance(TimeSpan.FromMinutes(10)); // minute 35
        (await RunOneTickAsync(host, registration)).ReviewItemsEnqueued.Should().Be(0);
        manualTime.Advance(TimeSpan.FromMinutes(20)); // minute 55: both storylines are long past their windows
        (await RunOneTickAsync(host, registration)).ReviewItemsEnqueued.Should().Be(0);
        provider.Calls.Should().Be(callsBeforePause, "no provider call while held");

        tiers.Restore(exerciseId, PauseTier.Running);
        manualTime.Advance(TimeSpan.FromMinutes(1)); // minute 56: the first tick after resume
        var firstAfterResume = await RunOneTickAsync(host, registration);

        firstAfterResume.ReviewItemsEnqueued.Should().Be(
            0, "resuming must not fire one late 'long silence' burst per storyline on the first tick");
        firstAfterResume.InactionTriggers.Should().Be(0, "the cadence restarted at resume");
        provider.Calls.Should().Be(callsBeforePause, "no catch-up generation on resume");

        manualTime.Advance(TimeSpan.FromMinutes(2)); // minute 58: the default 3-minute cadence has elapsed
        var cadenceTick = await RunOneTickAsync(host, registration);

        cadenceTick.ReviewItemsEnqueued.Should().Be(2, "both storylines re-fire on the normal cadence after resume");
        (await ReviewItemCountAsync(host, exerciseId)).Should().Be(3, "one before the pause, none during it, two on the cadence after it");
        reacted.MinutesSinceLastOfficialResponse.Should().Be(
            58, "the pause re-bases only the engine's reaction marker, never the officials' real silence");
    }

    [Fact]
    public async Task Tick_WhileOneExerciseIsEnginePaused_AnotherExerciseKeepsGenerating()
    {
        var paused = Guid.NewGuid();
        var running = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(manualTime, provider);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(paused, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(running, ScenarioStart, TimeZoneInfo.Utc);
        host.GetRequiredService<PauseTierRegistry>().Restore(paused, PauseTier.Engine);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        var castPaused = Cast("@rosa", "@marcus");
        var castRunning = Cast("@rosa", "@marcus");
        var pausedResult = await RunOneTickAsync(
            host, Registration(paused, [SeededStoryline(paused, "Paused concern", castPaused.Keys.ToList())], castPaused));
        var runningResult = await RunOneTickAsync(
            host, Registration(running, [SeededStoryline(running, "Running concern", castRunning.Keys.ToList())], castRunning));

        pausedResult.ReviewItemsEnqueued.Should().Be(0, "the paused exercise is held");
        runningResult.ReviewItemsEnqueued.Should().Be(1, "exercise A's tier must never hold exercise B's loop (COR-001)");
        (await ReviewItemCountAsync(host, paused)).Should().Be(0);
        (await ReviewItemCountAsync(host, running)).Should().Be(1);

        (await ReadAsync(host, running, read => read.EngineReviewItems.IgnoreQueryFilters().CountAsync(i => i.ExerciseId == paused)))
            .Should().Be(0, "the paused exercise's zero is a real absence, not the scope filter");
    }

    [Fact]
    public async Task HostedService_EnginePausedKeepsMeasuring_FreezeStillSkipsTheTick_RunningGenerates()
    {
        var running = Guid.NewGuid();
        var enginePaused = Guid.NewGuid();
        var frozen = Guid.NewGuid();
        var provider = new CountingGenerationProvider();

        await using var host = BuildHost(TimeProvider.System, provider, new ReactionLoopHostOptions
        {
            TickInterval = TimeSpan.FromMilliseconds(100),
        });

        var clock = host.GetRequiredService<IExerciseClock>();
        var tiers = host.GetRequiredService<PauseTierRegistry>();
        foreach (var id in new[] { running, enginePaused, frozen })
        {
            clock.Start(id, ScenarioStart, TimeZoneInfo.Utc);
            clock.Jump(id, 30);
        }

        tiers.Restore(enginePaused, PauseTier.Engine);
        clock.Freeze(frozen);
        tiers.Restore(frozen, PauseTier.Freeze);

        var registry = host.GetRequiredService<IReactionLoopRegistry>();
        foreach (var id in new[] { running, enginePaused, frozen })
        {
            var cast = Cast("@rosa", "@marcus");
            registry.Register(Registration(id, [SeededStoryline(id, "Concern", cast.Keys.ToList())], cast));
        }

        var loop = host.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<ReactionLoopHost>().Single();
        await loop.StartAsync(CancellationToken.None);
        try
        {
            await WaitUntilAsync(async () =>
                await ReviewItemCountAsync(host, running) > 0
                && (await EventCountsAsync(host, enginePaused)).GetValueOrDefault(EngineEventTypes.Measured) > 0);
        }
        finally
        {
            await loop.StopAsync(CancellationToken.None);
        }

        (await ReviewItemCountAsync(host, running)).Should().BeGreaterThan(0, "a running exercise still generates");
        (await ReviewItemCountAsync(host, enginePaused)).Should().Be(0, "ENGINE PAUSED generates nothing through the hosted loop");
        (await ReviewItemCountAsync(host, frozen)).Should().Be(0, "a freeze still halts the exercise (COR-052)");

        var pausedCounts = await EventCountsAsync(host, enginePaused);
        pausedCounts.GetValueOrDefault(EngineEventTypes.Measured).Should().BeGreaterThan(
            0, "the Engine tier does not skip the tick: MEASURE keeps the world moving");
        pausedCounts.GetValueOrDefault(EngineEventTypes.Generated).Should().Be(0);

        (await EventCountsAsync(host, frozen)).Should().BeEmpty("Freeze is unchanged: the host skips the frozen tick entirely");
        clock.IsFrozen(enginePaused).Should().BeFalse("the Engine tier never freezes the clock");
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < TimeSpan.FromSeconds(20))
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("The reaction loop did not reach the expected state in time.");
    }

    /// <summary>Wraps the deterministic fake provider and counts every call, so a test can prove none was made.</summary>
    private sealed class CountingGenerationProvider : IGenerationProvider
    {
        private readonly FakeGenerationProvider _inner = new();
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        /// <summary>Runs inside every call, before the fake answers: lets a test change state mid-generation.</summary>
        public Action? OnCall { get; set; }

        public string Name => _inner.Name;

        public GenerationGovernance Governance => _inner.Governance;

        public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _calls);
            OnCall?.Invoke();
            return _inner.GenerateAsync(request, cancellationToken);
        }
    }
}
