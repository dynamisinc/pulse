namespace Pulse.WebApi.Features.Press.Kind;

using System.Net;
using System.Text.RegularExpressions;
using Pulse.WebApi.Features.Press.Contracts;

/// <summary>
/// R-P1: the always-non-empty dek of a release (the composer has no dek field). Pure. Story 04 fills
/// <c>ContentItem.Dek</c> from it on every write unless a console-authored explicit dek is present, so a portal row
/// (<c>ChannelContentSummaryDto.dek</c>) is never blank.
/// </summary>
/// <remarks>
/// The dek is the first sentence of the body's PROSE: paragraphs, headings and loose text come first, list items only
/// when the body has no prose, and table cells never (a lone cell such as "Site" makes a poor summary). The sentence
/// is at most <see cref="PressVocabulary.DekMaxLength"/> characters, cut at a whole word with an ellipsis. A body with
/// no usable text (headline-only, or markup only) gets <c>"News release from {orgName}"</c>.
/// </remarks>
public static partial class ReleaseDek
{
    private const string Ellipsis = "…";

    /// <summary>Derives the dek.</summary>
    /// <param name="headline">The release headline (the last fallback, when the org name is blank too).</param>
    /// <param name="bodyText">The body: sanitized HTML (the <c>rich-tables</c> profile) or plain text; may be null.</param>
    /// <param name="orgName">The publishing organization's name.</param>
    /// <returns>A non-empty dek of at most <see cref="PressVocabulary.DekMaxLength"/> characters.</returns>
    public static string Derive(string? headline, string? bodyText, string? orgName)
    {
        var sentence = FirstSentence(bodyText ?? string.Empty);
        if (sentence is not null)
        {
            return Fit(sentence);
        }

        if (!string.IsNullOrWhiteSpace(orgName))
        {
            return Fit($"News release from {Collapse(orgName)}");
        }

        return string.IsNullOrWhiteSpace(headline) ? "News release" : Fit(Collapse(headline));
    }

    private static string? FirstSentence(string body)
    {
        var html = Hidden().Replace(body, " ");
        html = RemoveAll(html, Table());
        var listsRemoved = RemoveAll(html, List());

        var block = FirstBlock(listsRemoved) ?? FirstBlock(html);
        if (block is null)
        {
            return null;
        }

        var end = SentenceEnd().Match(block);
        return end.Success ? block[..(end.Index + 1)] : block;
    }

    /// <summary>Removes every match, innermost first, until none is left (nested lists/tables).</summary>
    private static string RemoveAll(string html, Regex pattern)
    {
        string previous;
        do
        {
            previous = html;
            html = pattern.Replace(html, "\n");
        }
        while (previous != html);

        return html;
    }

    private static string? FirstBlock(string html)
    {
        var text = WebUtility.HtmlDecode(AnyTag().Replace(BlockBoundary().Replace(html, "\n"), string.Empty));
        foreach (var line in text.Split('\n'))
        {
            var block = Collapse(line);
            if (block.Any(char.IsLetterOrDigit))
            {
                return block;
            }
        }

        return null;
    }

    private static string Fit(string text)
    {
        if (text.Length <= PressVocabulary.DekMaxLength)
        {
            return text;
        }

        var limit = PressVocabulary.DekMaxLength - Ellipsis.Length;
        var cut = text.LastIndexOf(' ', limit);
        var head = cut > 0 ? text[..cut] : text[..limit];
        return head.TrimEnd(' ', ',', ';', ':', '-', '—') + Ellipsis;
    }

    private static string Collapse(string text) => Whitespace().Replace(text, " ").Trim();

    [GeneratedRegex(@"<(script|style|template)\b[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex Hidden();

    [GeneratedRegex(@"<table\b[^>]*>(?:(?!<table\b).)*?</table\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex Table();

    [GeneratedRegex(@"<(ul|ol)\b[^>]*>(?:(?!<(?:ul|ol)\b).)*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex List();

    [GeneratedRegex(
        @"<\s*/?\s*(p|div|br|li|ul|ol|h[1-6]|blockquote|table|thead|tbody|tfoot|tr|td|th|caption|hr|pre|section|article)\b[^>]*>",
        RegexOptions.IgnoreCase)]
    private static partial Regex BlockBoundary();

    [GeneratedRegex(@"<[^>]*>")]
    private static partial Regex AnyTag();

    [GeneratedRegex(@"[.!?](?=\s|$)")]
    private static partial Regex SentenceEnd();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
