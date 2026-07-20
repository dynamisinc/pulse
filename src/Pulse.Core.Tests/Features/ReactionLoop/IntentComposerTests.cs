namespace Pulse.Core.Tests.Features.ReactionLoop;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class IntentComposerTests
{
    private static PersonaDossier P(string handle) =>
        new() { Handle = handle, DisplayName = handle, Type = PersonaType.Resident };

    private static IReadOnlyList<PersonaDossier> Cast(int n) =>
        [.. Enumerable.Range(0, n).Select(i => P($"@p{i}"))];

    private static Storyline Escalating(int intensity, int? target = null)
    {
        var s = Storyline.Create(Guid.NewGuid(), "Water fears", "County advisory", initialIntensity: intensity);
        s.Seed(0);
        s.DetectActivity(1); // Seeded → Escalating at the given intensity (no time elapsed)
        if (target is int t)
        {
            s.SetTargetIntensity(t, 1);
        }

        return s;
    }

    private static ReactionContext Context(
        Storyline storyline,
        EffectiveAutonomy autonomy,
        IReadOnlyList<PersonaDossier> personas,
        ReactionTriggerKind trigger = ReactionTriggerKind.Inaction,
        RateGovernanceConfig? rate = null,
        int postsThisMinute = 0) =>
        new()
        {
            Storyline = storyline,
            Trigger = trigger,
            Autonomy = autonomy,
            EligiblePersonas = personas,
            RateConfig = rate ?? RateGovernanceConfig.Default,
            PostsThisMinute = postsThisMinute,
            ScenarioMinute = 30,
        };

    [Fact]
    public void ComposesAnIntent_AnnotatedWithAutonomy_ToneFromTheBrief_StandardTier()
    {
        var storyline = Escalating(50);
        var ctx = Context(storyline, EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), Cast(3));

        var intent = IntentComposer.Compose(ctx);

        intent.Should().NotBeNull();
        intent!.AutonomyLevel.Should().Be(AutonomyLevel.DelayedAuto);
        intent.Tier.Should().Be(GenerationTier.Standard);
        intent.ToneMix.Should().Be(storyline.ToBrief().ToneMix);
        intent.StorylineId.Should().Be(storyline.Id);
        intent.Count.Should().BeGreaterThan(0).And.Be(intent.Personas.Count, "one post per persona");
    }

    [Fact]
    public void StoppedEngine_ProducesNoIntent()
    {
        var ctx = Context(Escalating(50), EffectiveAutonomy.Stopped, Cast(3));
        IntentComposer.Compose(ctx).Should().BeNull();
    }

    [Fact]
    public void NoEligiblePersonas_ProducesNoIntent()
    {
        var ctx = Context(Escalating(50), EffectiveAutonomy.Running(AutonomyLevel.Suggest), Cast(0));
        IntentComposer.Compose(ctx).Should().BeNull();
    }

    [Fact]
    public void ADialTargetAbove_RaisesTheBurst_AboveTheCurveDefault()
    {
        var cast = Cast(6);
        var curveDefault = IntentComposer.Compose(
            Context(Escalating(40), EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), cast))!.Count;

        var raised = IntentComposer.Compose(
            Context(Escalating(40, target: 95), EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), cast))!.Count;

        raised.Should().BeGreaterThan(curveDefault, "the engine drives actual → target, not the raw curve (CTL-022)");
    }

    [Fact]
    public void ADialTargetBelow_Tapers_ProducesNoNewBurst()
    {
        var ctx = Context(Escalating(80, target: 40), EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), Cast(3));
        IntentComposer.Compose(ctx).Should().BeNull("below-target means taper and let decay work, not generate more");
    }

    [Fact]
    public void TheRateCap_ThrottlesTheBurst_ToWhatRemainsThisMinute()
    {
        var tightCap = new RateGovernanceConfig(maxEnginePostsPerMinute: 2, minBelievableActivity: 1);

        var atCap = Context(Escalating(50), EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), Cast(5),
            rate: tightCap, postsThisMinute: 2);
        IntentComposer.Compose(atCap).Should().BeNull("no room left this minute → generate nothing (never breach the cap)");

        var oneLeft = Context(Escalating(50), EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), Cast(5),
            rate: tightCap, postsThisMinute: 1);
        IntentComposer.Compose(oneLeft)!.Count.Should().Be(1);
    }

    [Fact]
    public void AnAmbientFloorTrigger_UsesTheAmbientTier()
    {
        var ctx = Context(Escalating(20), EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), Cast(2),
            trigger: ReactionTriggerKind.AmbientFloor);
        IntentComposer.Compose(ctx)!.Tier.Should().Be(GenerationTier.Ambient);
    }
}
