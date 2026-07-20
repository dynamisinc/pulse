namespace Pulse.Core.Features.ResponseReaction.Models;

/// <summary>The engine's suggested match of an official post to a storyline (ADP-002a, §7.2).</summary>
/// <param name="StorylineId">The storyline the official post is suggested to address.</param>
/// <param name="Confidence">Similarity of the post to the storyline's expectation + hashtags, 0.0–1.0.</param>
public readonly record struct MatchSuggestion(Guid StorylineId, double Confidence);

/// <summary>How an official post resolved against the storylines (§7).</summary>
public enum MatchKind
{
    /// <summary>Confirmed match (controller-confirmed, off-platform marker, or opted-in auto-confirm above cutoff).</summary>
    Matched,

    /// <summary>A suggestion exists but needs the controller's Y/N — surfaces the match prompt.</summary>
    NeedsConfirmation,

    /// <summary>No storyline is plausibly addressed — the miss-safe default applies (slow, never silence).</summary>
    Unmatched,
}

/// <summary>
/// How an <c>AddressingCandidate</c> resolved (ADP-002/002a, §7): matched to a storyline, awaiting the
/// controller's confirmation, or unmatched. The <b>miss-safe</b> guarantee lives in how the caller treats
/// each kind — only <see cref="MatchKind.Matched"/> ever addresses a storyline (resets its silence clock and
/// bends it down); <see cref="MatchKind.Unmatched"/> and <see cref="MatchKind.NeedsConfirmation"/> are never
/// treated as silence and never falsely satisfy a concern.
/// </summary>
/// <param name="Kind">The resolution.</param>
/// <param name="StorylineId">The addressed/suggested storyline (for Matched / NeedsConfirmation); null when Unmatched.</param>
/// <param name="Confidence">The suggestion confidence that drove it.</param>
/// <param name="ViaOffPlatformMarker">True when an off-platform marker (CTL-026) satisfied it — the identical satisfier.</param>
public sealed record MatchResolution(
    MatchKind Kind,
    Guid? StorylineId,
    double Confidence,
    bool ViaOffPlatformMarker)
{
    /// <summary>Whether this resolution confirms a match (the only kind that addresses a storyline).</summary>
    public bool IsMatch => Kind == MatchKind.Matched;
}
