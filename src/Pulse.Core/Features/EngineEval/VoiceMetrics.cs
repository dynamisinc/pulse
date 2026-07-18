namespace Pulse.Core.Features.EngineEval;

using Pulse.Core.Features.Generation.Models;

/// <summary>
/// Pure voice-diversity metrics (ADP-021), ported from the self-validated spike
/// (<c>spikes/e8-generation-loop/metrics.mjs</c>) and co-owned with <c>engine-eval-harness</c>. These
/// catch the failure mode that breaks immersion: a burst converging on one authorial voice. They run
/// as a pre-review gate (a converged burst is re-rolled before a human sees it) and as CI regression
/// as prompts/models change. Thresholds live in <see cref="VoiceDiversityThresholds"/>.
/// </summary>
public static class VoiceMetrics
{
    private static readonly HashSet<string> StopWords = new(StringComparer.Ordinal)
    {
        "the", "a", "an", "to", "of", "and", "is", "it", "in", "on", "for",
        "i", "you", "we", "they", "my", "this", "that", "at", "be", "do", "if",
    };

    /// <summary>Max pairwise trigram Jaccard overlap across a burst. High = converging on one voice (ADP-021 failure).</summary>
    public static PairwiseOverlap MaxPairwiseOverlap(IReadOnlyList<GeneratedPost> posts, int n = 3)
    {
        ArgumentNullException.ThrowIfNull(posts);
        var worst = 0.0;
        string? a = null;
        string? b = null;

        for (var i = 0; i < posts.Count; i++)
        {
            for (var j = i + 1; j < posts.Count; j++)
            {
                var setA = NGrams(posts[i].Text, n);
                var setB = NGrams(posts[j].Text, n);
                if (setA.Count == 0 || setB.Count == 0)
                {
                    continue;
                }

                var intersection = setA.Count(setB.Contains);
                var union = setA.Count + setB.Count - intersection;
                var jaccard = union == 0 ? 0.0 : (double)intersection / union;
                if (jaccard > worst)
                {
                    worst = jaccard;
                    a = posts[i].PersonaHandle;
                    b = posts[j].PersonaHandle;
                }
            }
        }

        return new PairwiseOverlap(worst, a, b);
    }

    /// <summary>distinct-2: unique bigrams / total bigrams across the burst. Low = repetitive, templated output.</summary>
    public static double Distinct2(IReadOnlyList<GeneratedPost> posts)
    {
        ArgumentNullException.ThrowIfNull(posts);
        var all = posts.SelectMany(p => NGramList(p.Text, 2)).ToList();
        if (all.Count == 0)
        {
            return 1.0;
        }

        return (double)all.Distinct(StringComparer.Ordinal).Count() / all.Count;
    }

    /// <summary>
    /// Per-persona content-word distinctiveness vs. the rest of the burst; returns the minimum
    /// (the worst-blended persona). Low = one persona dissolving into the crowd voice.
    /// </summary>
    public static double PersonaDistinctiveness(IReadOnlyList<GeneratedPost> posts)
    {
        ArgumentNullException.ThrowIfNull(posts);
        var vocab = posts
            .Select(p => Tokens(p.Text).Where(w => !StopWords.Contains(w)).ToHashSet(StringComparer.Ordinal))
            .ToList();

        var min = 1.0;
        for (var i = 0; i < vocab.Count; i++)
        {
            var own = vocab[i];
            if (own.Count == 0)
            {
                continue;
            }

            var others = new HashSet<string>(StringComparer.Ordinal);
            for (var j = 0; j < vocab.Count; j++)
            {
                if (j != i)
                {
                    others.UnionWith(vocab[j]);
                }
            }

            var shared = own.Count(others.Contains);
            var distinct = 1.0 - ((double)shared / own.Count);
            if (distinct < min)
            {
                min = distinct;
            }
        }

        return min;
    }

    /// <summary>Runs all diversity metrics and returns a pass/fail against <paramref name="thresholds"/>.</summary>
    public static VoiceDiversityResult Evaluate(
        IReadOnlyList<GeneratedPost> posts,
        VoiceDiversityThresholds? thresholds = null)
    {
        ArgumentNullException.ThrowIfNull(posts);
        var t = thresholds ?? VoiceDiversityThresholds.Default;
        var overlap = MaxPairwiseOverlap(posts);
        var distinct2 = Distinct2(posts);
        var distinctiveness = PersonaDistinctiveness(posts);

        var passed = overlap.MaxOverlap < t.MaxPairwiseOverlap
            && distinct2 > t.MinDistinct2
            && distinctiveness > t.MinPersonaDistinctiveness;

        return new VoiceDiversityResult(passed, overlap, distinct2, distinctiveness, t);
    }

    private static List<string> Tokens(string text)
    {
        var result = new List<string>();
        var current = new System.Text.StringBuilder();
        foreach (var ch in text)
        {
            if (char.IsLetterOrDigit(ch))
            {
                current.Append(char.ToLowerInvariant(ch));
            }
            else if (current.Length > 0)
            {
                result.Add(current.ToString());
                current.Clear();
            }
        }

        if (current.Length > 0)
        {
            result.Add(current.ToString());
        }

        return result;
    }

    private static List<string> NGramList(string text, int n)
    {
        var tokens = Tokens(text);
        var grams = new List<string>();
        for (var i = 0; i + n <= tokens.Count; i++)
        {
            grams.Add(string.Join(' ', tokens.GetRange(i, n)));
        }

        return grams;
    }

    private static HashSet<string> NGrams(string text, int n) =>
        NGramList(text, n).ToHashSet(StringComparer.Ordinal);
}

/// <summary>The worst pairwise trigram overlap in a burst and the two personas responsible.</summary>
public sealed record PairwiseOverlap(double MaxOverlap, string? PersonaA, string? PersonaB);

/// <summary>v1 proposal thresholds (architecture §5.3), tuned against real bursts by the eval harness.</summary>
public sealed record VoiceDiversityThresholds
{
    public double MaxPairwiseOverlap { get; init; } = 0.2;
    public double MinDistinct2 { get; init; } = 0.7;
    public double MinPersonaDistinctiveness { get; init; } = 0.4;

    public static VoiceDiversityThresholds Default { get; } = new();
}

/// <summary>Outcome of the diversity gate for one burst.</summary>
public sealed record VoiceDiversityResult(
    bool Passed,
    PairwiseOverlap Overlap,
    double Distinct2,
    double PersonaDistinctiveness,
    VoiceDiversityThresholds Thresholds);
