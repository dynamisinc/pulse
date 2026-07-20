namespace Pulse.Core.Tests.Features.ResponseReaction;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class ResponseReactionBehaviorTests
{
    private sealed class Clock(int minute) : IScenarioClock
    {
        public int CurrentScenarioMinute { get; } = minute;
    }

    private static ReactionContext Context(Storyline storyline, EffectiveAutonomy? autonomy = null) => new()
    {
        Storyline = storyline,
        Trigger = ReactionTriggerKind.OfficialResponse,
        Autonomy = autonomy ?? EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto),
        EligiblePersonas =
        [
            new PersonaDossier { Handle = "@a", DisplayName = "A", Type = PersonaType.Resident },
            new PersonaDossier { Handle = "@b", DisplayName = "B", Type = PersonaType.Helper },
        ],
        RateConfig = RateGovernanceConfig.Default,
        ScenarioMinute = 40,
    };

    private static Storyline EscalatingStoryline()
    {
        var s = Storyline.Create(Guid.NewGuid(), "Water fears", "county advisory", responseWindowMin: 20, initialIntensity: 30);
        s.Seed(0);
        s.Tick(new Clock(30));
        return s;
    }

    [Fact]
    public void Behavior_HandlesOfficialResponse_WithAGratitudeHeavyMix()
    {
        var intent = new ResponseReactionBehavior().Decide(Context(EscalatingStoryline()));

        intent.Should().NotBeNull();
        intent!.Trigger.Should().Be(ReactionTriggerKind.OfficialResponse);
        intent.Tier.Should().Be(GenerationTier.Standard);
        var mix = intent.ToneMix;
        mix.Gratitude.Should().BeGreaterThan(mix.Anger).And.BeGreaterThan(mix.Worry);
        mix.Skepticism.Should().BeGreaterThan(0, "the mix keeps one skeptic");
    }

    [Fact]
    public void Behavior_IsTunable()
    {
        var custom = new ToneMix { Gratitude = 0.2, Skepticism = 0.6, Calm = 0.2 };
        var intent = new ResponseReactionBehavior(custom).Decide(Context(EscalatingStoryline()));
        intent!.ToneMix.Should().Be(custom);
    }

    [Fact]
    public void Behavior_WhenStopped_ProducesNothing()
    {
        new ResponseReactionBehavior().Decide(Context(EscalatingStoryline(), EffectiveAutonomy.Stopped)).Should().BeNull();
    }

    [Fact]
    public void AMatch_StopsActiveSilenceEscalation_TheHandoff()
    {
        var s = EscalatingStoryline();
        var clock = new Clock(30);

        // Before the match: the storyline is unaddressed and silent past its window → observe raises inaction.
        ObserveStage.Observe([s], [], clock).InactionTriggers.Should().ContainSingle();

        // A matched response addresses it (bends down, → ADDRESSED).
        MissSafeResolver.Apply(new MatchResolution(MatchKind.Matched, s.Id, 0.8, false), s, scenarioMinute: 31);

        // Now observe raises no inaction trigger — escalation has stopped and handed off to the reaction.
        ObserveStage.Observe([s], [], new Clock(35)).InactionTriggers.Should().BeEmpty("an addressed storyline is no longer silent");
    }
}
