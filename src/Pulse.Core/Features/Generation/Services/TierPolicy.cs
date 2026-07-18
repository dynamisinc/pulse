namespace Pulse.Core.Features.Generation.Services;

using Pulse.Core.Features.Generation.Models;

/// <summary>Why a burst is being generated — the input that drives model-tier selection (§3.2).</summary>
public enum GenerationPurpose
{
    /// <summary>Escalating anxiety/speculation when officials are silent (ADP-001) — storyline-critical.</summary>
    SilenceEscalation,

    /// <summary>Reaction to a matched official response (ADP-002) — storyline-critical.</summary>
    ResponseReaction,

    /// <summary>Confusion content when statements conflict (ADP-003) — storyline-critical.</summary>
    ContradictionReaction,

    /// <summary>Rumor propagation / crowd-correction (F8.4) — storyline-critical.</summary>
    RumorContent,

    /// <summary>Low-intensity background posting during lulls (ADP-005) — bulk.</summary>
    AmbientChatter,

    /// <summary>Repost/quote/react to spread selected content (ADP-004) — bulk.</summary>
    Amplification,
}

/// <summary>
/// Picks the model tier for a generation intent (story 04). Storyline-critical reactions get the
/// <see cref="GenerationTier.Standard"/> tier (top voice quality); ambient chatter and bulk
/// amplification get <see cref="GenerationTier.Ambient"/> — the model-tiering cost lever (§3.2, §4.2).
/// Unknown purposes fail toward quality (Standard), never toward the cheaper tier.
/// </summary>
public interface ITierPolicy
{
    GenerationTier PickTier(GenerationPurpose purpose);
}

/// <inheritdoc />
public sealed class TierPolicy : ITierPolicy
{
    public GenerationTier PickTier(GenerationPurpose purpose) => purpose switch
    {
        GenerationPurpose.SilenceEscalation
            or GenerationPurpose.ResponseReaction
            or GenerationPurpose.ContradictionReaction
            or GenerationPurpose.RumorContent => GenerationTier.Standard,
        GenerationPurpose.AmbientChatter
            or GenerationPurpose.Amplification => GenerationTier.Ambient,
        _ => GenerationTier.Standard,
    };
}
