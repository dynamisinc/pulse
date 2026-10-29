namespace Pulse.WebApi.Features.Weather.Kinds;

using System.Text;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The weather kinds' plain-text policy (story 01, NFR-004) for every payload string, the narrative and the headline. It
/// REUSES <see cref="PostSanitizer"/> for tag stripping (the <c>plain</c> profile's engine; never a fork) and adds only
/// control-character removal and trimming. Like <see cref="PostSanitizer"/> it strips and never entity-encodes: the
/// participant render path is a React text node.
/// </summary>
public static class WeatherPlainText
{
    /// <summary>
    /// Cleans one authored string: tags stripped (<c>&lt;script&gt;</c>/<c>&lt;style&gt;</c> with their contents), control
    /// characters and bidi overrides removed, ends trimmed. Idempotent.
    /// </summary>
    /// <param name="input">The untrusted text.</param>
    /// <param name="multiline">
    /// <c>true</c> keeps line breaks (normalized to <c>\n</c>); <c>false</c> turns tab/CR/LF into a space.
    /// </param>
    /// <returns>The inert plain text.</returns>
    public static string Clean(string input, bool multiline)
    {
        ArgumentNullException.ThrowIfNull(input);

        var stripped = PostSanitizer.Sanitize(input);
        var builder = new StringBuilder(stripped.Length);
        for (var i = 0; i < stripped.Length; i++)
        {
            var c = stripped[i];
            if (c == '\r')
            {
                // CRLF and a lone CR are both one line break.
                if (i + 1 < stripped.Length && stripped[i + 1] == '\n')
                {
                    i++;
                }

                builder.Append(multiline ? '\n' : ' ');
            }
            else if (c == '\n')
            {
                builder.Append(multiline ? '\n' : ' ');
            }
            else if (c == '\t')
            {
                builder.Append(' ');
            }
            else if (!char.IsControl(c) && !IsBidiControl(c))
            {
                builder.Append(c);
            }
        }

        return builder.ToString().Trim();
    }

    /// <summary>
    /// The headline policy (D4-010): the stored string is quoted verbatim by the alert, the post, the widget and the page, so
    /// the only transformation is trimming the ends — no case change, no truncation, no tag or entity rewriting.
    /// </summary>
    /// <param name="headline">The authored headline.</param>
    /// <returns>The headline, trimmed.</returns>
    public static string Headline(string headline)
    {
        ArgumentNullException.ThrowIfNull(headline);
        return headline.Trim();
    }

    /// <summary>The Unicode code-point length of <paramref name="value"/> (what a post limit counts).</summary>
    /// <param name="value">The text.</param>
    /// <returns>The number of runes.</returns>
    public static int CodePointLength(string value) => value.EnumerateRunes().Count();

    // The explicit bidi embeddings/overrides/isolates: invisible, and able to reorder displayed text (spoofing).
    private static bool IsBidiControl(char c) => c is >= '‪' and <= '‮' or >= '⁦' and <= '⁩';
}
