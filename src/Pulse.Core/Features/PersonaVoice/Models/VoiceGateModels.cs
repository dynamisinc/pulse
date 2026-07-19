namespace Pulse.Core.Features.PersonaVoice.Models;

using Pulse.Core.Features.EngineEval;

/// <summary>
/// Per-dimension tolerances for the style-conformance check (ADP-020, §5.1) — how far a single post may
/// stray from its persona's established style before it reads as off-voice. v1 proposals, tuned against
/// real bursts by the eval harness. Length is a ratio band (people vary post to post); emoji/hashtag are
/// absolute per-post slack (a rate near zero can't use a ratio).
/// </summary>
public sealed record StyleTolerance
{
    /// <summary>A post's length may fall between this fraction and <see cref="MaxLengthRatio"/> of the style's avg.</summary>
    public double MinLengthRatio { get; init; } = 0.4;

    /// <summary>Upper length ratio (a persona who writes ~120 chars shouldn't suddenly write an essay).</summary>
    public double MaxLengthRatio { get; init; } = 2.5;

    /// <summary>Allowed absolute deviation in emoji-per-post from the style's rate.</summary>
    public double EmojiSlack { get; init; } = 1.5;

    /// <summary>Allowed absolute deviation in hashtags-per-post from the style's rate.</summary>
    public double HashtagSlack { get; init; } = 1.5;

    /// <summary>Whether the caps convention (normal/lower/SHOUTY) must match exactly.</summary>
    public bool EnforceCaps { get; init; } = true;

    public static StyleTolerance Default { get; } = new();
}

/// <summary>
/// The outcome of checking one post against its persona's style params. <see cref="Conforms"/> is false if
/// any enforced dimension is out of tolerance; <see cref="FailedDimensions"/> names which, so a re-roll or
/// a hotwash can say <i>why</i> a post read off-voice.
/// </summary>
public sealed record StyleConformanceResult(
    bool Conforms,
    IReadOnlyList<string> FailedDimensions);

/// <summary>What the burst-acceptance gate decided to do with a scored burst (ADP-021, §5.2).</summary>
public enum BurstDisposition
{
    /// <summary>The burst passed both diversity and per-persona style conformance — eligible for review.</summary>
    Accept,

    /// <summary>The burst failed and re-roll attempts remain — regenerate before any human sees it.</summary>
    ReRoll,

    /// <summary>Re-roll attempts are exhausted — drop the burst and log it rather than surface converged content.</summary>
    Drop,
}

/// <summary>
/// The combined "believable + diverse" verdict for one burst (§5.3): the cross-persona diversity result
/// (<see cref="VoiceMetrics"/>) plus per-persona style conformance (the consistency half), with the
/// failing checks named. <see cref="Passed"/> requires <b>both</b> halves — a burst can be diverse yet have
/// a persona drift off its own established voice, and that still fails.
/// </summary>
public sealed record BurstEvaluation(
    bool Passed,
    VoiceDiversityResult Diversity,
    IReadOnlyList<string> NonConformingPersonas,
    IReadOnlyList<string> FailingChecks);
