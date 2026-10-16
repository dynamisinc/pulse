namespace Pulse.Core.Features.Ambient.Services;

using System.Globalization;
using System.Text;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The output-side "never storyline" check for an ambient-chatter burst (ambient-chatter story 01, orchestrator review
/// W-3 / S-2, Gate-1 W-A). The prompt already tells the model to stay off the incident; this check makes that a
/// guarantee rather than a hope. Deterministic and pure: the same burst and exclusions always give the same verdict.
/// </summary>
/// <remarks>
/// <para>
/// A burst fails, as a whole, when ANY post:
/// </para>
/// <list type="number">
/// <item><description>names a term from <see cref="FixedIncidentTerms"/>;</description></item>
/// <item><description>names one of the active storylines' hashtags (in its text or its hashtag list, with or without
/// the <c>#</c>) or a keyword derived from a storyline title (<see cref="BuildExclusions"/>);</description></item>
/// <item><description>has a <see cref="GeneratedPost.Sentiment"/> below <see cref="MinSentiment"/>.</description></item>
/// </list>
/// <para>
/// <b>Word-boundary matching (Gate-1 W-A).</b> The post (text + hashtag list) is lower-cased (invariant) and split into
/// word tokens — runs of letters/digits, so hyphens, underscores, apostrophes and punctuation separate words
/// (<c>boil-water</c> reads as <c>boil water</c>). A hashtag is ALSO read as one compact token (<c>#Fairhaven_Water</c>
/// → <c>fairhavenwater</c>). Nothing is matched as a raw substring any more:
/// </para>
/// <list type="bullet">
/// <item><description><b>Per-exercise exclusions</b> (storyline hashtags without the <c>#</c>, title keywords) match a
/// whole token, optionally followed by one simple inflection suffix (<see cref="InflectionSuffixes"/>: s, es, ed, ing,
/// er). So title word <c>water</c> hits "water", "waters", "watered" but NOT "watermelon" or "waterfront"; hashtag
/// <c>#Fire</c> hits "#fire", "a fire", "fires" but NOT "fireworks" or "#fireworks" (a hashtag is matched as a whole
/// tag wherever it appears — text or hashtag list — never as the prefix of a longer tag).</description></item>
/// <item><description><b>Fixed vocabulary</b> entries are one or more words that must appear as consecutive tokens. A
/// word ending in <c>*</c> is a word-START stem (it matches any token beginning with it: <c>evacuat*</c> →
/// evacuate / evacuation / evacuating); any other word matches a whole token with an optional inflection suffix.</description></item>
/// </list>
/// <para>
/// <b>Fixed vocabulary rationale.</b> Only stems that are unambiguous at a word start stay single-word
/// (<c>emergenc*</c>, <c>evacuat*</c>, <c>evacuee*</c>, <c>contamina*</c>, <c>hazmat*</c>, <c>outage*</c>). The bare
/// words "officials", "shelter", "alert" and "warning" were dropped: each collides with allow-listed everyday topics
/// ("the officials missed a call" — sports; "adopted a dog from the animal shelter" — pets/community; "spoiler alert",
/// "fair warning" — everyday speech). They are replaced by incident-shaped phrases ("officials said", "shelter in place",
/// "weather alert", "warning issued", …). <c>boil water</c> stays a phrase (it also catches "boil water notice"); a
/// cooking post that says "boil water for the pasta" is a known, accepted false positive.
/// </para>
/// <para>
/// <b>Known, accepted false positives.</b> Storyline title words are generic by nature: for the starter scenario's
/// "Water main contamination fears", <c>water</c> is a keyword, so "a glass of water" or "the dog's water bowl" is still
/// dropped. That is on-incident vocabulary for that exercise and is accepted on purpose: dropping background chatter
/// costs nothing, leaking the incident into it does. Whole-word matching only removes the substring collisions
/// (watermelon, brainstorm, powerful, fireworks).
/// </para>
/// <para>
/// <b>Exclusions are a snapshot (Gate-1 S-2).</b> The caller builds them from the reaction-loop registration's
/// storylines, which are frozen when the loop is seeded; a storyline injected at runtime must refresh the registration
/// (and so the exclusions) or its hashtags/title words are not excluded. The fixed vocabulary still applies.
/// </para>
/// <para>
/// <b>Sentiment (S-2).</b> A generated post carries a continuous sentiment (−1…+1), not a tone category, so "only Calm
/// or Gratitude" is enforced as "never negative": Calm sits around 0 and Gratitude above it, while worry, anger and
/// skepticism read negative. <see cref="MinSentiment"/> leaves a small tolerance below 0 for a neutral post.
/// </para>
/// <para>
/// The caller treats a failure exactly like a content-guard failure: re-roll within the bounded budget, then drop.
/// Nothing from a failing burst is published or queued.
/// </para>
/// </remarks>
public static class AmbientOutputFilter
{
    /// <summary>The lowest post sentiment an ambient post may carry (calm ≈ 0, gratitude &gt; 0).</summary>
    public const double MinSentiment = -0.1;

    /// <summary>The failing-check name for an incident term / storyline hashtag / storyline keyword hit.</summary>
    public const string IncidentTermCheck = "ambient:incident-term";

    /// <summary>The failing-check name for a post whose sentiment is below <see cref="MinSentiment"/>.</summary>
    public const string SentimentCheck = "ambient:sentiment";

    /// <summary>The shortest storyline-title word kept as a keyword (shorter words are too common to be a signal).</summary>
    public const int MinTitleKeywordLength = 5;

    /// <summary>The simple inflection suffixes a whole-word term may carry and still match (<c>water</c> → <c>waters</c>).</summary>
    public static IReadOnlyList<string> InflectionSuffixes { get; } = ["s", "es", "ed", "ing", "er"];

    /// <summary>
    /// The fixed incident vocabulary every ambient post is checked against, whatever the storyline. Space-separated
    /// words must appear as consecutive tokens; a trailing <c>*</c> marks a word-start stem; any other word matches
    /// as a whole word with an optional <see cref="InflectionSuffixes"/> suffix. See the type remarks for the rationale.
    /// </summary>
    public static IReadOnlyList<string> FixedIncidentTerms { get; } =
    [
        // Unambiguous word-start stems.
        "emergenc*",
        "evacuat*",
        "evacuee*",
        "contamina*",
        "hazmat*",
        "outage*",

        // Water-incident phrases.
        "boil water",
        "boil notice",
        "boil advisory",
        "boil order",

        // Official-response phrases (bare "officials" collides with sports).
        "officials said",
        "officials say",
        "officials announced",
        "officials confirmed",
        "officials warn*",
        "officials urg*",

        // Protective-action phrases (bare "shelter" collides with the animal shelter).
        "shelter in place",

        // Alerting phrases (bare "alert" / "warning" collide with "spoiler alert" / "fair warning").
        "weather alert",
        "severe weather",
        "alert issued",
        "warning issued",
        "advisory issued",
    ];

    private static readonly HashSet<string> TitleStopWords = new(StringComparer.Ordinal)
    {
        "about", "after", "again", "against", "before", "being", "below", "between", "could", "during", "every",
        "their", "there", "these", "those", "through", "under", "until", "where", "which", "while", "would",
        "still", "other", "should",
    };

    private static readonly IReadOnlyList<string[]> ParsedFixedTerms =
        FixedIncidentTerms.Select(term => term.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToList();

    /// <summary>
    /// The per-exercise exclusions derived from the active storylines: every hashtag (lower-cased letters/digits only,
    /// without <c>#</c>) and every title word of at least <see cref="MinTitleKeywordLength"/> letters that is not a
    /// stop word. Each is matched as a whole word (with simple inflections) by <see cref="MentionsIncident"/>.
    /// </summary>
    /// <param name="storylineHashtags">The active storylines' hashtags.</param>
    /// <param name="storylineTitles">The active storylines' titles.</param>
    /// <returns>The normalised, de-duplicated exclusion terms (deterministic order).</returns>
    public static IReadOnlyList<string> BuildExclusions(
        IEnumerable<string> storylineHashtags,
        IEnumerable<string> storylineTitles)
    {
        ArgumentNullException.ThrowIfNull(storylineHashtags);
        ArgumentNullException.ThrowIfNull(storylineTitles);

        var terms = new List<string>();
        void Add(string term)
        {
            if (term.Length > 0 && !terms.Contains(term, StringComparer.Ordinal))
            {
                terms.Add(term);
            }
        }

        foreach (var hashtag in storylineHashtags)
        {
            Add(Compact(hashtag));
        }

        foreach (var title in storylineTitles)
        {
            foreach (var word in Tokenize(title))
            {
                if (word.Length >= MinTitleKeywordLength && !TitleStopWords.Contains(word))
                {
                    Add(word);
                }
            }
        }

        return terms;
    }

    /// <summary>Inspects an ambient burst. Pure.</summary>
    /// <param name="posts">The generated posts.</param>
    /// <param name="exclusions">The per-exercise exclusions from <see cref="BuildExclusions"/> (already normalised).</param>
    /// <returns>The failing checks; empty when the burst is clean.</returns>
    public static IReadOnlyList<string> Inspect(IReadOnlyList<GeneratedPost> posts, IReadOnlyList<string> exclusions)
    {
        ArgumentNullException.ThrowIfNull(posts);
        ArgumentNullException.ThrowIfNull(exclusions);

        var failing = new List<string>();
        foreach (var post in posts)
        {
            if (!failing.Contains(IncidentTermCheck) && MentionsIncident(post, exclusions))
            {
                failing.Add(IncidentTermCheck);
            }

            if (!failing.Contains(SentimentCheck) && (double.IsNaN(post.Sentiment) || post.Sentiment < MinSentiment))
            {
                failing.Add(SentimentCheck);
            }
        }

        return failing;
    }

    /// <summary>Whether one post names an incident term, storyline hashtag or storyline keyword (word-boundary match).</summary>
    /// <param name="post">The post.</param>
    /// <param name="exclusions">The per-exercise exclusions (normalised, from <see cref="BuildExclusions"/>).</param>
    /// <returns><c>true</c> on any hit.</returns>
    public static bool MentionsIncident(GeneratedPost post, IReadOnlyList<string> exclusions)
    {
        ArgumentNullException.ThrowIfNull(post);
        ArgumentNullException.ThrowIfNull(exclusions);

        // Word sequences: the text, then each hashtag-list entry, kept apart so a phrase never spans two of them.
        var sequences = new List<IReadOnlyList<string>> { Tokenize(post.Text) };
        var compactTags = new List<string>(HashtagTokens(post.Text));
        foreach (var hashtag in post.Hashtags ?? [])
        {
            sequences.Add(Tokenize(hashtag));
            compactTags.Add(Compact(hashtag));
        }

        if (ParsedFixedTerms.Any(term => sequences.Any(tokens => ContainsPhrase(tokens, term))))
        {
            return true;
        }

        foreach (var term in exclusions)
        {
            if (term.Length == 0)
            {
                continue;
            }

            if (sequences.Any(tokens => tokens.Any(token => WordMatches(token, term)))
                || compactTags.Any(tag => WordMatches(tag, term)))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Lower-case (invariant), hyphens/underscores/whitespace collapsed to single spaces, trimmed.</summary>
    /// <param name="text">The text.</param>
    /// <returns>The normalised text.</returns>
    public static string Normalize(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var sb = new StringBuilder(text.Length);
        var lastWasSpace = true;
        foreach (var ch in text.ToLower(CultureInfo.InvariantCulture))
        {
            if (char.IsWhiteSpace(ch) || ch is '-' or '_')
            {
                if (!lastWasSpace)
                {
                    sb.Append(' ');
                    lastWasSpace = true;
                }

                continue;
            }

            sb.Append(ch);
            lastWasSpace = false;
        }

        return sb.ToString().TrimEnd();
    }

    /// <summary>
    /// Splits text into lower-cased (invariant) word tokens: maximal runs of letters/digits. Everything else
    /// (whitespace, punctuation, <c>#</c>, hyphens, underscores, apostrophes) is a boundary.
    /// </summary>
    /// <param name="text">The text.</param>
    /// <returns>The tokens, in order.</returns>
    public static IReadOnlyList<string> Tokenize(string? text)
    {
        var tokens = new List<string>();
        if (string.IsNullOrEmpty(text))
        {
            return tokens;
        }

        var sb = new StringBuilder();
        foreach (var ch in text.ToLower(CultureInfo.InvariantCulture))
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(ch);
            }
            else if (sb.Length > 0)
            {
                tokens.Add(sb.ToString());
                sb.Clear();
            }
        }

        if (sb.Length > 0)
        {
            tokens.Add(sb.ToString());
        }

        return tokens;
    }

    /// <summary>Lower-cased letters/digits only (<c>#Fairhaven_Water</c> → <c>fairhavenwater</c>).</summary>
    private static string Compact(string? text) =>
        string.IsNullOrEmpty(text)
            ? string.Empty
            : new string(text.ToLower(CultureInfo.InvariantCulture).Where(char.IsLetterOrDigit).ToArray());

    /// <summary>Each <c>#tag</c> in free text, compacted (so an underscore tag still reads as one tag).</summary>
    private static IEnumerable<string> HashtagTokens(string? text) =>
        string.IsNullOrEmpty(text)
            ? []
            : text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
                .Where(chunk => chunk.StartsWith('#'))
                .Select(Compact)
                .Where(tag => tag.Length > 0);

    /// <summary>Whether <paramref name="pattern"/> appears as consecutive tokens in <paramref name="tokens"/>.</summary>
    private static bool ContainsPhrase(IReadOnlyList<string> tokens, string[] pattern)
    {
        for (var start = 0; start + pattern.Length <= tokens.Count; start++)
        {
            var hit = true;
            for (var i = 0; i < pattern.Length && hit; i++)
            {
                var word = pattern[i];
                hit = word.EndsWith('*')
                    ? tokens[start + i].StartsWith(word[..^1], StringComparison.Ordinal)
                    : WordMatches(tokens[start + i], word);
            }

            if (hit)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Whole-word match allowing one simple inflection suffix (<c>water</c> ⇒ water / waters / watered).</summary>
    private static bool WordMatches(string token, string word)
    {
        if (!token.StartsWith(word, StringComparison.Ordinal))
        {
            return false;
        }

        if (token.Length == word.Length)
        {
            return true;
        }

        var rest = token.AsSpan(word.Length);
        foreach (var suffix in InflectionSuffixes)
        {
            if (rest.SequenceEqual(suffix.AsSpan()))
            {
                return true;
            }
        }

        return false;
    }
}
