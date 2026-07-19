namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;

public class EngineAutonomyStateTests
{
    private const string Controller = "controller:alex";

    private static EngineAutonomyState NewState(AutonomyLevel initial = AutonomyLevel.Suggest) =>
        EngineAutonomyState.Create(Guid.NewGuid(), initial);

    // ---- Creation + resolution (#169, §8.1) ------------------------------------------------------

    [Fact]
    public void Create_DefaultsToSuggest_TheSafeFloor()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid());
        state.ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
        state.ResolveEffective(Guid.NewGuid()).Should().Be(EffectiveAutonomy.Running(AutonomyLevel.Suggest));
    }

    [Fact]
    public void Create_RejectsEmptyExercise_AndAutoDefault()
    {
        var emptyExercise = () => EngineAutonomyState.Create(Guid.Empty);
        emptyExercise.Should().Throw<ArgumentException>();

        var autoDefault = () => EngineAutonomyState.Create(Guid.NewGuid(), AutonomyLevel.Auto);
        autoDefault.Should().Throw<NotSupportedException>();
    }

    [Fact]
    public void ResolveBase_OverrideWins_ElseExerciseDefault()
    {
        var state = NewState();
        var withOverride = Guid.NewGuid();
        var withoutOverride = Guid.NewGuid();

        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 5);
        state.SetStorylineOverride(withOverride, AutonomyLevel.Suggest, Controller, 6);

        state.ResolveBase(withOverride).Should().Be(AutonomyLevel.Suggest, "the override wins");
        state.ResolveBase(withoutOverride).Should().Be(AutonomyLevel.DelayedAuto, "no override → exercise default");
    }

    [Fact]
    public void ClearingOverride_FallsBackToExerciseDefault()
    {
        var state = NewState();
        var storyline = Guid.NewGuid();
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 1);
        state.SetStorylineOverride(storyline, AutonomyLevel.Suggest, Controller, 2);
        state.HasOverride(storyline).Should().BeTrue();

        state.SetStorylineOverride(storyline, null, Controller, 3);

        state.HasOverride(storyline).Should().BeFalse();
        state.ResolveBase(storyline).Should().Be(AutonomyLevel.DelayedAuto);
    }

    // ---- Human changes are logged, and are the only path that may raise (#169, §8.2) -------------

    [Fact]
    public void SetExerciseDefault_IsAHumanSteeringAction_Logged()
    {
        var state = NewState();

        var evt = state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 12);

        evt.Should().BeEquivalentTo(new
        {
            Scope = AutonomyScope.Exercise,
            From = AutonomyLevel.Suggest,
            To = AutonomyLevel.DelayedAuto,
            Cause = AutonomyChangeCause.Human,
            Actor = Controller,
            ScenarioMinute = 12,
        });
        evt.ExerciseId.Should().Be(state.ExerciseId);
    }

    [Fact]
    public void SetStorylineOverride_LogsBaseFromTo_ForTheStoryline()
    {
        var state = NewState();
        var storyline = Guid.NewGuid();
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 1);

        var evt = state.SetStorylineOverride(storyline, AutonomyLevel.Suggest, Controller, 2);

        evt.Scope.Should().Be(AutonomyScope.Storyline);
        evt.StorylineId.Should().Be(storyline);
        evt.From.Should().Be(AutonomyLevel.DelayedAuto);
        evt.To.Should().Be(AutonomyLevel.Suggest);
        evt.Cause.Should().Be(AutonomyChangeCause.Human);
    }

    [Fact]
    public void SettingAuto_IsRejected_AsV1Point1()
    {
        var state = NewState();
        var setDefault = () => state.SetExerciseDefault(AutonomyLevel.Auto, Controller, 1);
        var setOverride = () => state.SetStorylineOverride(Guid.NewGuid(), AutonomyLevel.Auto, Controller, 1);

        setDefault.Should().Throw<NotSupportedException>();
        setOverride.Should().Throw<NotSupportedException>();
    }

    [Fact]
    public void ChangesRequireAnActor_ForTheAuditLog()
    {
        var state = NewState();
        var act = () => state.SetExerciseDefault(AutonomyLevel.DelayedAuto, " ", 1);
        act.Should().Throw<ArgumentException>().WithParameterName("actor");
    }

    // ---- Kill switch (#171, §8.4) ----------------------------------------------------------------

    [Fact]
    public void KillSwitch_DropToSuggest_LowersEffective_ButKeepsBaseAndDoesNotStop()
    {
        var state = NewState();
        var storyline = Guid.NewGuid();
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 1);
        state.SetStorylineOverride(storyline, AutonomyLevel.DelayedAuto, Controller, 2);

        var evt = state.EngageKillSwitch(KillSwitchMode.DropToSuggest, Controller, 30);

        evt.Should().BeEquivalentTo(new { Mode = KillSwitchMode.DropToSuggest, Actor = Controller, ScenarioMinute = 30 });
        state.ResolveEffective(storyline).Should().Be(EffectiveAutonomy.Running(AutonomyLevel.Suggest));
        state.IsGenerationStopped.Should().BeFalse();
        state.SafetyClampActive.Should().BeTrue();
        state.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto, "base config is preserved beneath the clamp");
    }

    [Fact]
    public void KillSwitch_FullStop_StopsGeneration()
    {
        var state = NewState(AutonomyLevel.DelayedAuto);

        state.EngageKillSwitch(KillSwitchMode.FullStop, Controller, 10);

        state.IsGenerationStopped.Should().BeTrue();
        state.ResolveEffective(Guid.NewGuid()).GenerationStopped.Should().BeTrue();
    }

    [Fact]
    public void KillSwitch_DoesNotAutoRecover_ControllerRestoresExplicitly()
    {
        var state = NewState(AutonomyLevel.DelayedAuto);
        state.EngageKillSwitch(KillSwitchMode.DropToSuggest, Controller, 10);

        // No automatic path raises autonomy: it stays Suggest until a human restores.
        state.ResolveEffective(Guid.NewGuid()).Level.Should().Be(AutonomyLevel.Suggest);

        var restore = state.RestoreFromSafety(Controller, 40);

        restore.Should().NotBeNull();
        restore!.Cause.Should().Be(AutonomyChangeCause.Human);
        restore.To.Should().Be(AutonomyLevel.DelayedAuto);
        state.SafetyClampActive.Should().BeFalse();
        state.ResolveEffective(Guid.NewGuid()).Level.Should().Be(AutonomyLevel.DelayedAuto, "base config resumes on restore");
    }

    [Fact]
    public void Restore_WhenNothingClamped_IsANoOp()
    {
        var state = NewState(AutonomyLevel.DelayedAuto);
        state.RestoreFromSafety(Controller, 5).Should().BeNull();
    }

    // ---- The self-escalation invariant (§8.2) ----------------------------------------------------

    [Fact]
    public void RaisingTheBaseWhileClamped_DoesNotLiftTheEmergencyBrake()
    {
        var state = NewState(AutonomyLevel.DelayedAuto);
        state.EngageKillSwitch(KillSwitchMode.DropToSuggest, Controller, 10);

        // A routine level tweak sets the base but must not silently release the kill switch.
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, Controller, 11);

        state.SafetyClampActive.Should().BeTrue();
        state.ResolveEffective(Guid.NewGuid()).Level.Should().Be(AutonomyLevel.Suggest);
    }

    // ---- Swamped mode is a human toggle only (§8.2, #36) -----------------------------------------

    [Fact]
    public void SwampedMode_IsOffByDefault_AndFlippedOnlyByAnExplicitHumanCall()
    {
        var state = NewState();
        state.SwampedModeEnabled.Should().BeFalse();

        var evt = state.SetSwampedMode(true, "lead:jordan", 20);

        evt.Should().BeEquivalentTo(new { Enabled = true, Actor = "lead:jordan", ScenarioMinute = 20 });
        state.SwampedModeEnabled.Should().BeTrue();
    }
}
