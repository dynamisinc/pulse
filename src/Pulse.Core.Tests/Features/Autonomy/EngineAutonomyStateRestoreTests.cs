namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;

/// <summary>
/// Engine-runtime story 07 (engine state survives a restart), slice S1: the in-memory
/// <see cref="EngineAutonomyState.Restore"/> / <see cref="EngineAutonomyState.ToSnapshot"/> seams. Proves decision Q1:
/// lowering state (clamp, FullStop, degraded reason + its clamp) is restored exactly; raises (Delayed-auto default or
/// override, swamped ON) are withheld at the floor and returned as <see cref="EngineHeldRaises"/>; Auto is rejected; and
/// a restore can never clear a clamp. Docker-free.
/// </summary>
public sealed class EngineAutonomyStateRestoreTests
{
    private const string Controller = "controller:alex";

    private static EngineAutonomySnapshot Snapshot(
        Guid exerciseId,
        AutonomyLevel exerciseDefault = AutonomyLevel.Suggest,
        IReadOnlyDictionary<Guid, AutonomyLevel>? overrides = null,
        bool swamped = false,
        AutonomyLevel? clamp = null,
        bool stopped = false,
        string? degradedReason = null) =>
        new(exerciseId, exerciseDefault, overrides ?? new Dictionary<Guid, AutonomyLevel>(), swamped, clamp, stopped, degradedReason);

    // ---- Lowering state: restored exactly ---------------------------------------------------------

    [Fact]
    public void Restore_FullStop_IsRestoredExactly_WithItsClamp()
    {
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.EngageKillSwitch(KillSwitchMode.FullStop, Controller, 12);

        var restored = EngineAutonomyState.Create(live.ExerciseId);
        var held = restored.Restore(live.ToSnapshot());

        restored.IsGenerationStopped.Should().BeTrue("a FullStop must survive a restart with no human step (Q1)");
        restored.SafetyClampActive.Should().BeTrue();
        restored.ResolveEffective(Guid.NewGuid()).Should().Be(EffectiveAutonomy.Stopped);
        restored.ToSnapshot().Should().BeEquivalentTo(live.ToSnapshot(), "lowering state round-trips exactly");
        held.Should().BeSameAs(EngineHeldRaises.None);
    }

    [Fact]
    public void Restore_DropToSuggest_ClampsDelayedAutoOverrideBackToSuggest_AndWithholdsTheOverride()
    {
        var storyline = Guid.NewGuid();
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.SetStorylineOverride(storyline, AutonomyLevel.DelayedAuto, Controller, 1);
        live.EngageKillSwitch(KillSwitchMode.DropToSuggest, Controller, 2);

        var restored = EngineAutonomyState.Create(live.ExerciseId);
        var held = restored.Restore(live.ToSnapshot());

        restored.SafetyClampActive.Should().BeTrue("the kill switch's clamp is lowering state");
        restored.IsGenerationStopped.Should().BeFalse("DropToSuggest does not stop generation");
        restored.ResolveEffective(storyline).Should().Be(EffectiveAutonomy.Running(AutonomyLevel.Suggest));
        restored.HasOverride(storyline).Should().BeFalse("a Delayed-auto override is a raise and is never auto-applied");
        held.StorylineOverrides.Should().ContainSingle()
            .Which.Should().Be(new KeyValuePair<Guid, AutonomyLevel>(storyline, AutonomyLevel.DelayedAuto));
    }

    [Fact]
    public void Restore_Degraded_RestoresReasonAndTheClampTheDegradeImposed()
    {
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.DegradeToSuggest("circuit open: 5 consecutive failures", 30);

        var restored = EngineAutonomyState.Create(live.ExerciseId);
        restored.Restore(live.ToSnapshot());

        restored.DegradedReason.Should().Be("circuit open: 5 consecutive failures");
        restored.SafetyClampActive.Should().BeTrue("the banner and the restore-needs-a-human rule stay truthful");
        restored.ToSnapshot().Should().BeEquivalentTo(live.ToSnapshot());
    }

    [Fact]
    public void Restore_ADegradedReasonWithoutAClamp_StillImposesTheClamp_TheMoreRestrictiveReading()
    {
        var exercise = Guid.NewGuid();
        var restored = EngineAutonomyState.Create(exercise);

        restored.Restore(Snapshot(exercise, degradedReason: "provider degraded"));

        restored.SafetyClampActive.Should().BeTrue("a degrade always carries its clamp; restore never yields less");
    }

