namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// Story 03 — native scenario-clock behaviour: StartEx + monotonic tick (AC-1), Freeze holds the minute and a
/// countdown does not accrue (AC-2), a discrete jump leaps the minute and carries a countdown past its
/// deadline to a HOLD (AC-3), the engine reads one clock through the adapter (AC-5), scenario-time-only
/// (AC-6), and per-exercise isolation (AC-7). Model-only (no <see cref="PulseDbContext"/>), so plain
/// <c>[Fact]</c>.
/// </summary>
public sealed class ExerciseClockServiceTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 8, 0, 0, TimeSpan.Zero);

    private static IScenarioClock AdapterFor(IExerciseClock clock, Guid exerciseId) =>
        new ScenarioClockAdapter(clock, new ExerciseContext { CurrentExerciseId = exerciseId });

    // ---- AC-1: StartEx + monotonic tick -----------------------------------------------------------

    [Fact]
    public void Start_beginsAtScenarioStartInExerciseTimeZone()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        var zone = TimeZoneInfo.CreateCustomTimeZone("Test+5", TimeSpan.FromHours(5), "Test+5", "Test+5");

        clock.Start(exerciseId, ScenarioStart, zone);

        clock.CurrentScenarioMinute(exerciseId).Should().Be(0, "the clock reads scenario minute 0 at StartEx");
        var now = clock.CurrentScenarioTime(exerciseId);
        now.Should().Be(new DateTimeOffset(2033, 6, 1, 13, 0, 0, TimeSpan.FromHours(5)),
            "the scenario start instant is expressed in the exercise time zone (+05:00)");
    }

    [Fact]
    public void CurrentScenarioMinute_advancesMonotonicallyWithScenarioTime()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        clock.CurrentScenarioMinute(exerciseId).Should().Be(0);

        time.Advance(TimeSpan.FromSeconds(90));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(1, "90s of scenario time floors to 1 minute");

        time.Advance(TimeSpan.FromMinutes(4));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(5, "minutes only ever increase (monotonic)");
        clock.IsRunning(exerciseId).Should().BeTrue();
    }

    [Fact]
    public void CurrentScenarioMinute_unstartedExercise_readsZeroNeverThrows()
    {
        var clock = new ExerciseClockService(new ManualTimeProvider(DateTimeOffset.UnixEpoch));

        clock.CurrentScenarioMinute(Guid.NewGuid()).Should().Be(0, "an unstarted clock is scenario minute 0");
        clock.CurrentScenarioTime(Guid.NewGuid()).Should().BeNull();
        clock.IsRunning(Guid.NewGuid()).Should().BeFalse();
    }

    // ---- AC-2: Freeze holds the clock (COR-052 / CTL-023) -----------------------------------------

    [Fact]
    public void Freeze_holdsScenarioMinute_andResumesExactlyWhereItStopped()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        time.Advance(TimeSpan.FromMinutes(10));
        clock.Freeze(exerciseId);
        clock.IsFrozen(exerciseId).Should().BeTrue();

        // Wall time passes while frozen — scenario time must not accrue.
        time.Advance(TimeSpan.FromMinutes(30));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(10, "scenario time holds constant while frozen");

        clock.Unfreeze(exerciseId);
        clock.CurrentScenarioMinute(exerciseId).Should().Be(10, "unfreeze resumes exactly where it stopped");

        time.Advance(TimeSpan.FromMinutes(3));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(13, "the 30 frozen minutes never counted");
    }

    [Fact]
    public void Freeze_delayedAutoCountdown_doesNotAdvance_andResumesWithSameRemaining()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        // A 10-minute countdown begun at scenario minute 0.
        var countdown = new DelayedAutoCountdown(exerciseId, Guid.NewGuid(), Guid.NewGuid(), 0, 10);

        time.Advance(TimeSpan.FromMinutes(6));
        var scenario = AdapterFor(clock, exerciseId);
        countdown.MinutesRemaining(scenario.CurrentScenarioMinute).Should().Be(4);

        clock.Freeze(exerciseId);
        time.Advance(TimeSpan.FromMinutes(100));
        countdown.MinutesRemaining(scenario.CurrentScenarioMinute).Should().Be(4,
            "a frozen scenario clock does not advance the Delayed-auto countdown (COR-052)");
        countdown.HasExpired(scenario.CurrentScenarioMinute).Should().BeFalse();

        clock.Unfreeze(exerciseId);
        countdown.MinutesRemaining(scenario.CurrentScenarioMinute).Should().Be(4,
            "the window still has exactly 4 minutes left on unfreeze");
    }

    // ---- AC-3: Discrete time-jump (COR-051 / CTL-015) ---------------------------------------------

    [Fact]
    public void Jump_advancesCurrentScenarioMinuteByN_inOneStep()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        time.Advance(TimeSpan.FromMinutes(5));
        clock.Jump(exerciseId, 45);

        clock.CurrentScenarioMinute(exerciseId).Should().Be(50, "5 elapsed + a 45-minute jump, in one step");

        time.Advance(TimeSpan.FromMinutes(2));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(52, "scenario time resumes running after the jump");
    }

    [Fact]
    public void Jump_countdownCarriedPastDeadline_resolvesToHold_viaAutoHoldPolicy_neverAutoSend()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var countdown = new DelayedAutoCountdown(exerciseId, Guid.NewGuid(), Guid.NewGuid(), 0, 10);
        var scenario = AdapterFor(clock, exerciseId);

        // Jump well past the 10-minute deadline in one step — the countdown never got a controller decision.
        clock.Jump(exerciseId, 30);
        countdown.HasExpired(scenario.CurrentScenarioMinute).Should().BeTrue();

        var evaluation = AutoHoldPolicy.Evaluate(
            countdown,
            EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto),
            scenario.CurrentScenarioMinute,
            swampedMode: false);

        evaluation.Disposition.Should().Be(TimeoutDisposition.Hold,
            "a countdown carried past its deadline by a jump resolves to HOLD — silence is never approval (D5-014/1.1)");
        evaluation.ViaSwampedMode.Should().BeFalse("there was no auto-send");
        evaluation.Event.Should().NotBeNull("the on-expiry hold is a loggable autonomy transition (XC-004)");
    }

    [Fact]
    public void Jump_storylineWindowBlownDuringSkip_surfacesOnNextObserveTick()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        var scenario = AdapterFor(clock, exerciseId);

        var storyline = Storyline.Create(exerciseId, "Water main fears", "Issue a boil-water notice", responseWindowMin: 20);
        storyline.Seed(scenario.CurrentScenarioMinute);

        // A 30-minute jump blows the 20-minute silence window in one step.
        clock.Jump(exerciseId, 30);
        storyline.Tick(scenario);

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "the blown window opened the storyline");

        var observed = ObserveStage.Observe([storyline], [], scenario);
        observed.InactionTriggers.Should().ContainSingle()
            .Which.StorylineId.Should().Be(storyline.Id,
                "the storyline whose window blew during the skip surfaces as an inaction trigger on the next observe");
    }

    // ---- AC-5: the engine reads ONE clock through the adapter -------------------------------------

    [Fact]
    public void ScenarioClockAdapter_readsTheNativeClock_notAParallelClock()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        var scenario = AdapterFor(clock, exerciseId);

        time.Advance(TimeSpan.FromMinutes(7));
        scenario.CurrentScenarioMinute.Should().Be(7).And.Be(clock.CurrentScenarioMinute(exerciseId));

        clock.Freeze(exerciseId);
        time.Advance(TimeSpan.FromMinutes(50));
        scenario.CurrentScenarioMinute.Should().Be(7, "the adapter holds when the native clock is frozen");

        clock.Unfreeze(exerciseId);
        clock.Jump(exerciseId, 100);
        scenario.CurrentScenarioMinute.Should().Be(107, "the adapter leaps when the native clock jumps");
    }

    [Fact]
    public void ScenarioClockAdapter_unresolvedScope_readsZero_failClosed()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var startedExercise = Guid.NewGuid();
        clock.Start(startedExercise, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(42));

        var unresolved = new ScenarioClockAdapter(clock, new ExerciseContext { CurrentExerciseId = null });
        unresolved.CurrentScenarioMinute.Should().Be(0,
            "an unresolved scope reads scenario minute 0, never another exercise's minute (fail-closed, COR-001)");
    }

    // ---- AC-7: per-exercise isolation (COR-001) ---------------------------------------------------

    [Fact]
    public void Freeze_isPerExercise_doesNotMoveAnotherExercisesMinute()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        clock.Start(exerciseA, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(exerciseB, ScenarioStart, TimeZoneInfo.Utc);

        time.Advance(TimeSpan.FromMinutes(10));
        clock.Freeze(exerciseA);
        time.Advance(TimeSpan.FromMinutes(20));

        clock.CurrentScenarioMinute(exerciseA).Should().Be(10, "A is frozen at 10");
        clock.CurrentScenarioMinute(exerciseB).Should().Be(30, "B kept running — A's freeze never touched B");
    }

    [Fact]
    public void Jump_isPerExercise_doesNotMoveAnotherExercisesMinute()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var clock = new ExerciseClockService(time);
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        clock.Start(exerciseA, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(exerciseB, ScenarioStart, TimeZoneInfo.Utc);

        time.Advance(TimeSpan.FromMinutes(5));
        clock.Jump(exerciseA, 90);

        clock.CurrentScenarioMinute(exerciseA).Should().Be(95, "A jumped");
        clock.CurrentScenarioMinute(exerciseB).Should().Be(5, "A's jump never moved B's minute (COR-001)");
    }

    // ---- guards -----------------------------------------------------------------------------------

    [Fact]
    public void MutatingOperations_onUnstartedClock_throw()
    {
        var clock = new ExerciseClockService(new ManualTimeProvider(DateTimeOffset.UnixEpoch));
        var exerciseId = Guid.NewGuid();

        FluentActions.Invoking(() => clock.Freeze(exerciseId)).Should().Throw<InvalidOperationException>();
        FluentActions.Invoking(() => clock.Jump(exerciseId, 5)).Should().Throw<InvalidOperationException>();
        FluentActions.Invoking(() => clock.Jump(exerciseId, -1)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => clock.Start(Guid.Empty, ScenarioStart, TimeZoneInfo.Utc))
            .Should().Throw<ArgumentException>("a clock must name an exercise (COR-001)");
    }
}
