namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// demo-feedback story 18 (AC-5, DF-27): restoring a persisted overlay brings the holding page back and re-seeds the
/// per-exercise ticket counter, so the first publish after a restart is the persisted sequence + 1. Model-only.
/// </summary>
public sealed class OverlayStateServiceRestoreTests
{
    [Fact]
    public void Restore_BringsTheHoldingPageBack_AndTheNextTicketIsPersistedPlusOne()
    {
        var store = new OverlayStateService();
        var exerciseId = Guid.NewGuid();

        var restored = store.Restore(
            exerciseId, new OverlayStateSnapshot(OverlayStateWire.Pause, OverlayStateWire.InFiction, string.Empty, 41));

        restored.State.Should().Be(OverlayStateWire.Pause);
        store.Get(exerciseId).Sequence.Should().Be(41);
        store.NextSequence(exerciseId).Should().Be(42, "DF-27: a client that saw 41 must never drop the next frame");
    }

    [Fact]
    public void Restore_NeverLowersTheCounter_NorOverwritesANewerWrite()
    {
        var store = new OverlayStateService();
        var exerciseId = Guid.NewGuid();
        for (var i = 0; i < 5; i++)
        {
            store.NextSequence(exerciseId);
        }

        store.Apply(exerciseId, OverlayStateWire.None, OverlayStateWire.InFiction, 5);

        store.Restore(exerciseId, new OverlayStateSnapshot(OverlayStateWire.Pause, OverlayStateWire.InFiction, string.Empty, 3));

        store.Get(exerciseId).State.Should().Be(OverlayStateWire.None, "an older persisted snapshot never beats a newer write");
        store.NextSequence(exerciseId).Should().Be(6);
    }

    [Fact]
    public void Restore_ForA_NeverTouchesB()
    {
        var store = new OverlayStateService();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();

        store.Restore(a, new OverlayStateSnapshot(OverlayStateWire.Pause, OverlayStateWire.InFiction, string.Empty, 9));

        store.Get(b).Should().Be(OverlayStateService.Cleared, "COR-001: restoring A's holding page never shows it to B");
        store.NextSequence(b).Should().Be(1, "B's sequence is its own (SG-001)");
    }

    [Fact]
    public void Restore_RefusesTheEmptyExercise()
    {
        var act = () => new OverlayStateService().Restore(Guid.Empty, OverlayStateService.Cleared);
        act.Should().Throw<ArgumentException>();
    }
}
