namespace Pulse.WebApi.Tests.Features.BackgroundWork;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.BackgroundWork;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.WhiteNoise;
using Xunit;

/// <summary>
/// An idle environment must do NO database work, so the serverless database can auto-pause (it needs an hour with no
/// queries). Before this, three hosted services swept the database every 1-5 s whether or not there was anything to
/// do, and resolving the exercise for each App Service AlwaysOn ping to <c>/</c> was a query every few minutes — UAT's
/// database never paused and cost ~$290/month idle. Each service now sleeps until a wake signal raised AFTER the write
/// that creates its work commits. These tests pin both halves: idle means no sweeps, and the writes wake the sleeper.
/// No SQL: an in-memory store, and sweeps counted at the database-context resolution.
/// </summary>
public sealed class IdleBackgroundWorkTests
{
    // ---- WakeSignal ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task WakeSignal_AnIndefiniteWait_ReturnsOnAWake()
    {
        var signal = new WakeSignal();

        var waiting = signal.WaitAsync(Timeout.InfiniteTimeSpan, TimeProvider.System, CancellationToken.None);
        await Task.Delay(50);
        waiting.IsCompleted.Should().BeFalse("an idle sleeper waits for a wake, with no timeout");

        signal.Wake();
        (await waiting.WaitAsync(TimeSpan.FromSeconds(5))).Should().BeTrue();
    }

    [Fact]
    public async Task WakeSignal_AWakeRaisedWhileTheSleeperIsBusy_IsKeptForItsNextWait()
    {
        // The race that would strand work forever under an indefinite sleep: a write commits and wakes while the
        // service is mid-sweep (its sweep missed the row), and only then does the service go back to sleep.
        var signal = new WakeSignal();
        signal.Wake();

        (await signal.WaitAsync(Timeout.InfiniteTimeSpan, TimeProvider.System, CancellationToken.None)
            .WaitAsync(TimeSpan.FromSeconds(5))).Should().BeTrue("the pending wake is consumed at once");
        (await signal.WaitAsync(TimeSpan.Zero, TimeProvider.System, CancellationToken.None)).Should().BeFalse(
            "and only once: wakes coalesce");
    }

    // ---- EngineReviewTickHost ------------------------------------------------------------------------------------

    [Fact]
    public void ReviewTick_NextDelay_TicksWhileACountdownCanProgressOrAfterAFailure_AndSleepsOtherwise()
    {
        EngineReviewTickHost.NextDelay(progressingExercises: 1, sweepFailed: false).Should().Be(TimeSpan.FromSeconds(1));
        EngineReviewTickHost.NextDelay(progressingExercises: 0, sweepFailed: true).Should().Be(
            TimeSpan.FromSeconds(1), "a failing safety tick keeps retrying");
        EngineReviewTickHost.NextDelay(progressingExercises: 0, sweepFailed: false).Should().Be(
            Timeout.InfiniteTimeSpan, "nothing can expire while nothing counts down on a running clock");
    }

