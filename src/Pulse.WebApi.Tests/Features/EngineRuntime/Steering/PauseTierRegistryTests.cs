namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Unit tests for the server-authoritative tiered-pause registry (world-steering/07; CTL-023, COR-001,
/// COR-050/052). Docker-free: the shipped <see cref="IExerciseClock"/> is either a STATEFUL Moq fake (so a
/// Freeze/Unfreeze call can be counted exactly AND the post-freeze verification read is honest) or — for the
/// CR-001 cold-clock proofs — the REAL <see cref="ExerciseClockService"/>, so the start-then-freeze path is
/// exercised against the actual shipped clock. The <see cref="IPauseOverlayPublisher"/> seam is a recording fake.
///
/// <para>Proves the per-exercise keying (a Freeze on A never marks B frozen), that the clock is touched on the
/// Freeze transition and ONLY there, that a freeze which cannot be applied records NOTHING and reports
/// <see cref="PauseTierOutcome.ClockUnavailable"/> (CR-001 — never a success for a world that kept moving), and
/// that every actual transition reaches the overlay publisher without a publish failure being able to undo it
/// (WR-004).</para>
/// </summary>
public sealed class PauseTierRegistryTests
{
    /// <summary>A recording <see cref="IPauseOverlayPublisher"/> — the story-08 seam, faked here.</summary>
    private sealed class RecordingPauseOverlayPublisher : IPauseOverlayPublisher
    {
        public List<PauseTierTransition> Published { get; } = [];

        public Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default)
        {
            Published.Add(transition);
            return Task.CompletedTask;
        }
    }

    /// <summary>A publisher that fails the way story 08's real SignalR fan-out could (WR-004).</summary>
    private sealed class ThrowingPauseOverlayPublisher : IPauseOverlayPublisher
    {
        public int Calls { get; private set; }

        public Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default)
        {
            Calls++;
            throw new InvalidOperationException("SignalR fan-out failed");
        }
    }

    /// <summary>
    /// A STATEFUL clock fake reporting every exercise as already STARTED: <c>Freeze</c>/<c>Unfreeze</c> actually
    /// flip what <c>IsFrozen</c> returns, so the registry's post-effect verification read sees the truth (a bare
    /// <c>Mock</c> returning <c>false</c> for <c>IsFrozen</c> would — correctly — be treated as a failed freeze).
    /// </summary>
    private static Mock<IExerciseClock> StartedClock()
    {
        var frozen = new HashSet<Guid>();
        var clock = new Mock<IExerciseClock>();
        clock.Setup(c => c.IsFrozen(It.IsAny<Guid>())).Returns((Guid id) => frozen.Contains(id));
        clock.Setup(c => c.IsRunning(It.IsAny<Guid>())).Returns((Guid id) => !frozen.Contains(id));
        clock.Setup(c => c.Freeze(It.IsAny<Guid>())).Callback((Guid id) => frozen.Add(id));
        clock.Setup(c => c.Unfreeze(It.IsAny<Guid>())).Callback((Guid id) => frozen.Remove(id));
        return clock;
    }

    /// <summary>
    /// A STATEFUL clock fake that has NEVER been started — mimicking the shipped
    /// <see cref="ExerciseClockService"/>, including its throw when <c>Freeze</c> is called on an unstarted clock.
    /// This is the DEFAULT state of a fresh host (only <c>ReactionLoopHost.EnsureClockStarted</c> starts clocks).
    /// </summary>
    private static Mock<IExerciseClock> UnstartedClock()
    {
        var started = new HashSet<Guid>();
        var frozen = new HashSet<Guid>();
        var clock = new Mock<IExerciseClock>();
        clock.Setup(c => c.IsFrozen(It.IsAny<Guid>())).Returns((Guid id) => frozen.Contains(id));
        clock.Setup(c => c.IsRunning(It.IsAny<Guid>()))
            .Returns((Guid id) => started.Contains(id) && !frozen.Contains(id));
        clock.Setup(c => c.Start(It.IsAny<Guid>(), It.IsAny<DateTimeOffset>(), It.IsAny<TimeZoneInfo>()))
            .Callback((Guid id, DateTimeOffset _, TimeZoneInfo _) => started.Add(id));
        clock.Setup(c => c.Freeze(It.IsAny<Guid>())).Callback((Guid id) =>
        {
            if (!started.Contains(id))
            {
                throw new InvalidOperationException($"Exercise {id} has no started clock.");
            }

            frozen.Add(id);
        });
        clock.Setup(c => c.Unfreeze(It.IsAny<Guid>())).Callback((Guid id) => frozen.Remove(id));
        return clock;
    }

    private static PauseTierRegistry RegistryFor(
        Mock<IExerciseClock> clock,
        IPauseOverlayPublisher publisher) =>
        new(clock.Object, publisher, NullLogger<PauseTierRegistry>.Instance);

    private static PauseTierRegistry RegistryFor(
        IExerciseClock clock,
        IPauseOverlayPublisher publisher) =>
        new(clock, publisher, NullLogger<PauseTierRegistry>.Instance);

    /// <summary>A start point for a cold clock, the way the endpoint resolves it from the exercise row.</summary>
    private static PauseClockStart ClockStart() =>
        new(new DateTimeOffset(2033, 9, 4, 14, 0, 0, TimeSpan.Zero), TimeZoneInfo.Utc);

    // ---- per-exercise keying (COR-001) ---------------------------------------------------------

    [Fact]
    public void GetTier_UnknownExercise_DefaultsToRunning()
    {
        var registry = RegistryFor(StartedClock(), new RecordingPauseOverlayPublisher());

        registry.GetTier(Guid.NewGuid()).Should().Be(
            PauseTier.Running, "an exercise that has never been paused reads the unpaused baseline");
    }

    [Fact]
    public async Task SetTierAsync_KeysEachExerciseIndependently()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var registry = RegistryFor(StartedClock(), new RecordingPauseOverlayPublisher());

        await registry.SetTierAsync(exerciseA, PauseTier.Freeze, "human-controller-01", ClockStart());

        registry.GetTier(exerciseA).Should().Be(PauseTier.Freeze);
        registry.GetTier(exerciseB).Should().Be(
            PauseTier.Running, "COR-001: a Freeze on exercise A never marks exercise B frozen");
    }

    [Fact]
    public async Task SetTierAsync_FreezeOnExerciseA_NeverTouchesExerciseBsClock()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var clock = StartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        await registry.SetTierAsync(exerciseA, PauseTier.Freeze, "human-controller-01", ClockStart());

        clock.Verify(c => c.Freeze(exerciseA), Times.Once);
        clock.Verify(c => c.Freeze(exerciseB), Times.Never, "COR-001: a Freeze on A must never reach B's clock");
        clock.Object.IsFrozen(exerciseB).Should().BeFalse();
    }

    [Fact]
    public async Task SetTierAsync_EmptyExercise_ThrowsFailClosed()
    {
        var registry = RegistryFor(StartedClock(), new RecordingPauseOverlayPublisher());

        var act = async () => await registry.SetTierAsync(Guid.Empty, PauseTier.Freeze, "human-controller-01");

        await act.Should().ThrowAsync<ArgumentException>(
            "an unresolved scope collapses to Guid.Empty and must never be accepted as an exercise (COR-001)");
    }

    [Fact]
    public async Task SetTierAsync_BlankActingHuman_ThrowsFailClosed()
    {
        var registry = RegistryFor(StartedClock(), new RecordingPauseOverlayPublisher());

        var act = async () => await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Engine, "   ");

        await act.Should().ThrowAsync<ArgumentException>("COR-018: a tier change is always attributed to a human");
    }

    // ---- CR-001: a Freeze either really takes, or is refused (never a silent no-op) --------------

    [Fact]
    public async Task SetTierAsync_FreezeOnAColdClock_StartsItThenFreezesIt_AgainstTheRealClock()
    {
        // The DEFAULT state of a fresh host: no reaction loop has ticked, so IExerciseClock.Start has never been
        // called for this exercise. Story 07 must still genuinely halt it — this runs against the REAL
        // ExerciseClockService, which THROWS if Freeze is called on an unstarted clock.
        var exerciseId = Guid.NewGuid();
        var clock = new ExerciseClockService(new ManualTimeProvider(DateTimeOffset.UnixEpoch));
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());
        clock.IsFrozen(exerciseId).Should().BeFalse("the clock has never been started");

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        result.Outcome.Should().Be(PauseTierOutcome.Applied);
        clock.IsFrozen(exerciseId).Should().BeTrue(
            "CR-001: the freeze must be REAL — ReactionLoopHost.TickExerciseAsync skips a tick on exactly this flag");
        registry.IsClockFrozen(exerciseId).Should().BeTrue();
        registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze);
    }

    [Fact]
    public async Task SetTierAsync_FreezeOnAColdClock_SurvivesTheReactionLoopsOwnLazyStart()
    {
        // The loop's lazy start only starts a clock that is neither running NOR frozen, so its first tick must NOT
        // clobber a freeze applied before it — otherwise the engine would generate while the console reads WORLD
        // FROZEN. This calls the PRODUCTION predicate (ReactionLoopHost.ShouldStartClock, which
        // EnsureClockStarted itself uses) rather than re-implementing the boolean, so a regression there fails
        // HERE — the whole CR-001 fix rests on that guard.
        var exerciseId = Guid.NewGuid();
        var clock = new ExerciseClockService(new ManualTimeProvider(DateTimeOffset.UnixEpoch));
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        ReactionLoopHost.ShouldStartClock(clock, exerciseId).Should().BeTrue(
            "sanity: before the freeze this cold clock is exactly what the loop WOULD start");

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        ReactionLoopHost.ShouldStartClock(clock, exerciseId).Should().BeFalse(
            "the loop must leave an already-frozen clock alone");
        clock.IsFrozen(exerciseId).Should().BeTrue();
    }

    [Fact]
    public async Task SetTierAsync_RefusedFreeze_LeavesTheClockUnfrozen_NeverHalfFrozen()
    {
        // SG-202: a clock that accepts Freeze but reports itself unfrozen is non-conforming. Since the tier is
        // refused (the console will show RUNNING), the clock must not be left held — that is the mirror-image lie.
        var exerciseId = Guid.NewGuid();
        var frozenCalls = 0;
        var unfrozenCalls = 0;
        var clock = new Mock<IExerciseClock>();
        clock.Setup(c => c.IsRunning(It.IsAny<Guid>())).Returns(true);
        clock.Setup(c => c.IsFrozen(It.IsAny<Guid>())).Returns(false);
        clock.Setup(c => c.Freeze(It.IsAny<Guid>())).Callback(() => frozenCalls++);
        clock.Setup(c => c.Unfreeze(It.IsAny<Guid>())).Callback(() => unfrozenCalls++);
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        result.Outcome.Should().Be(PauseTierOutcome.ClockUnavailable);
        frozenCalls.Should().Be(1);
        unfrozenCalls.Should().Be(1, "the refused freeze is compensated, so nothing is left half-frozen");
        registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    [Fact]
    public async Task SetTierAsync_FreezeWithNoStartPoint_IsREFUSED_AndRecordsNothing()
    {
        // The endpoint could not resolve the exercise row, so the clock cannot be started. The freeze must NOT be
        // recorded: reporting success here is exactly the "console says WORLD FROZEN while the world moves" bug.
        var exerciseId = Guid.NewGuid();
        var clock = UnstartedClock();
        var publisher = new RecordingPauseOverlayPublisher();
        var registry = RegistryFor(clock, publisher);

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", clockStart: null);

        result.Outcome.Should().Be(PauseTierOutcome.ClockUnavailable);
        result.Transition.Should().BeNull();
        registry.GetTier(exerciseId).Should().Be(PauseTier.Running, "a refused freeze records NOTHING");
        registry.IsClockFrozen(exerciseId).Should().BeFalse();
        publisher.Published.Should().BeEmpty("nothing happened, so nothing is published");
        clock.Verify(c => c.Freeze(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task SetTierAsync_FreezeWhenTheClockThrows_IsREFUSED_AndRecordsNothing()
    {
        // SG-002: the clock effect is applied BEFORE the tier is recorded, so a throwing clock can never leave a
        // recorded tier behind.
        var exerciseId = Guid.NewGuid();
        var clock = StartedClock();
        clock.Setup(c => c.Freeze(It.IsAny<Guid>())).Throws(new InvalidOperationException("clock exploded"));
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        result.Outcome.Should().Be(PauseTierOutcome.ClockUnavailable);
        registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    [Fact]
    public async Task SetTierAsync_FreezeThatCannotBeVerified_IsREFUSED()
    {
        // A clock that accepts Freeze but still reports IsFrozen == false is not frozen. Verify, never assume.
        var exerciseId = Guid.NewGuid();
        var clock = new Mock<IExerciseClock>();
        clock.Setup(c => c.IsRunning(It.IsAny<Guid>())).Returns(true);
        clock.Setup(c => c.IsFrozen(It.IsAny<Guid>())).Returns(false);
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        result.Outcome.Should().Be(PauseTierOutcome.ClockUnavailable);
        registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    [Fact]
    public async Task SetTierAsync_ResumeIsNeverBlockedByAnUnstartedClock()
    {
        // Nothing was ever ticking, so there is nothing to unfreeze — a Resume must still succeed.
        var exerciseId = Guid.NewGuid();
        var clock = UnstartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());
        await registry.SetTierAsync(exerciseId, PauseTier.Engine, "human-controller-01");

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01");

        result.Outcome.Should().Be(PauseTierOutcome.Applied);
        registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    // ---- the clock: touched on Freeze, and ONLY on Freeze (COR-050/052) ------------------------

    [Fact]
    public async Task SetTierAsync_EnteringFreeze_CallsClockFreezeExactlyOnce()
    {
        var exerciseId = Guid.NewGuid();
        var clock = StartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        clock.Verify(c => c.Freeze(exerciseId), Times.Once,
            "entering Freeze drives the ALREADY-BUILT clock the reaction loop already checks (IsFrozen)");
        clock.Verify(c => c.Unfreeze(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task SetTierAsync_LeavingFreezeToRunning_CallsClockUnfreezeExactlyOnce()
    {
        var exerciseId = Guid.NewGuid();
        var clock = StartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());
        await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01", ClockStart());

        clock.Verify(c => c.Freeze(exerciseId), Times.Once);
        clock.Verify(c => c.Unfreeze(exerciseId), Times.Once,
            "Resume unfreezes exactly once — the clock resumes at the scenario minute it held (COR-050)");
    }

    [Fact]
    public async Task SetTierAsync_ReSelectingFreeze_DoesNotFreezeTwice()
    {
        var exerciseId = Guid.NewGuid();
        var clock = StartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());
        var second = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        second.Outcome.Should().Be(PauseTierOutcome.Unchanged);
        clock.Verify(c => c.Freeze(exerciseId), Times.Once, "re-selecting the active tier is a no-op");
    }

    [Theory]
    [InlineData(PauseTier.Injects)]
    [InlineData(PauseTier.Engine)]
    public async Task SetTierAsync_NonFreezeTiers_NeverTouchTheClock(PauseTier tier)
    {
        var exerciseId = Guid.NewGuid();
        var clock = StartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        var result = await registry.SetTierAsync(exerciseId, tier, "human-controller-01", ClockStart());

        result.Outcome.Should().Be(PauseTierOutcome.Applied);
        clock.Verify(c => c.Freeze(It.IsAny<Guid>()), Times.Never,
            "Injects-paused / Engine-paused leave scenario time advancing exactly as when running");
        clock.Verify(c => c.Unfreeze(It.IsAny<Guid>()), Times.Never);
        clock.Verify(c => c.Start(It.IsAny<Guid>(), It.IsAny<DateTimeOffset>(), It.IsAny<TimeZoneInfo>()), Times.Never,
            "only a Freeze ever needs to start a cold clock");
    }

    // ---- the overlay-publisher seam (story 08) --------------------------------------------------

    [Fact]
    public async Task SetTierAsync_EveryTransition_InvokesTheOverlayPublisher()
    {
        var exerciseId = Guid.NewGuid();
        var publisher = new RecordingPauseOverlayPublisher();
        var registry = RegistryFor(StartedClock(), publisher);

        await registry.SetTierAsync(exerciseId, PauseTier.Injects, "human-controller-01", ClockStart());
        await registry.SetTierAsync(exerciseId, PauseTier.Engine, "human-controller-01", ClockStart());
        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());
        await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01", ClockStart());

        publisher.Published.Should().HaveCount(4, "every ACTUAL transition reaches the overlay seam");
        publisher.Published.Should().AllSatisfy(t => t.ExerciseId.Should().Be(exerciseId));
        publisher.Published.Select(t => (t.From, t.To)).Should().Equal(
            [
                (PauseTier.Running, PauseTier.Injects),
                (PauseTier.Injects, PauseTier.Engine),
                (PauseTier.Engine, PauseTier.Freeze),
                (PauseTier.Freeze, PauseTier.Running),
            ],
            "the publisher sees the exact from -> to sequence the controller drove");
    }

    [Fact]
    public async Task SetTierAsync_NoChange_PublishesNothing()
    {
        var exerciseId = Guid.NewGuid();
        var publisher = new RecordingPauseOverlayPublisher();
        var registry = RegistryFor(StartedClock(), publisher);

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01");

        result.Outcome.Should().Be(PauseTierOutcome.Unchanged);
        result.Transition.Should().BeNull("the exercise was already running — there is no transition");
        publisher.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task SetTierAsync_CarriesTheActingHuman_ToThePublisher()
    {
        var publisher = new RecordingPauseOverlayPublisher();
        var registry = RegistryFor(StartedClock(), publisher);

        await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Engine, "human-lead-7");

        publisher.Published.Should().ContainSingle()
            .Which.ActingHumanId.Should().Be("human-lead-7", "COR-018 attribution rides the transition");
    }

    [Fact]
    public async Task NullOverlayPublisher_TheStory07Default_DoesNotThrow()
    {
        var registry = RegistryFor(StartedClock(), new NullPauseOverlayPublisher());

        var act = async () =>
            await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Freeze, "human-controller-01", ClockStart());

        await act.Should().NotThrowAsync(
            "story 07 ships the no-op default so it does not block on story 08's real publisher");
    }

    [Fact]
    public async Task SetTierAsync_AThrowingOverlayPublisher_NeverUndoesAnAppliedFreeze()
    {
        // WR-004: story 08's real publisher lands on this seam. A throw AFTER the clock is frozen must not 500 the
        // request — that would make the console revert to RUNNING while the server's world stays FROZEN.
        var exerciseId = Guid.NewGuid();
        var clock = new ExerciseClockService(new ManualTimeProvider(DateTimeOffset.UnixEpoch));
        var publisher = new ThrowingPauseOverlayPublisher();
        var registry = RegistryFor(clock, publisher);

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01", ClockStart());

        publisher.Calls.Should().Be(1);
        result.Outcome.Should().Be(PauseTierOutcome.Applied, "a best-effort publish failure never undoes the tier");
        registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze);
        clock.IsFrozen(exerciseId).Should().BeTrue("the applied freeze STANDS — the client must not revert it");
    }

    // ---- the wire vocabulary (the frozen client is the seam) ------------------------------------

    [Theory]
    [InlineData(PauseTier.Running, "running")]
    [InlineData(PauseTier.Injects, "injects")]
    [InlineData(PauseTier.Engine, "engine")]
    [InlineData(PauseTier.Freeze, "freeze")]
    public void PauseTierWire_RoundTripsTheFrozenClientLiterals(PauseTier tier, string wire)
    {
        PauseTierWire.ToWire(tier).Should().Be(wire);
        PauseTierWire.TryParse(wire, out var parsed).Should().BeTrue();
        parsed.Should().Be(tier);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Freeze")]
    [InlineData("world-frozen")]
    public void PauseTierWire_RejectsAnythingElse(string? raw)
    {
        PauseTierWire.TryParse(raw, out _).Should().BeFalse("an unrecognised tier literal is a 400, never a guess");
    }
}