    [Fact]
    public void Restore_StoppedWithoutAClamp_StillImposesTheClamp()
    {
        var exercise = Guid.NewGuid();
        var restored = EngineAutonomyState.Create(exercise);

        restored.Restore(Snapshot(exercise, stopped: true));

        restored.IsGenerationStopped.Should().BeTrue();
        restored.ToSnapshot().SafetyClamp.Should().Be(AutonomyLevel.Suggest, "a FullStop always carries the floor clamp");
    }

    [Fact]
    public void Restore_SuggestOverride_IsRestoredExactly()
    {
        var storyline = Guid.NewGuid();
        var exercise = Guid.NewGuid();
        var restored = EngineAutonomyState.Create(exercise);

        var held = restored.Restore(Snapshot(
            exercise, overrides: new Dictionary<Guid, AutonomyLevel> { [storyline] = AutonomyLevel.Suggest }));

        restored.HasOverride(storyline).Should().BeTrue("a floor override never raises reach, so it is restored");
        restored.ResolveBase(storyline).Should().Be(AutonomyLevel.Suggest);
        held.IsEmpty.Should().BeTrue();
    }

    // ---- Raises: withheld, never applied ----------------------------------------------------------

    [Fact]
    public void Restore_Raises_AreHeldAtTheFloor_AndReturnedAsPrevious()
    {
        var raised = Guid.NewGuid();
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 1);
        live.SetStorylineOverride(raised, AutonomyLevel.DelayedAuto, Controller, 2);
        live.SetSwampedMode(true, Controller, 3);

        var restored = EngineAutonomyState.Create(live.ExerciseId);
        var held = restored.Restore(live.ToSnapshot());

        restored.ExerciseDefault.Should().Be(AutonomyLevel.Suggest, "a boot is not a human; it never raises (§8.2, Q1)");
        restored.HasOverride(raised).Should().BeFalse();
        restored.ResolveEffective(raised).Should().Be(EffectiveAutonomy.Running(AutonomyLevel.Suggest));
        restored.SwampedModeEnabled.Should().BeFalse("swamped mode boots OFF (Q1)");

