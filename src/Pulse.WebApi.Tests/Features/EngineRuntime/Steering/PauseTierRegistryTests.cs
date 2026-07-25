namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// Unit tests for the server-authoritative tiered-pause registry (world-steering/07; CTL-023, COR-001,
/// COR-050/052). Docker-free: the shipped <see cref="IExerciseClock"/> is mocked so a Freeze/Unfreeze call can
/// be counted exactly, and the <see cref="IPauseOverlayPublisher"/> seam is a recording fake. Proves the
/// per-exercise keying (a Freeze on A never marks B frozen), that the clock is touched on the Freeze transition
/// and ONLY there, and that every actual transition reaches the overlay publisher.
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

    /// <summary>A clock that reports every exercise as STARTED and running, so Freeze/Unfreeze are reachable.</summary>
    private static Mock<IExerciseClock> StartedClock()
    {
        var clock = new Mock<IExerciseClock>();
        clock.Setup(c => c.IsRunning(It.IsAny<Guid>())).Returns(true);
        return clock;
    }

    private static PauseTierRegistry RegistryFor(
        Mock<IExerciseClock> clock,
        IPauseOverlayPublisher publisher) =>
        new(clock.Object, publisher, NullLogger<PauseTierRegistry>.Instance);

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

        await registry.SetTierAsync(exerciseA, PauseTier.Freeze, "human-controller-01");

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

        await registry.SetTierAsync(exerciseA, PauseTier.Freeze, "human-controller-01");

        clock.Verify(c => c.Freeze(exerciseA), Times.Once);
        clock.Verify(c => c.Freeze(exerciseB), Times.Never, "COR-001: a Freeze on A must never reach B's clock");
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

    // ---- the clock: touched on Freeze, and ONLY on Freeze (COR-050/052) ------------------------

    [Fact]
    public async Task SetTierAsync_EnteringFreeze_CallsClockFreezeExactlyOnce()
    {
        var exerciseId = Guid.NewGuid();
        var clock = StartedClock();
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01");

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

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01");
        await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01");

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

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01");
        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01");

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

        await registry.SetTierAsync(exerciseId, tier, "human-controller-01");

        clock.Verify(c => c.Freeze(It.IsAny<Guid>()), Times.Never,
            "Injects-paused / Engine-paused leave scenario time advancing exactly as when running");
        clock.Verify(c => c.Unfreeze(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task SetTierAsync_FreezeWithNoStartedClock_RecordsTheTierWithoutCallingTheClock()
    {
        // ExerciseClockService throws for an unstarted clock (the reaction loop starts it lazily on its first
        // tick). A controller's safety action must not 500: the tier is recorded, the clock call is skipped.
        var exerciseId = Guid.NewGuid();
        var clock = new Mock<IExerciseClock>(MockBehavior.Strict);
        clock.Setup(c => c.IsRunning(exerciseId)).Returns(false);
        clock.Setup(c => c.IsFrozen(exerciseId)).Returns(false);
        var registry = RegistryFor(clock, new RecordingPauseOverlayPublisher());

        var transition = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01");

        transition.Should().NotBeNull();
        registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze);
        clock.Verify(c => c.Freeze(It.IsAny<Guid>()), Times.Never,
            "an unstarted clock has no scenario time to hold — skipped and logged, never a 500");
    }

    // ---- the overlay-publisher seam (story 08) --------------------------------------------------

    [Fact]
    public async Task SetTierAsync_EveryTransition_InvokesTheOverlayPublisher()
    {
        var exerciseId = Guid.NewGuid();
        var publisher = new RecordingPauseOverlayPublisher();
        var registry = RegistryFor(StartedClock(), publisher);

        await registry.SetTierAsync(exerciseId, PauseTier.Injects, "human-controller-01");
        await registry.SetTierAsync(exerciseId, PauseTier.Engine, "human-controller-01");
        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "human-controller-01");
        await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01");

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

        var transition = await registry.SetTierAsync(exerciseId, PauseTier.Running, "human-controller-01");

        transition.Should().BeNull("the exercise was already running — there is no transition");
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

        var act = async () => await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Freeze, "human-controller-01");

        await act.Should().NotThrowAsync(
            "story 07 ships the no-op default so it does not block on story 08's real publisher");
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
