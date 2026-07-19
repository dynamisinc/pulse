namespace Pulse.Core.Tests.Features.ReactionLoop;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.Storylines.Models;

public class DecideStageTests
{
    private static Storyline Escalating(int intensity = 50)
    {
        var s = Storyline.Create(Guid.NewGuid(), "Water fears", "County advisory", initialIntensity: intensity);
        s.Seed(0);
        s.DetectActivity(1);
        return s;
    }

    private static ReactionContext Context(ReactionTriggerKind trigger) => new()
    {
        Storyline = Escalating(),
        Trigger = trigger,
        Autonomy = EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto),
        EligiblePersonas = [new PersonaDossier { Handle = "@a", DisplayName = "A", Type = PersonaType.Resident }],
        RateConfig = RateGovernanceConfig.Default,
        ScenarioMinute = 30,
    };

    private sealed class StubBehavior(ReactionTriggerKind trigger, GenerationIntent? result) : IReactionBehavior
    {
        public ReactionTriggerKind Trigger => trigger;

        public GenerationIntent? Decide(ReactionContext context) => result;
    }

    [Fact]
    public void UnregisteredTrigger_FallsBackToTheDefaultComposer()
    {
        var stage = new DecideStage();

        var intent = stage.Decide(Context(ReactionTriggerKind.Inaction));

        stage.HasBehavior(ReactionTriggerKind.Inaction).Should().BeFalse();
        intent.Should().NotBeNull("the default IntentComposer runs when no behavior is registered");
    }

    [Fact]
    public void RegisteredBehavior_ShapesTheIntent_ForItsTrigger()
    {
        var marker = new GenerationIntent
        {
            StorylineId = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            Trigger = ReactionTriggerKind.Inaction,
            Personas = [],
            ToneMix = new ToneMix(),
            Count = 42,
            Tier = GenerationTier.Standard,
            AutonomyLevel = AutonomyLevel.Suggest,
        };
        var stage = new DecideStage().Register(new StubBehavior(ReactionTriggerKind.Inaction, marker));

        stage.Decide(Context(ReactionTriggerKind.Inaction))!.Count.Should().Be(42, "the registered behavior owns its trigger");
    }

    [Fact]
    public void ABehaviorReturningNull_GeneratesNothing()
    {
        var stage = new DecideStage().Register(new StubBehavior(ReactionTriggerKind.Inaction, null));
        stage.Decide(Context(ReactionTriggerKind.Inaction)).Should().BeNull();
    }

    [Fact]
    public void DecideAll_DropsTheTicksThatProduceNothing()
    {
        var stage = new DecideStage()
            .Register(new StubBehavior(ReactionTriggerKind.OfficialResponse, null));

        var intents = stage.DecideAll(
        [
            Context(ReactionTriggerKind.Inaction),        // default composer → an intent
            Context(ReactionTriggerKind.OfficialResponse), // stub → null, dropped
        ]);

        intents.Should().ContainSingle().Which.Trigger.Should().Be(ReactionTriggerKind.Inaction);
    }
}
