namespace Pulse.Core.Features.ResponseReaction.Services;

using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Suggests which storyline an official post addresses (ADP-002a, §7.2), with a confidence — the engine's
/// half of suggestion-with-confirmation. Pure keyword/hashtag similarity of the official text to the
/// storyline's <see cref="Storyline.Expectation"/> + <see cref="Storyline.Hashtags"/> (an embedding model is
/// a later upgrade behind this same seam). The engine only ever <i>suggests</i>; a controller confirms, and
/// the trust curve (<see cref="ResponseMatchTrustCurve"/>) earns any opt-in auto-confirm — the engine never
/// raises its own match-autonomy.
/// </summary>
public static class ResponseMatcher
{
    /// <summary>Default confidence cutoff below which a post is treated as unmatched (miss-safe applies).</summary>
    public const double MatchThreshold = 0.3;

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "a", "an", "to", "of", "and", "is", "it", "in", "on", "for", "we", "our", "will", "has",
        "have", "with", "that", "this", "are", "as", "at", "by", "be", "no", "not", "please", "about",
    };

    /// <summary>The suggested confidence that <paramref name="officialText"/> addresses <paramref name="storyline"/>.</summary>
    public static MatchSuggestion Suggest(string officialText, Storyline storyline)
    {
        ArgumentNullException.ThrowIfNull(officialText);
        ArgumentNullException.ThrowIfNull(storyline);

        var postTokens = Tokenize(officialText);

        // A verbatim hashtag hit is a strong signal — people tag the concern they're addressing.
        foreach (var tag in storyline.Hashtags)
        {
            var bare = tag.TrimStart('#');
            if (bare.Length > 0 && postTokens.Contains(bare))
            {
                return new MatchSuggestion(storyline.Id, 0.9);
            }
        }

        // Otherwise: coverage of the expectation's content words (+ hashtag words) by the post. Filter
        // hashtag words the same way as any token (drop empty / too-short / stop-words) so a low-signal tag
        // can't inflate target.Count and deflate confidence for reasons unrelated to the official text.
        var target = Tokenize(storyline.Expectation);
        foreach (var tag in storyline.Hashtags)
        {
            var word = tag.TrimStart('#').ToLowerInvariant();
            if (word.Length > 2 && !StopWords.Contains(word))
            {
                target.Add(word);
            }
        }

        if (target.Count == 0)
        {
            return new MatchSuggestion(storyline.Id, 0.0);
        }

        var hits = target.Count(postTokens.Contains);
        return new MatchSuggestion(storyline.Id, Math.Round((double)hits / target.Count, 3));
    }

    /// <summary>The best-scoring storyline suggestion for <paramref name="officialText"/>, or null when there are no storylines.</summary>
    public static MatchSuggestion? SuggestBest(string officialText, IReadOnlyList<Storyline> storylines)
    {
        ArgumentNullException.ThrowIfNull(storylines);
        if (storylines.Count == 0)
        {
            return null;
        }

        MatchSuggestion best = default;
        var found = false;
        foreach (var s in storylines)
        {
            var suggestion = Suggest(officialText, s);
            if (!found || suggestion.Confidence > best.Confidence)
            {
                best = suggestion;
                found = true;
            }
        }

        return best;
    }

    private static HashSet<string> Tokenize(string text)
    {
        var tokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var current = new System.Text.StringBuilder();
        foreach (var ch in text)
        {
            if (char.IsLetterOrDigit(ch))
            {
                current.Append(char.ToLowerInvariant(ch));
            }
            else
            {
                Flush(current, tokens);
            }
        }

        Flush(current, tokens);
        return tokens;
    }

    private static void Flush(System.Text.StringBuilder current, HashSet<string> tokens)
    {
        if (current.Length > 0)
        {
            var word = current.ToString();
            if (word.Length > 2 && !StopWords.Contains(word))
            {
                tokens.Add(word);
            }

            current.Clear();
        }
    }
}
