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

    private static PersonaDossier Persona(string handle) =>
        new() { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident };

    private static Storyline AddressedStoryline()
    {
        var s = EscalatingStoryline();
        MissSafeResolver.Apply(new MatchResolution(MatchKind.Matched, s.Id, 0.9, false), s, scenarioMinute: 31);
        return s;
    }

    private static ReactionContext ResponseContext(
        Storyline storyline, int personas, RateGovernanceConfig? rate = null, int postsThisMinute = 0) => new()
        {
            Storyline = storyline,
            Trigger = ReactionTriggerKind.OfficialResponse,
            Autonomy = EffectiveAutonomy.Running(AutonomyLevel.Suggest),
            EligiblePersonas = [.. Enumerable.Range(0, personas).Select(i => Persona($"@p{i}"))],
            RateConfig = rate ?? RateGovernanceConfig.Default,
            PostsThisMinute = postsThisMinute,
            ScenarioMinute = 31,
        };

    [Fact]
    public void Behavior_VoicesAMatchAsABurst_ThatCanCarryTheMix()
    {
        // The live loop decides the response AFTER the match moved the storyline to Addressed, where the base
        // composer sizes to a single voice — too few for "gratitude + a follow-up + one skeptic".
        var intent = new ResponseReactionBehavior().Decide(ResponseContext(AddressedStoryline(), personas: 5));

        intent!.Count.Should().Be(ResponseReactionBehavior.DefaultBurstSize);
        intent.Personas.Should().HaveCount(ResponseReactionBehavior.DefaultBurstSize, "one post per persona");
    }

    [Fact]
    public void Behavior_BurstIsBoundedByTheCast()
    {
        new ResponseReactionBehavior().Decide(ResponseContext(AddressedStoryline(), personas: 2))!
            .Count.Should().Be(2, "a burst never asks for more voices than the storyline's cast");
    }

    [Fact]
    public void Behavior_BurstIsBoundedByThePerMinuteCap()
    {
        var tight = new RateGovernanceConfig(maxEnginePostsPerMinute: 4, minBelievableActivity: 1);

        new ResponseReactionBehavior().Decide(ResponseContext(AddressedStoryline(), personas: 5, tight, postsThisMinute: 3))!
            .Count.Should().Be(1, "only one post is left under this minute's cap (ADP-011)");
    }

    [Fact]
    public void Behavior_WithACustomBurstSize_UsesIt()
    {
        new ResponseReactionBehavior(burstSize: 2).Decide(ResponseContext(AddressedStoryline(), personas: 5))!
            .Count.Should().Be(2);
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
