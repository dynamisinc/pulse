namespace Pulse.Core.Features.Ambient.Services;

using System.Globalization;
using System.Text;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The output-side "never storyline" check for an ambient-chatter burst (ambient-chatter story 01, orchestrator review
/// W-3 / S-2). The prompt already tells the model to stay off the incident; this check makes that a guarantee rather
/// than a hope. Deterministic and pure: the same burst and exclusions always give the same verdict.
/// </summary>
/// <remarks>
/// <para>
/// A burst fails, as a whole, when ANY post:
/// </para>
/// <list type="number">
/// <item><description>contains a term from <see cref="FixedIncidentTerms"/> (substring, case-insensitive, with hyphens
/// and underscores read as spaces, so <c>boil-water</c> matches <c>boil water</c> and <c>evacuat</c> matches
/// <c>evacuation</c>);</description></item>
/// <item><description>contains one of the active storylines' hashtags (in its text or its hashtag list, with or
/// without the <c>#</c>), or a keyword derived from a storyline title (<see cref="BuildExclusions"/>);</description></item>
/// <item><description>has a <see cref="GeneratedPost.Sentiment"/> below <see cref="MinSentiment"/>.</description></item>
/// </list>
/// <para>
/// <b>Sentiment (S-2).</b> A generated post carries a continuous sentiment (−1…+1), not a tone category, so "only Calm
/// or Gratitude" is enforced as "never negative": Calm sits around 0 and Gratitude above it, while worry, anger and
/// skepticism read negative. <see cref="MinSentiment"/> leaves a small tolerance below 0 for a neutral post.
/// </para>
/// <para>
/// The caller treats a failure exactly like a content-guard failure: re-roll within the bounded budget, then drop.
/// Nothing from a failing burst is published or queued. False positives (an innocent "animal shelter" post) are
/// accepted on purpose: dropping background chatter costs nothing, leaking the incident into it does.
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

    /// <summary>
    /// The fixed incident vocabulary every ambient post is checked against, whatever the storyline. Stems
    /// (<c>evacuat</c>, <c>contamina</c>) cover their inflections.
    /// </summary>
    public static IReadOnlyList<string> FixedIncidentTerms { get; } =
    [
        "emergency",
        "evacuat",
        "outage",
        "contamina",
        "boil water",
        "officials",
        "shelter",
        "alert",
        "warning",
        "hazmat",
    ];

    private static readonly HashSet<string> TitleStopWords = new(StringComparer.Ordinal)
    {
        "about", "after", "again", "against", "before", "being", "below", "between", "could", "during", "every",
        "their", "there", "these", "those", "through", "under", "until", "where", "which", "while", "would",
        "still", "other", "should",
    };

    /// <summary>
    /// The per-exercise exclusions derived from the active storylines: every hashtag (normalised, without <c>#</c>)
    /// and every title word of at least <see cref="MinTitleKeywordLength"/> letters that is not a stop word.
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
            Add(Normalize(hashtag.TrimStart('#')));
        }

        foreach (var title in storylineTitles)
        {
            foreach (var word in Normalize(title).Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var letters = new string(word.Where(char.IsLetterOrDigit).ToArray());
                if (letters.Length >= MinTitleKeywordLength && !TitleStopWords.Contains(letters))
                {
                    Add(letters);
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

    /// <summary>Whether one post names an incident term, storyline hashtag or storyline keyword.</summary>
    /// <param name="post">The post.</param>
    /// <param name="exclusions">The per-exercise exclusions (normalised).</param>
    /// <returns><c>true</c> on any hit.</returns>
    public static bool MentionsIncident(GeneratedPost post, IReadOnlyList<string> exclusions)
    {
        ArgumentNullException.ThrowIfNull(post);
        ArgumentNullException.ThrowIfNull(exclusions);

        var haystack = Normalize(post.Text + " " + string.Join(" ", post.Hashtags ?? []));
        return FixedIncidentTerms.Any(term => haystack.Contains(Normalize(term), StringComparison.Ordinal))
            || exclusions.Any(term => term.Length > 0 && haystack.Contains(term, StringComparison.Ordinal));
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
}
