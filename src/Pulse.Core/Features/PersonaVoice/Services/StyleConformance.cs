namespace Pulse.Core.Features.PersonaVoice.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;

/// <summary>
/// The consistency half of the believable + diverse metric (ADP-020, §5.1/§5.3): does one generated post
/// conform to its persona's established style params (length, emoji rate, hashtag rate, caps convention)
/// within tolerance? A persona that suddenly writes twice as long, drops all its emoji, or shouts when it
/// never shouts is drifting off its own voice — even if the burst is diverse. Pure; runs identically in
/// the pre-review gate and in CI regression.
/// </summary>
public static class StyleConformance
{
    /// <summary>Checks <paramref name="postText"/> against <paramref name="style"/> within <paramref name="tolerance"/>.</summary>
    public static StyleConformanceResult Check(string postText, PersonaStyle style, StyleTolerance? tolerance = null)
    {
        ArgumentNullException.ThrowIfNull(postText);
        ArgumentNullException.ThrowIfNull(style);
        var tol = tolerance ?? StyleTolerance.Default;
        var failed = new List<string>();

        // Length: a ratio band around the established average (people vary post to post).
        if (style.AvgLength > 0)
        {
            var ratio = (double)postText.Length / style.AvgLength;
            if (ratio < tol.MinLengthRatio || ratio > tol.MaxLengthRatio)
            {
                failed.Add("length");
            }
        }

        if (Math.Abs(StyleAnalysis.EmojiCount(postText) - style.EmojiRate) > tol.EmojiSlack)
        {
            failed.Add("emoji");
        }

        if (Math.Abs(StyleAnalysis.HashtagCount(postText) - style.HashtagRate) > tol.HashtagSlack)
        {
            failed.Add("hashtags");
        }

        if (tol.EnforceCaps && !CapsCompatible(StyleAnalysis.CapsOf(postText), style.CapsConvention))
        {
            failed.Add("caps");
        }

        return new StyleConformanceResult(failed.Count == 0, failed);
    }

    // A "normal" post is compatible with any convention (it's the unmarked case); a marked convention
    // (lower / SHOUTY) must match, so a persona that never shouts writing in all-caps is flagged.
    private static bool CapsCompatible(string postCaps, string styleCaps) =>
        postCaps == StyleAnalysis.Normal
        || styleCaps == StyleAnalysis.Normal
        || postCaps == styleCaps;
}
