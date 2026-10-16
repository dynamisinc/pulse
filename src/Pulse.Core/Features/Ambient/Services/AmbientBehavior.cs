namespace Pulse.Core.Features.Ambient.Services;

using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

/// <summary>A persona the loop can voice, paired with its exercise-scoped instance id (the allow-list key).</summary>
/// <param name="PersonaId">The exercise-scoped persona INSTANCE id.</param>
/// <param name="Dossier">The persona's generation-facing voice dossier (persona-voice-engine).</param>
public sealed record AmbientCastMember(Guid PersonaId, PersonaDossier Dossier);

/// <summary>Everything the quiet-floor decide policy reads for one tick. Pure input.</summary>
public sealed record AmbientDecideInput
{
    /// <summary>The exercise (COR-001).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The exercise's current ambient policy.</summary>
    public required AmbientTierPolicy Policy { get; init; }

    /// <summary>The exercise-level effective autonomy (a full stop generates nothing).</summary>
    public required EffectiveAutonomy Autonomy { get; init; }

    /// <summary>The loop's voiceable cast; the policy's persona allow-list is applied to it here.</summary>
    public required IReadOnlyList<AmbientCastMember> Cast { get; init; }

    /// <summary>The exercise's rate governance (quiet floor + global cap, ADP-011).</summary>
    public required RateGovernanceConfig RateConfig { get; init; }

    /// <summary>Engine posts the loop has already committed this scenario minute (storyline + ambient).</summary>
    public int EnginePostsThisMinute { get; init; }

    /// <summary>
    /// Non-engine posts that landed in the trailing scenario minute — participants, injects and WHITE NOISE. Counted
    /// toward the floor so ambient chatter never double-fills a minute white noise already filled.
    /// </summary>
    public int WorldPostsThisMinute { get; init; }

    /// <summary>Ambient posts generated in the rolling last minute (the policy's per-minute window).</summary>
    public int AmbientPostsLastMinute { get; init; }

    /// <summary>Ambient posts generated in the rolling last hour (the policy's per-hour spend window).</summary>
    public int AmbientPostsLastHour { get; init; }

    /// <summary>Storyline-bound intents the loop already decided THIS tick; any at all and ambient yields.</summary>
    public int StorylineIntentsThisTick { get; init; }

    /// <summary>The scenario minute (COR-050) — drives the deterministic topic/persona rotation.</summary>
    public required int ScenarioMinute { get; init; }
}

/// <summary>
/// The quiet-floor decide policy (ADP-005/011, ambient-chatter story 01 AC4): when the world is below
/// <see cref="RateGovernanceConfig.MinBelievableActivity"/>, propose ONE low-priority
/// <see cref="ReactionTriggerKind.AmbientFloor"/> burst on the <see cref="GenerationTier.Ambient"/> tier, sized to the
/// shortfall and clamped by the policy's per-minute and per-hour caps AND the global
/// <see cref="RateGovernanceConfig.MaxEnginePostsPerMinute"/>. Pure and stateless.
/// </summary>
/// <remarks>
/// <para>
/// <b>Not registered in <see cref="ReactionLoop.Services.DecideStage"/>, deliberately.</b> That registry routes a
/// storyline-bound <see cref="ReactionContext"/> (its <c>Storyline</c> is required); ambient chatter belongs to no
/// storyline, and fabricating one would make background colour look like storyline content in every downstream
/// consumer. The loop calls this policy directly, AFTER its storyline work, so it is lowest priority by construction.
/// </para>
/// <para>
/// The produced intent carries <see cref="GenerationIntent.StorylineId"/> = <see cref="Guid.Empty"/> (no storyline),
/// a topic seed from the allow-list, and <see cref="AutonomyLevel.Suggest"/>: an ambient draft that reaches the review
/// queue is never routed at Delayed-auto, so no countdown expiry can ever publish it (AC8).
/// </para>
/// </remarks>
public static class AmbientBehavior
{
    /// <summary>
    /// The ambient tone: calm everyday life with a little warmth — and nothing else. No worry or anger, and no
    /// speculation or skepticism either: those are the vocabulary of a crowd reacting to an incident, which background
    /// chatter must never read as.
    /// </summary>
    public static ToneMix AmbientMix { get; } = new()
    {
        Calm = 0.75,
        Gratitude = 0.25,
    };

