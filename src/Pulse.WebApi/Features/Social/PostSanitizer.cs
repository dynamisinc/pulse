namespace Pulse.WebApi.Features.Social;

using System.Text.RegularExpressions;

/// <summary>
/// Server-side free-text sanitizer for the post ingest path (NFR-004) — the exact mirror of the frontend
/// <c>features/social/services/sanitize.ts</c>. It guards against STORED XSS: a caller types/pastes raw
/// HTML (<c>&lt;script&gt;…&lt;/script&gt;</c>, <c>&lt;img onerror=…&gt;</c>, a
/// <c>&lt;a href="javascript:…"&gt;</c>) that some later surface renders.
/// </summary>
/// <remarks>
/// <para>
/// <b>Strip, never encode.</b> Like <c>sanitize.ts</c> (see its lines ~41-45), this STRIPS markup and
/// deliberately does NOT HTML-entity-encode: the participant render path is a React text node
/// (<c>{post.text}</c>) that already escapes <c>&amp; &lt; &gt; " '</c> at render, so entity-encoding here
/// would DOUBLE-encode ordinary text (<c>don't</c> → <c>don&amp;#39;t</c>) and break the fiction — the
/// cardinal rule. Stripping keeps the author's literal <c>&amp; " '</c> and stray <c>&lt;</c>/<c>&gt;</c>
/// while removing anything that could parse as executable markup in a non-React consumer too (an AAR export,
/// a console replay), so a stored script can execute NOWHERE (NFR-004).
/// </para>
/// <para>
/// A pure static function with no dependencies — it needs no DI registration; the ingest funnel calls it
/// directly at the one ingest boundary.
/// </para>
/// </remarks>
public static partial class PostSanitizer
{
    /// <summary>
    /// A <c>&lt;script&gt;</c>/<c>&lt;style&gt;</c> element plus its contents (the highest-risk vectors).
    /// Mirrors <c>sanitize.ts</c>'s <c>SCRIPT_STYLE_BLOCK_RE</c> — the <c>\1</c> backreference pairs the
    /// closing tag to its opener.
    /// </summary>
    [GeneratedRegex(
        @"<(script|style)\b[^>]*>[\s\S]*?</\1\s*>",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ScriptStyleBlockRegex();

    /// <summary>
    /// Any remaining HTML tag — opening, closing, or self-closing. Mirrors <c>sanitize.ts</c>'s
    /// <c>HTML_TAG_RE</c>; the <c>[a-zA-Z]</c> lead already covers both cases, so no ignore-case flag is
    /// needed (matching the frontend, whose second pattern also has no <c>i</c> flag).
    /// </summary>
    [GeneratedRegex(@"</?[a-zA-Z][^>]*>")]
    private static partial Regex HtmlTagRegex();

    /// <summary>
    /// Strips HTML markup from <paramref name="input"/> so the stored text can never parse as executable
    /// markup, while preserving the author's literal characters. A stored <c>&lt;script&gt;…&lt;/script&gt;</c>
    /// or <c>&lt;img onerror=…&gt;</c> is removed entirely. Applied exactly once, at the ingest boundary.
    /// </summary>
    /// <param name="input">The raw post text to sanitize.</param>
    /// <returns>The stripped, inert plain text (never entity-encoded).</returns>
    public static string Sanitize(string input)
    {
        ArgumentNullException.ThrowIfNull(input);

        var withoutBlocks = ScriptStyleBlockRegex().Replace(input, string.Empty);
        return HtmlTagRegex().Replace(withoutBlocks, string.Empty);
    }
}
