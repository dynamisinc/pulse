namespace Pulse.WebApi.Features.Weather.Kinds;

using System.Text;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The weather kinds' plain-text policy (story 01, NFR-004) for every payload string. It
/// REUSES <see cref="PostSanitizer"/> for tag stripping (the <c>plain</c> profile's engine; never a fork) and adds only
/// control-character removal and trimming (the headline and the <c>BodyHtml</c> narrative are the
/// funnel's: a descriptor never sees them). Like <see cref="PostSanitizer"/> it strips and never entity-encodes: the
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

        // Control characters go FIRST: removed after tag stripping, "<\u0001script>" would survive the stripper (not an
        // opener) and then collapse into a live "<script>". With them gone, the stripper sees the real tags.
        return PostSanitizer.Sanitize(RemoveControls(input, multiline)).Trim();
    }

    private static string RemoveControls(string input, bool multiline)
    {
        var builder = new StringBuilder(input.Length);
        for (var i = 0; i < input.Length; i++)
        {
            var c = input[i];
            if (c == '\r')
            {
                // CRLF and a lone CR are both one line break.
                if (i + 1 < input.Length && input[i + 1] == '\n')
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

        return builder.ToString();
    }

    /// <summary>The Unicode code-point length of <paramref name="value"/> (what a post limit counts).</summary>
    /// <param name="value">The text.</param>
    /// <returns>The number of runes.</returns>
    public static int CodePointLength(string value) => value.EnumerateRunes().Count();

    // The explicit bidi embeddings/overrides/isolates: invisible, and able to reorder displayed text (spoofing).
    private static bool IsBidiControl(char c) => c is >= '\u202A' and <= '\u202E' or >= '\u2066' and <= '\u2069';
}