    /// <summary>
    /// Decides this tick's ambient burst, or <c>null</c> for none: mode off, engine stopped, a storyline intent this
    /// tick, empty allow-lists (empty means nothing), activity at or above the floor, or no room under any cap.
    /// </summary>
    /// <param name="input">The tick's inputs.</param>
    /// <returns>The ambient intent, or <c>null</c>.</returns>
    public static GenerationIntent? Decide(AmbientDecideInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var policy = input.Policy;

        if (policy.Mode == AmbientPolicyMode.Off || input.Autonomy.GenerationStopped)
        {
            return null;
        }

        // Lowest priority: anything storyline-bound this tick wins outright (AC4).
        if (input.StorylineIntentsThisTick > 0)
        {
            return null;
        }

        var eligible = EligibleCast(policy, input.Cast);
        var topics = policy.TopicAllowList.Where(AmbientTopics.IsKnown).ToList();
        if (eligible.Count == 0 || topics.Count == 0)
        {
            return null; // an empty allow-list means nothing is allowed, never everything
        }

        var activity = input.EnginePostsThisMinute + input.WorldPostsThisMinute;
        var shortfall = RateGovernance.AmbientDeficit(input.RateConfig, activity);
        var count = Allowed(policy, input, shortfall, eligible.Count);
        if (count <= 0)
        {
            return null;
        }

        var offset = PositiveModulo(input.ScenarioMinute, eligible.Count);
        var personas = Enumerable.Range(0, count)
            .Select(i => eligible[(offset + i) % eligible.Count].Dossier)
            .ToList();

        return new GenerationIntent
        {
            StorylineId = Guid.Empty,
            ExerciseId = input.ExerciseId,
            Trigger = ReactionTriggerKind.AmbientFloor,
            Personas = personas,
            ToneMix = AmbientMix,
            Count = count,
            Tier = GenerationTier.Ambient,
            AutonomyLevel = AutonomyLevel.Suggest,
            AmbientTopicSeed = topics[PositiveModulo(input.ScenarioMinute, topics.Count)],
        };
    }

    /// <summary>
    /// How many ambient posts fit: the shortfall, bounded by the remaining per-minute and per-hour policy budget, the
    /// eligible cast (one post per persona), and the global per-minute cap. Never negative.
    /// </summary>
    /// <param name="policy">The policy.</param>
    /// <param name="input">The tick's inputs.</param>
    /// <param name="shortfall">Posts short of the floor.</param>
    /// <param name="castSize">The eligible cast size.</param>
    /// <returns>The allowed count (0 when nothing fits).</returns>
    public static int Allowed(AmbientTierPolicy policy, AmbientDecideInput input, int shortfall, int castSize)
    {
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentNullException.ThrowIfNull(input);

        var minuteRoom = Math.Max(0, policy.MaxPerMinute - input.AmbientPostsLastMinute);
        var hourRoom = Math.Max(0, policy.MaxPerHour - input.AmbientPostsLastHour);
        var desired = Math.Max(0, Math.Min(Math.Min(shortfall, castSize), Math.Min(minuteRoom, hourRoom)));
        return RateGovernance.WithinCap(input.RateConfig, Math.Max(0, input.EnginePostsThisMinute), desired).Allowed;
    }

    /// <summary>The cast members the policy allow-lists, in allow-list order (only personas the loop can voice).</summary>
    private static List<AmbientCastMember> EligibleCast(AmbientTierPolicy policy, IReadOnlyList<AmbientCastMember> cast)
    {
        var eligible = new List<AmbientCastMember>();
        foreach (var personaId in policy.PersonaAllowList)
        {
            var member = cast.FirstOrDefault(c => c.PersonaId == personaId);
            if (member is not null)
            {
                eligible.Add(member);
            }
        }

        return eligible;
    }

    private static int PositiveModulo(int value, int modulus) => ((value % modulus) + modulus) % modulus;
}
