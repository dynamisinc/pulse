namespace Pulse.Core.Features.ReactionLoop.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// The composition point of the decide stage (E8 architecture §1.2, ADP-010/011): turns a
/// <see cref="ReactionContext"/> into a <see cref="GenerationIntent"/> by folding together the storyline's
/// curve/phase (tone mix), the dial-target follow (<see cref="TargetFollow"/>), the rate caps/quiet floors
/// (<see cref="RateGovernance"/>), and the safety-resolved autonomy level. Pure and stateless — the default
/// behavior every reactive policy builds on. Returns <c>null</c> when nothing should generate this tick:
/// the engine is stopped, no personas are eligible, or the rate cap leaves no room (throttled).
/// </summary>
public static class IntentComposer
{
    /// <summary>Composes the base intent, or null when this tick should produce no burst.</summary>
    public static GenerationIntent? Compose(ReactionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        // A stopped engine (kill switch full stop) generates nothing; no cast → nothing to voice.
        if (context.Autonomy.GenerationStopped || context.EligiblePersonas.Count == 0)
        {
            return null;
        }

        var storyline = context.Storyline;
        var desired = DesiredPostCount(storyline, context.RateConfig);

        // One post per persona (burst-in-one-call), then bound by the per-minute cap (ADP-011) — the intent
        // never requests a burst that would breach MaxEnginePostsPerMinute.
        desired = Math.Min(desired, context.EligiblePersonas.Count);
        var allowed = RateGovernance.WithinCap(context.RateConfig, context.PostsThisMinute, desired).Allowed;
        if (allowed <= 0)
        {
            return null;
        }

        return new GenerationIntent
        {
            StorylineId = storyline.Id,
            ExerciseId = storyline.ExerciseId,
            Trigger = context.Trigger,
            Personas = [.. context.EligiblePersonas.Take(allowed)],
            ToneMix = storyline.ToBrief().ToneMix,
            Count = allowed,
            Tier = TierFor(context.Trigger),
            AutonomyLevel = context.Autonomy.Level,
        };
    }

    /// <summary>
    /// How many posts to request before the cap: driven by the dial target when set (the follow loop's
    /// cap-bounded suggestion, CTL-022), otherwise a small curve-following burst sized by phase. A target
    /// asking to lower/hold produces no new burst — the engine tapers and lets decay work.
    /// </summary>
    private static int DesiredPostCount(Storyline storyline, RateGovernanceConfig rateConfig)
    {
        var modulation = TargetFollow.Modulate(storyline, rateConfig);
        if (modulation.HasTarget)
        {
            return modulation.Direction == TargetFollowDirection.Raise ? modulation.SuggestedPostCount : 0;
        }

        // No target → follow the curve: a heavier concern earns a slightly bigger burst.
        return storyline.Phase switch
        {
            StorylinePhase.Peak => 3,
            StorylinePhase.Escalating => 2,
            StorylinePhase.Seeded => 1,
            _ => 1,
        };
    }

    // Ambient-floor filling is Haiku-tier (bulk of volume, §3.2); storyline-critical reactions are Standard.
    private static GenerationTier TierFor(ReactionTriggerKind trigger) =>
        trigger == ReactionTriggerKind.AmbientFloor ? GenerationTier.Ambient : GenerationTier.Standard;
}
