namespace Pulse.Core.Tests.Features.SilenceEscalation;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.SilenceEscalation.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class SilenceEscalationBehaviorTests
{
    private sealed class Clock(int minute) : IScenarioClock
    {
        public int CurrentScenarioMinute { get; } = minute;
    }

    private static ReactionContext SilentContext(int minutesSilent, EffectiveAutonomy? autonomy = null)
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "Water fears", "County advisory", responseWindowMin: 20, initialIntensity: 30);
        storyline.Seed(0);
        storyline.Tick(new Clock(minutesSilent)); // opens the window; MinutesSinceLastOfficialResponse = minutesSilent

        return new ReactionContext
        {
            Storyline = storyline,
            Trigger = ReactionTriggerKind.Inaction,
            Autonomy = autonomy ?? EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto),
            EligiblePersonas = [new PersonaDossier { Handle = "@a", DisplayName = "A", Type = PersonaType.Resident }],
            RateConfig = RateGovernanceConfig.Default,
            ScenarioMinute = minutesSilent,
        };
    }

    [Fact]
    public void Behavior_HandlesTheInactionTrigger()
    {
        new SilenceEscalationBehavior().Trigger.Should().Be(ReactionTriggerKind.Inaction);
    }

    [Fact]
    public void Behavior_ShapesAnEscalatingIntent()
    {
        var intent = new SilenceEscalationBehavior().Decide(SilentContext(minutesSilent: 40));

        intent.Should().NotBeNull();
        intent!.Trigger.Should().Be(ReactionTriggerKind.Inaction);
        intent.ToneMix.Gratitude.Should().Be(0, "silence never reads as gratitude");
        (intent.ToneMix.Worry + intent.ToneMix.Speculation + intent.ToneMix.Anger).Should().BeGreaterThan(0);
    }

    [Fact]
    public void Behavior_LaterBurstsAreMoreAnxiousThanEarlier()
    {
        var early = new SilenceEscalationBehavior().Decide(SilentContext(minutesSilent: 20))!;
        var late = new SilenceEscalationBehavior().Decide(SilentContext(minutesSilent: 60))!;

        (late.ToneMix.Speculation + late.ToneMix.Anger)
            .Should().BeGreaterThan(early.ToneMix.Speculation + early.ToneMix.Anger);
    }

    [Fact]
    public void Behavior_WhenGenerationStopped_ProducesNothing()
    {
        new SilenceEscalationBehavior().Decide(SilentContext(40, EffectiveAutonomy.Stopped)).Should().BeNull();
    }
}
