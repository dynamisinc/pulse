namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// Unit tests for the per-exercise participant-overlay store (world-steering/08; CTL-023, COR-001, XC-001).
/// Docker-free (<see cref="FactAttribute"/>): the store is pure in-memory runtime state with no collaborators.
///
/// <para>Proves the Freeze/Resume transitions the participant shell renders, that state is keyed INDEPENDENTLY
/// per exercise (a Freeze in A leaves B cleared — the always-Critical isolation property), that an unknown or
/// EMPTY (unresolved) scope reads the cleared state rather than anyone else's, and that an out-of-order write is
/// dropped so a late stale publish cannot re-show a holding page on a resumed world.</para>
/// </summary>
public sealed class OverlayStateServiceTests
{
    // ---- AC1/AC3: Freeze writes a pause overlay, Resume clears it -------------------------------

    [Fact]
    public void Get_ExerciseNeverFrozen_ReadsTheClearedNoneState()
    {
        var service = new OverlayStateService();

        var snapshot = service.Get(Guid.NewGuid());

        snapshot.State.Should().Be("none", "an untouched exercise must never fail OPEN into showing an overlay");
        snapshot.Register.Should().Be("in-fiction");
        snapshot.Message.Should().BeEmpty();
        snapshot.Sequence.Should().Be(0);
    }

    [Fact]
    public void Apply_Pause_ThenGet_ReflectsTheHoldingPageState()
    {
        var service = new OverlayStateService();
        var exerciseId = Guid.NewGuid();

        service.Apply(exerciseId, "pause", "out-of-fiction", service.NextSequence());

        var snapshot = service.Get(exerciseId);
        snapshot.State.Should().Be("pause", "GET /api/overlay-state must serve this instead of the static 'none' constant");
        snapshot.Register.Should().Be("out-of-fiction");
        snapshot.Message.Should().BeEmpty("holding-page authoring (COR-032) is out of scope — the shell renders static copy");
    }

    [Fact]
    public void Apply_None_AfterAPause_ClearsTheOverlay()
    {
        var service = new OverlayStateService();
        var exerciseId = Guid.NewGuid();
        service.Apply(exerciseId, "pause", "out-of-fiction", service.NextSequence());

        service.Apply(exerciseId, "none", "in-fiction", service.NextSequence());

        var snapshot = service.Get(exerciseId);
        snapshot.State.Should().Be("none", "Resume must clear the rendered holding page (OverlayLayer renders null for 'none')");
        snapshot.Register.Should().Be("in-fiction");
    }

    [Fact]
    public void Apply_EitherRegister_IsStoredVerbatim()
    {
        var service = new OverlayStateService();
        var inFiction = Guid.NewGuid();
        var outOfFiction = Guid.NewGuid();

        service.Apply(inFiction, "pause", "in-fiction", service.NextSequence());
        service.Apply(outOfFiction, "pause", "out-of-fiction", service.NextSequence());

        service.Get(inFiction).Register.Should().Be(
            "in-fiction", "the hyphenated wire literal is the frozen client's union member, not a C# enum name");
        service.Get(outOfFiction).Register.Should().Be("out-of-fiction");
    }

    // ---- AC6: isolation (COR-001/XC-001) -------------------------------------------------------

    [Fact]
    public void Apply_IsKeyedPerExercise_AFreezeInANeverTouchesB()
    {
        var service = new OverlayStateService();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        service.Apply(exerciseA, "pause", "out-of-fiction", service.NextSequence());

        service.Get(exerciseA).State.Should().Be("pause");
        service.Get(exerciseB).State.Should().Be(
            "none", "COR-001: a participant in exercise B must never see exercise A's Freeze");
        service.Get(exerciseB).Should().BeSameAs(
            OverlayStateService.Cleared, "B reads the shared cleared snapshot — there is no cross-exercise state at all");
    }

    [Fact]
    public void Get_EmptyScope_ReadsTheClearedState_NeverAnExercisesOverlay()
    {
        var service = new OverlayStateService();
        var exerciseId = Guid.NewGuid();
        service.Apply(exerciseId, "pause", "out-of-fiction", service.NextSequence());

        var snapshot = service.Get(Guid.Empty);

        snapshot.State.Should().Be(
            "none",
            "Guid.Empty is the fail-closed unresolved scope: it must match nothing, never the first/any exercise's overlay");
    }

    [Fact]
    public void Apply_EmptyExercise_Throws_NeverWritesAnUnscopedOverlay()
    {
        var service = new OverlayStateService();

        var act = () => service.Apply(Guid.Empty, "pause", "out-of-fiction", 1);

        act.Should().Throw<ArgumentException>("an overlay write must name a server-resolved exercise (COR-001)");
    }

    // ---- the out-of-order guard (story-07 review note SG-206) -----------------------------------

    [Fact]
    public void Apply_AnOlderSequence_DoesNotOverwriteANewerState()
    {
        var service = new OverlayStateService();
        var exerciseId = Guid.NewGuid();

        // The Resume (ticket 2) lands first; the Freeze's late, stale publish (ticket 1) arrives after.
        service.Apply(exerciseId, "none", "in-fiction", 2);
        var result = service.Apply(exerciseId, "pause", "out-of-fiction", 1);

        result.State.Should().Be("none", "Apply returns what the store HOLDS, so the caller broadcasts the newer state");
        service.Get(exerciseId).State.Should().Be(
            "none",
            "a late out-of-order publish must never re-show a holding page on a world the controller has already resumed");
    }

    [Fact]
    public void Apply_ANewerSequence_Wins()
    {
        var service = new OverlayStateService();
        var exerciseId = Guid.NewGuid();

        service.Apply(exerciseId, "pause", "out-of-fiction", 1);
        var result = service.Apply(exerciseId, "none", "in-fiction", 2);

        result.State.Should().Be("none");
        service.Get(exerciseId).Sequence.Should().Be(2);
    }

    [Fact]
    public void NextSequence_IsMonotonic()
    {
        var service = new OverlayStateService();

        var first = service.NextSequence();
        var second = service.NextSequence();
        var third = service.NextSequence();

        first.Should().BeLessThan(second);
        second.Should().BeLessThan(third);
    }

    [Fact]
    public void Apply_NullOrBlankState_Throws()
    {
        var service = new OverlayStateService();

        var nullState = () => service.Apply(Guid.NewGuid(), null!, "in-fiction", 1);
        var blankRegister = () => service.Apply(Guid.NewGuid(), "pause", "   ", 1);

        nullState.Should().Throw<ArgumentException>();
        blankRegister.Should().Throw<ArgumentException>();
    }
}
