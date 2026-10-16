namespace Pulse.Core.Tests.Features.Ambient;

using FluentAssertions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// ambient-chatter story 01, AC4: the quiet-floor decide policy fires only below the floor, yields to storyline
/// intents, draws personas and topics only from the allow-lists, and is clamped by the per-minute, per-hour and global
/// caps. White-noise posts count toward the floor, so ambient never double-fills it.
/// </summary>
public class AmbientBehaviorTests
{
    private static readonly Guid ExerciseId = Guid.NewGuid();

    private static readonly List<AmbientCastMember> FullCast =
        [.. Enumerable.Range(0, 8).Select(i => new AmbientCastMember(
            Guid.NewGuid(),
            new PersonaDossier { Handle = $"@p{i}", DisplayName = $"P{i}", Type = PersonaType.Resident }))];

    private static AmbientTierPolicy Policy(
        AmbientPolicyMode mode = AmbientPolicyMode.Autonomous,
        int perMinute = 10,
        int perHour = 100,
        IReadOnlyList<string>? topics = null,
        IReadOnlyList<Guid>? personas = null) => new()
        {
            Mode = mode,
            MaxPerMinute = perMinute,
            MaxPerHour = perHour,
            TopicAllowList = topics ?? [AmbientTopics.Food, AmbientTopics.Sports],
            PersonaAllowList = personas ?? FullCast.Take(4).Select(c => c.PersonaId).ToList(),
        };

    private static AmbientDecideInput Input(
        AmbientTierPolicy policy,
        int enginePosts = 0,
        int worldPosts = 0,
        int ambientMinute = 0,
        int ambientHour = 0,
        int storylineIntents = 0,
        RateGovernanceConfig? rate = null,
        EffectiveAutonomy? autonomy = null,
        int minute = 3) => new()
        {
            ExerciseId = ExerciseId,
            Policy = policy,
            Autonomy = autonomy ?? EffectiveAutonomy.Running(AutonomyLevel.Suggest),
            Cast = FullCast,
            RateConfig = rate ?? RateGovernanceConfig.Default, // floor 6, cap 60
            EnginePostsThisMinute = enginePosts,
            WorldPostsThisMinute = worldPosts,
            AmbientPostsLastMinute = ambientMinute,
            AmbientPostsLastHour = ambientHour,
            StorylineIntentsThisTick = storylineIntents,
            ScenarioMinute = minute,
        };

    [Fact]
    public void BelowTheFloor_EmitsAnAmbientFloorIntent_OnTheAmbientTier()
    {
        var intent = AmbientBehavior.Decide(Input(Policy()));

        intent.Should().NotBeNull();
        intent!.Trigger.Should().Be(ReactionTriggerKind.AmbientFloor);
        intent.Tier.Should().Be(GenerationTier.Ambient, "ambient chatter runs on the cheap tier (engine-generation-infra 04)");
        intent.StorylineId.Should().Be(Guid.Empty, "ambient belongs to no storyline");
        intent.AutonomyLevel.Should().Be(AutonomyLevel.Suggest, "an ambient draft is never routed at Delayed-auto (AC8)");
        intent.Count.Should().Be(4, "the shortfall is 6 but only four personas are allow-listed (one post each)");
    }

    [Fact]
    public void ModeOff_ProducesNothing()
    {
        AmbientBehavior.Decide(Input(Policy(AmbientPolicyMode.Off))).Should().BeNull();
    }

    [Fact]
    public void AStoppedEngine_ProducesNothing()
    {
        AmbientBehavior.Decide(Input(Policy(), autonomy: EffectiveAutonomy.Stopped)).Should().BeNull();
    }

    [Fact]
    public void AtOrAboveTheFloor_ProducesNothing()
    {
        AmbientBehavior.Decide(Input(Policy(), enginePosts: 6)).Should().BeNull("the world is already believable");
    }

    [Fact]
    public void WhiteNoiseAndParticipantPosts_CountTowardTheFloor_SoAmbientNeverDoubleFillsIt()
    {
        AmbientBehavior.Decide(Input(Policy(), worldPosts: 6)).Should().BeNull(
            "six white-noise posts this minute already meet the floor of six");

        AmbientBehavior.Decide(Input(Policy(), worldPosts: 4))!.Count.Should().Be(2, "only the remaining shortfall is filled");
    }

    [Fact]
    public void AStorylineIntentThisTick_TakesPriority()
    {
        AmbientBehavior.Decide(Input(Policy(), storylineIntents: 1)).Should().BeNull("ambient is lowest priority (AC4)");
    }

    [Fact]
    public void EmptyAllowLists_MeanNothing()
    {
        AmbientBehavior.Decide(Input(Policy(topics: []))).Should().BeNull("an empty topic allow-list allows nothing");
        AmbientBehavior.Decide(Input(Policy(personas: []))).Should().BeNull("an empty persona allow-list allows nothing");
    }

    [Fact]
    public void Personas_ComeOnlyFromTheAllowList()
    {
        var allowed = FullCast.Skip(5).Take(2).Select(c => c.PersonaId).ToList();
        var allowedHandles = FullCast.Where(c => allowed.Contains(c.PersonaId)).Select(c => c.Dossier.Handle);

        var intent = AmbientBehavior.Decide(Input(Policy(personas: allowed)));

        intent!.Personas.Select(p => p.Handle).Should().BeSubsetOf(allowedHandles);
    }

    [Fact]
    public void AnAllowListedPersonaOutsideTheCast_IsNeverVoiced()
    {
        AmbientBehavior.Decide(Input(Policy(personas: [Guid.NewGuid()]))).Should().BeNull(
            "a persona the loop cannot voice is skipped, never substituted");
    }

    [Fact]
    public void TheTopicSeed_ComesOnlyFromTheAllowList()
    {
        for (var minute = 0; minute < 5; minute++)
        {
            AmbientBehavior.Decide(Input(Policy(topics: [AmbientTopics.Pets]), minute: minute))!
                .AmbientTopicSeed.Should().Be(AmbientTopics.Pets);
        }
    }

    [Fact]
    public void ClampedByThePerMinuteCap()
    {
        AmbientBehavior.Decide(Input(Policy(perMinute: 3), ambientMinute: 2))!.Count.Should().Be(1);
        AmbientBehavior.Decide(Input(Policy(perMinute: 3), ambientMinute: 3)).Should().BeNull();
    }

    [Fact]
    public void ClampedByThePerHourCap()
    {
        AmbientBehavior.Decide(Input(Policy(perHour: 20), ambientHour: 19))!.Count.Should().Be(1);
        AmbientBehavior.Decide(Input(Policy(perHour: 20), ambientHour: 20)).Should().BeNull("the per-hour cap is the spend cap");
    }

    [Fact]
    public void ClampedByTheGlobalMaxEnginePostsPerMinute()
    {
        var rate = new RateGovernanceConfig(maxEnginePostsPerMinute: 6, minBelievableActivity: 6);

        AmbientBehavior.Decide(Input(Policy(), enginePosts: 5, rate: rate))!.Count.Should().Be(1);

        var tight = new RateGovernanceConfig(maxEnginePostsPerMinute: 2, minBelievableActivity: 2);
        AmbientBehavior.Decide(Input(Policy(), enginePosts: 0, rate: tight))!.Count.Should().Be(2,
            "never more than the global cap even when the policy and cast allow more");
    }
}