        held.IsEmpty.Should().BeFalse();
        held.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
        held.StorylineOverrides.Should().ContainKey(raised).WhoseValue.Should().Be(AutonomyLevel.DelayedAuto);
        held.SwampedMode.Should().BeTrue();
    }

    [Fact]
    public void Restore_ANothingRaisedSnapshot_HoldsNothing()
    {
        var exercise = Guid.NewGuid();
        EngineAutonomyState.Create(exercise).Restore(Snapshot(exercise)).Should().BeSameAs(EngineHeldRaises.None);
    }

    [Fact]
    public void Restore_ReturnsNoEvents_AndALaterHumanRaiseStillWorksThroughTheNormalPath()
    {
        var exercise = Guid.NewGuid();
        var restored = EngineAutonomyState.Create(exercise);
        var held = restored.Restore(Snapshot(exercise, exerciseDefault: AutonomyLevel.DelayedAuto));

        // The human restore goes through the ordinary audited setter, which returns its steering event.
        var change = restored.SetExerciseDefault(held.ExerciseDefault!.Value, Controller, 40);

        change.Cause.Should().Be(AutonomyChangeCause.Human);
        restored.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
    }

    // ---- Auto rejected; invalid snapshots change nothing -------------------------------------------

    [Fact]
    public void Restore_RejectsAuto_AnywhereInTheSnapshot_AndChangesNothing()
    {
        var exercise = Guid.NewGuid();
        var storyline = Guid.NewGuid();

        foreach (var bad in new[]
        {
            Snapshot(exercise, exerciseDefault: AutonomyLevel.Auto, stopped: true),
            Snapshot(exercise, overrides: new Dictionary<Guid, AutonomyLevel> { [storyline] = AutonomyLevel.Auto }, stopped: true),
            Snapshot(exercise, clamp: AutonomyLevel.Auto, stopped: true),
        })
        {
            var state = EngineAutonomyState.Create(exercise);
            var act = () => state.Restore(bad);

            act.Should().Throw<NotSupportedException>("Auto is v1.1 and never selectable, even from a row");
            state.IsGenerationStopped.Should().BeFalse("validation runs before anything is applied");
            state.HasOverride(storyline).Should().BeFalse();
        }
    }

    [Fact]
    public void Restore_RejectsAnotherExercisesSnapshot_AnEmptyStorylineId_AndAnUndefinedLevel()
    {
        var exercise = Guid.NewGuid();
        var state = EngineAutonomyState.Create(exercise);

        var foreign = () => state.Restore(Snapshot(Guid.NewGuid(), stopped: true));
        foreign.Should().Throw<ArgumentException>("a snapshot is restored only onto its own exercise (COR-001)");

        var emptyStoryline = () => state.Restore(Snapshot(
            exercise, overrides: new Dictionary<Guid, AutonomyLevel> { [Guid.Empty] = AutonomyLevel.Suggest }));
        emptyStoryline.Should().Throw<ArgumentException>();

        var undefined = () => state.Restore(Snapshot(exercise, exerciseDefault: (AutonomyLevel)42));
        undefined.Should().Throw<ArgumentException>();

        state.SafetyClampActive.Should().BeFalse("a rejected snapshot applies nothing");

        var nullSnapshot = () => state.Restore(null!);
        nullSnapshot.Should().Throw<ArgumentNullException>();
    }

    // ---- Never a backdoor to clear ------------------------------------------------------------------

    [Fact]
    public void Restore_CannotClearALiveClamp_StopOrDegradedReason()
    {
        var exercise = Guid.NewGuid();
        var state = EngineAutonomyState.Create(exercise);
        state.DegradeToSuggest("live degrade", 5);
        state.EngageKillSwitch(KillSwitchMode.FullStop, Controller, 6);

        // A stale row that read "nothing clamped" races the live kill switch: the lowering is not lost.
        var held = state.Restore(Snapshot(exercise));

        state.IsGenerationStopped.Should().BeTrue("only a human RestoreFromSafety clears a stop");
        state.SafetyClampActive.Should().BeTrue();
        state.DegradedReason.Should().Be("live degrade", "the live reason is newer than the row");
        held.Should().BeSameAs(EngineHeldRaises.None);
    }

    [Fact]
    public void Restore_DoesNotLowerOrReplaceALiveHumanValue_ForDefaultSwampedOrOverride()
    {
        var exercise = Guid.NewGuid();
        var storyline = Guid.NewGuid();
        var state = EngineAutonomyState.Create(exercise);
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 1);
        state.SetStorylineOverride(storyline, AutonomyLevel.DelayedAuto, Controller, 1);
        state.SetSwampedMode(true, Controller, 1);

        state.Restore(Snapshot(
            exercise, overrides: new Dictionary<Guid, AutonomyLevel> { [storyline] = AutonomyLevel.Suggest }));

        state.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto, "a live human value is newer than the row");
        state.ResolveBase(storyline).Should().Be(AutonomyLevel.DelayedAuto);
        state.SwampedModeEnabled.Should().BeTrue();
    }

    [Fact]
    public void Restore_IsIdempotent()
    {
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.EngageKillSwitch(KillSwitchMode.FullStop, Controller, 1);
        live.DegradeToSuggest("down", 2);

        var restored = EngineAutonomyState.Create(live.ExerciseId);
        restored.Restore(live.ToSnapshot());
        restored.Restore(live.ToSnapshot());

        restored.ToSnapshot().Should().BeEquivalentTo(live.ToSnapshot());
    }

    [Fact]
    public void AfterRestore_OnlyAHumanRestoreFromSafety_ClearsTheClamp()
    {
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.EngageKillSwitch(KillSwitchMode.FullStop, Controller, 1);
        var restored = EngineAutonomyState.Create(live.ExerciseId);
        restored.Restore(live.ToSnapshot());

        restored.MarkProviderRecovered(5).Should().BeNull("recovery never raises (§8.2)");
        restored.IsGenerationStopped.Should().BeTrue();

        restored.RestoreFromSafety(Controller, 6).Should().NotBeNull();
        restored.SafetyClampActive.Should().BeFalse();
    }

    // ---- ToSnapshot -------------------------------------------------------------------------------

    [Fact]
    public void ToSnapshot_CopiesEveryFieldExactly_AndIsDetachedFromTheLiveState()
    {
        var storyline = Guid.NewGuid();
        var live = EngineAutonomyState.Create(Guid.NewGuid());
        live.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 1);
        live.SetStorylineOverride(storyline, AutonomyLevel.Suggest, Controller, 1);
        live.SetSwampedMode(true, Controller, 1);
        live.DegradeToSuggest(" provider down ", 2);

        var snapshot = live.ToSnapshot();
        live.SetStorylineOverride(storyline, null, Controller, 3);

        snapshot.ExerciseId.Should().Be(live.ExerciseId);
        snapshot.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
        snapshot.StorylineOverrides.Should().ContainKey(storyline, "the snapshot is a copy, not a view");
        snapshot.SwampedMode.Should().BeTrue();
        snapshot.SafetyClamp.Should().Be(AutonomyLevel.Suggest);
        snapshot.Stopped.Should().BeFalse();
        snapshot.DegradedReason.Should().Be("provider down");
    }
}