    [Fact]
    public void ReviewTick_OnlyACountdownOnARunningClock_CanProgress()
    {
        // A frozen clock holds its minute and an unstarted one reads minute 0 forever, so a countdown on either can
        // never expire — sweeping it every second would keep the database awake for nothing (Freeze is the park state).
        var clock = new ExerciseClockService(TimeProvider.System);
        var running = Guid.NewGuid();
        var frozen = Guid.NewGuid();
        var unstarted = Guid.NewGuid();
        clock.Start(running, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        clock.Start(frozen, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        clock.Freeze(frozen);

        EngineReviewTickHost.CountProgressing([running, frozen, unstarted], clock).Should().Be(1);
        EngineReviewTickHost.CountProgressing([frozen, unstarted], clock).Should().Be(0);
    }

    [Fact]
    public async Task ReviewTick_WithNothingCountingDown_SweepsOnceAfterStart_ThenOnlyWhenWoken()
    {
        var sweeps = new SweepCounter();
        var signal = new EngineReviewTickSignal();
        var host = new EngineReviewTickHost(
            sweeps.ScopeFactory, signal, new ExerciseClockService(TimeProvider.System), TimeProvider.System, NullLogger<EngineReviewTickHost>.Instance);

        await host.StartAsync(CancellationToken.None);
        try
        {
            (await sweeps.WaitForAsync(1, TimeSpan.FromSeconds(10))).Should().BeTrue(
                "the first sweep after start picks up countdowns that survived a restart");
            await Task.Delay(TimeSpan.FromMilliseconds(1600));
            sweeps.Count.Should().Be(1, "the old 1 s poll would have swept again by now; an idle tick sleeps");

            signal.Wake(); // a burst enqueued at Delayed-auto
            (await sweeps.WaitForAsync(2, TimeSpan.FromSeconds(10))).Should().BeTrue("a wake starts a sweep at once");
        }
        finally
        {
            await host.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task ReviewStore_EnqueuingACountdown_WakesTheTick_AndAnyOtherDisposition_DoesNot()
    {
        var exerciseId = Guid.NewGuid();
        var signal = new EngineReviewTickSignal();
        await using var db = NewContext(Guid.NewGuid().ToString(), exerciseId);
        var store = new EngineReviewStore(db, signal);

        await store.EnqueueAsync(ReviewItem(exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued));
        (await IsWoken(signal)).Should().BeFalse("a queued Suggest burst has no countdown to evaluate");

        await store.EnqueueAsync(ReviewItem(exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown));
        (await IsWoken(signal)).Should().BeTrue("a new countdown must reach the sleeping auto-HOLD tick");
    }

    [Fact]
    public async Task ReviewStore_MovingAnItemIntoCountdown_WakesTheTick()
    {
        var exerciseId = Guid.NewGuid();
        var signal = new EngineReviewTickSignal();
        await using var db = NewContext(Guid.NewGuid().ToString(), exerciseId);
        var store = new EngineReviewStore(db, signal);
        var item = ReviewItem(exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.Held);
        await store.EnqueueAsync(item);
        (await IsWoken(signal)).Should().BeFalse();

        (await store.UpdateDispositionAsync(item.DraftId, DraftDisposition.CountingDown)).Should().BeTrue();
        (await IsWoken(signal)).Should().BeTrue();
    }

    [Fact]
    public void ReviewTickSignal_IsRegisteredWhereverTheTickOrTheStoreIs()
    {
        var withReview = new ServiceCollection().AddEngineReview();
        withReview.Should().Contain(d => d.ServiceType == typeof(EngineReviewTickSignal) && d.Lifetime == ServiceLifetime.Singleton);

        var withSeams = new ServiceCollection().AddEngineRuntimeSeams();
        withSeams.Should().Contain(
            d => d.ServiceType == typeof(EngineReviewTickSignal) && d.Lifetime == ServiceLifetime.Singleton,
            "the store requires the signal, so a host that registers the store must be able to build it");
    }

    // ---- WhiteNoisePacer -----------------------------------------------------------------------------------------

    [Fact]
    public void Pacer_NextDelay_TicksWhileAnyExerciseCanPost_AndSleepsOtherwise()
    {
        var options = new WhiteNoisePacerOptions();
        WhiteNoisePacer.NextDelay(exercisesThatCanPost: 2, options).Should().Be(TimeSpan.FromSeconds(1));
        WhiteNoisePacer.NextDelay(exercisesThatCanPost: 0, options).Should().Be(Timeout.InfiniteTimeSpan);
    }

    [Fact]
    public async Task Pacer_SleepsUnlessAnExerciseCanPost_AndWakesOnLevelAndClockChanges()
    {
        var databaseName = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        await using (var seed = NewContext(databaseName, exerciseId))
        {
            seed.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                OrganizationId = Organization.DefaultOrganizationId,
                Name = "Idle noise",
                NoiseLevel = NoiseRates.Off,
            });
            seed.NoisePosts.Add(new NoisePost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                PersonaId = Guid.NewGuid(),
                Text = "Anyone else's tap running brown?",
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        // The UAT resting state: pool loaded, level off. The clock carries the production wiring: every change wakes the
        // pacer. Every sweep is exactly one database-context resolution (an exercise that can post resolves no further
        // context here: its per-exercise scope fails at IExerciseContext, which this bare provider does not register, and
        // that fault is isolated per exercise — the tick, and its count of exercises that can post, carry on).
        var sweeps = new SweepCounter(databaseName);
        var signal = new WhiteNoisePacerSignal();
        var clock = new ExerciseClockService(TimeProvider.System, new NullExerciseClockChangeSink(), [new WakeOnClockChange(signal)]);
        var pacer = new WhiteNoisePacer(
            sweeps.ScopeFactory,
            new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance),
            clock,
            TimeProvider.System,
            new CryptoNoiseJitterSource(),
            signal,
            new WhiteNoisePacerOptions
            {
                FirstSweepDelay = TimeSpan.FromMilliseconds(20),
                TickInterval = TimeSpan.FromMilliseconds(20),
                MaxFailureBackoff = TimeSpan.FromMilliseconds(20),
            },
            NullLogger<WhiteNoisePacer>.Instance);

        await pacer.StartAsync(CancellationToken.None);
        try
        {
            (await sweeps.WaitForAsync(1, TimeSpan.FromSeconds(10))).Should().BeTrue();
            (await sweeps.StaysAtAsync(1, TimeSpan.FromMilliseconds(400))).Should().BeTrue(
                "a pool with noise off has nothing to post, so the pacer sleeps instead of sweeping every tick");

            await SetNoiseLevelAsync(databaseName, exerciseId, "low");
            signal.Wake(); // what PUT /api/staff/noise does after it commits
            (await sweeps.WaitForAsync(2, TimeSpan.FromSeconds(10))).Should().BeTrue("a wake starts a sweep at once");
            (await sweeps.StaysAtAsync(2, TimeSpan.FromMilliseconds(400))).Should().BeTrue(
                "noise is on but the clock is not running, so still nothing can post: the pacer sleeps again");

            clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc); // the reaction loop's first tick
            (await sweeps.WaitForAsync(8, TimeSpan.FromSeconds(10))).Should().BeTrue(
                "the clock change wakes the pacer, and with noise on and the clock running it ticks every interval");

            clock.Freeze(exerciseId); // Freeze — the park state
            (await sweeps.SettleAsync(TimeSpan.FromMilliseconds(300), TimeSpan.FromSeconds(10))).Should().BeTrue(
                "a frozen clock stops noise, so the pacer goes back to sleep on its own");

            var frozenAt = sweeps.Count;
            clock.Unfreeze(exerciseId); // leaving Freeze
            (await sweeps.WaitForAsync(frozenAt + 5, TimeSpan.FromSeconds(10))).Should().BeTrue(
                "unfreezing wakes the pacer and it ticks again");

            await SetNoiseLevelAsync(databaseName, exerciseId, NoiseRates.Off);
            (await sweeps.SettleAsync(TimeSpan.FromMilliseconds(300), TimeSpan.FromSeconds(10))).Should().BeTrue(
                "turning noise off needs no wake: the next sweep finds nothing and the pacer sleeps");
        }
        finally
        {
            await pacer.StopAsync(CancellationToken.None);
        }
    }

    // ---- The clock's change listeners ------------------------------------------------------------------------------

    [Fact]
    public void Clock_TellsEveryListener_OnStartFreezeUnfreezeAndJump_ButNotOnARestore()
    {
        var changes = new List<Guid>();
        var clock = new ExerciseClockService(TimeProvider.System, new NullExerciseClockChangeSink(), [new RecordingListener(changes)]);
        var exerciseId = Guid.NewGuid();

        clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        clock.Freeze(exerciseId);
        clock.Unfreeze(exerciseId);
        clock.Jump(exerciseId, 10);
        changes.Should().Equal([exerciseId, exerciseId, exerciseId, exerciseId]);

        // Restore runs at start-up, before any sleeper's first sweep, and is deliberately silent (as for the sink).
        clock.Restore(Guid.NewGuid(), clock.GetAnchor(exerciseId)!);
        changes.Should().HaveCount(4);
    }

    // ---- The safety sweep ------------------------------------------------------------------------------------------

    [Theory]
    [InlineData(null, 12 * 60)]
    [InlineData("", 12 * 60)]
    [InlineData("not a timespan", 12 * 60)]
    [InlineData("06:00:00", 6 * 60)]
    [InlineData("1.00:00:00", 24 * 60)]
    public void SafetySweep_Interval_DefaultsTo12Hours_AndIsConfigurable(string? configured, int expectedMinutes)
    {
        BackgroundWorkSafetySweep.ResolveInterval(configured).Should().Be(TimeSpan.FromMinutes(expectedMinutes));
    }

    [Theory]
    [InlineData("00:00:00")]
    [InlineData("-01:00:00")]
    public void SafetySweep_ZeroOrNegative_DisablesTheNet(string configured)
    {
        BackgroundWorkSafetySweep.ResolveInterval(configured).Should().Be(Timeout.InfiniteTimeSpan);
    }

    [Fact]
    public async Task SafetySweep_WakesEveryRegisteredSleeper_AtOnce()
    {
        // One coordinated wake per interval, so the database is woken once rather than once per service.
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddWakeSignal<EngineReviewTickSignal>(wakeOnClockChange: true);
        services.AddWakeSignal<WhiteNoisePacerSignal>(wakeOnClockChange: true);
        services.AddWakeSignal<Pulse.WebApi.Features.Injects.InjectRunnerSignal>(wakeOnClockChange: false);
        await using var provider = services.BuildServiceProvider();

        provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<BackgroundWorkSafetySweep>().Should()
            .ContainSingle("the sweep is registered once however many sleepers register a signal")
            .Which.WakeAll();

        (await IsWoken(provider.GetRequiredService<EngineReviewTickSignal>())).Should().BeTrue();
        (await IsWoken(provider.GetRequiredService<WhiteNoisePacerSignal>())).Should().BeTrue();
        (await IsWoken(provider.GetRequiredService<Pulse.WebApi.Features.Injects.InjectRunnerSignal>())).Should().BeTrue();
    }

    [Fact]
    public void AddWakeSignal_IsIdempotent_AndAddsAClockListenerOnlyWhenAsked()
    {
        var services = new ServiceCollection();
        services.AddWakeSignal<EngineReviewTickSignal>(wakeOnClockChange: true);
        services.AddWakeSignal<EngineReviewTickSignal>(wakeOnClockChange: true);
        services.AddWakeSignal<Pulse.WebApi.Features.Injects.InjectRunnerSignal>(wakeOnClockChange: false);

        services.Count(d => d.ServiceType == typeof(EngineReviewTickSignal)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(WakeSignal)).Should().Be(2);
        services.Count(d => d.ServiceType == typeof(IExerciseClockChangeListener)).Should().Be(
            1, "the inject runner paces on the wall clock, so only the review tick listens for clock changes");
    }

    // ---- AlwaysOn and exercise resolution ------------------------------------------------------------------------

    [Theory]
    [InlineData("/", true)]
    [InlineData("", true)]
    [InlineData("/health", true)]
    [InlineData("/health/ready", true)]
    [InlineData("/api/feed", false)]
    [InlineData("/hubs/exercise/negotiate", false)]
    [InlineData("/healthz", false)]
    public void ExerciseResolution_SkipsTheProbesAndTheBareRoot_AndNothingElse(string path, bool exempt)
    {
        // App Service AlwaysOn pings "/" every few minutes; resolving the exercise for it was a database query per ping.
        Program.IsExerciseResolutionExempt(new PathString(path)).Should().Be(exempt);
    }

    // ---- helpers ---------------------------------------------------------------------------------------------------

    private static PulseDbContext NewContext(string databaseName, Guid exerciseId) =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(databaseName).Options,
            new ExerciseContext { CurrentExerciseId = exerciseId });

    private static async Task SetNoiseLevelAsync(string databaseName, Guid exerciseId, string level)
    {
        await using var db = NewContext(databaseName, exerciseId);
        var exercise = await db.Exercises.IgnoreQueryFilters().SingleAsync(row => row.Id == exerciseId);
        exercise.NoiseLevel = level;
        await db.SaveChangesAsync();
    }

    private static Task<bool> IsWoken(WakeSignal signal) =>
        signal.WaitAsync(TimeSpan.Zero, TimeProvider.System, CancellationToken.None);

    private static EngineReviewItemEntity ReviewItem(Guid exerciseId, AutonomyLevel level, DraftDisposition disposition) => new()
    {
        DraftId = Guid.NewGuid(),
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        RoutedAtLevel = level,
        Disposition = disposition,
        CountdownStartedScenarioMinute = level == AutonomyLevel.DelayedAuto ? 0 : null,
        CountdownMinutes = level == AutonomyLevel.DelayedAuto ? 5 : null,
        StorylineTag = "#WaterIssues",
        StorylineBrief = "Rising frustration about the water outage.",
        ActionLabel = "reply → @mvega_fh",
        Posts = new List<EngineReviewDraftPost> { new() { PersonaHandle = "@mvega_fh", Text = "Water pressure is dropping." } },
    };

    /// <summary>Counts each sweep at its database-context resolution, over an (initially empty) in-memory store.</summary>
    private sealed class SweepCounter
    {
        private int _count;

        public SweepCounter(string? databaseName = null)
        {
            var name = databaseName ?? Guid.NewGuid().ToString();
            var services = new ServiceCollection();
            services.AddScoped<PulseDbContext>(_ =>
            {
                Interlocked.Increment(ref _count);
                return new PulseDbContext(new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(name).Options);
            });
            ScopeFactory = services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
        }

        public IServiceScopeFactory ScopeFactory { get; }

        public int Count => Volatile.Read(ref _count);

        public async Task<bool> WaitForAsync(int atLeast, TimeSpan within)
        {
            var deadline = DateTime.UtcNow + within;
            while (DateTime.UtcNow < deadline)
            {
                if (Count >= atLeast)
                {
                    return true;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(10));
            }

            return Count >= atLeast;
        }

        /// <summary>Whether the count is exactly <paramref name="expected"/> and stays there for <paramref name="quiet"/>.</summary>
        public async Task<bool> StaysAtAsync(int expected, TimeSpan quiet)
        {
            await Task.Delay(quiet);
            return Count == expected;
        }

        /// <summary>
        /// Whether the count stops moving: unchanged across a <paramref name="quiet"/> window, tried until
        /// <paramref name="within"/> (so a sweep still in flight when the condition changed cannot flake it).
        /// </summary>
        public async Task<bool> SettleAsync(TimeSpan quiet, TimeSpan within)
        {
            var deadline = DateTime.UtcNow + within;
            while (DateTime.UtcNow < deadline)
            {
                var before = Count;
                await Task.Delay(quiet);
                if (Count == before)
                {
                    return true;
                }
            }

            return false;
        }
    }

    /// <summary>Records every clock change it is told about.</summary>
    private sealed class RecordingListener(List<Guid> changes) : IExerciseClockChangeListener
    {
        public void ClockChanged(Guid exerciseId) => changes.Add(exerciseId);
    }
}
