namespace Pulse.Core.Features.PersonaVoice.Services;

using Pulse.Core.Features.EngineEval;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;

/// <summary>
/// The believable + diverse acceptance gate (ADP-021, E8 architecture §5.2/§5.3). It combines the two
/// halves — cross-persona <b>diversity</b> (<see cref="VoiceMetrics"/>: max pairwise trigram overlap,
/// distinct-2, per-persona distinctiveness) and per-persona <b>style conformance</b>
/// (<see cref="StyleConformance"/>, the consistency half) — into one pass/fail with the failing checks
/// named, then decides <b>accept / re-roll / drop</b> for the pre-review loop. A burst never reaches a
/// human unless it passes; a converged or off-voice burst is re-rolled up to a bound and then dropped
/// (logged, not surfaced). Pure — the same gate runs in the loop and in eval regression.
/// </summary>
public static class BurstAcceptancePolicy
{
    /// <summary>Default re-roll bound before a failing burst is dropped rather than surfaced (§5.2).</summary>
    public const int DefaultMaxAttempts = 3;

    /// <summary>
    /// Scores a burst: diversity across the burst plus each post's conformance to its own persona's style.
    /// <paramref name="stylesByHandle"/> supplies the established style per persona handle (from
    /// <see cref="VoiceProfileBuilder.RefreshStyle"/>); a post whose handle is absent is only diversity-checked.
    /// Passes only if diversity passes <b>and</b> every post conforms.
    /// </summary>
    public static BurstEvaluation Evaluate(
        IReadOnlyList<GeneratedPost> posts,
        IReadOnlyDictionary<string, PersonaStyle> stylesByHandle,
        VoiceDiversityThresholds? diversityThresholds = null,
        StyleTolerance? styleTolerance = null)
    {
        ArgumentNullException.ThrowIfNull(posts);
        ArgumentNullException.ThrowIfNull(stylesByHandle);

        var diversity = VoiceMetrics.Evaluate(posts, diversityThresholds);

        var nonConforming = new List<string>();
        foreach (var post in posts)
        {
            if (stylesByHandle.TryGetValue(post.PersonaHandle, out var style)
                && !StyleConformance.Check(post.Text, style, styleTolerance).Conforms)
            {
                nonConforming.Add(post.PersonaHandle);
            }
        }

        var failing = new List<string>();
        if (!diversity.Passed)
        {
            if (diversity.Overlap.MaxOverlap >= diversity.Thresholds.MaxPairwiseOverlap)
            {
                failing.Add("pairwise-overlap");
            }

            if (diversity.Distinct2 <= diversity.Thresholds.MinDistinct2)
            {
                failing.Add("distinct-2");
            }

            if (diversity.PersonaDistinctiveness <= diversity.Thresholds.MinPersonaDistinctiveness)
            {
                failing.Add("persona-distinctiveness");
            }
        }

        if (nonConforming.Count > 0)
        {
            failing.Add("style-conformance");
        }

        var passed = diversity.Passed && nonConforming.Count == 0;
        return new BurstEvaluation(passed, diversity, nonConforming, failing);
    }

    /// <summary>
    /// The re-roll decision for a scored burst on attempt <paramref name="attempt"/> (1-based): accept a
    /// passing burst; otherwise re-roll while attempts remain, then drop. A dropped burst is logged
    /// (XC-004) by the caller rather than surfaced (ADP-021, §5.2).
    /// </summary>
    public static BurstDisposition Decide(BurstEvaluation evaluation, int attempt, int maxAttempts = DefaultMaxAttempts)
    {
        ArgumentNullException.ThrowIfNull(evaluation);
        ArgumentOutOfRangeException.ThrowIfLessThan(attempt, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxAttempts, 1);

        if (evaluation.Passed)
        {
            return BurstDisposition.Accept;
        }

        return attempt < maxAttempts ? BurstDisposition.ReRoll : BurstDisposition.Drop;
    }
}
