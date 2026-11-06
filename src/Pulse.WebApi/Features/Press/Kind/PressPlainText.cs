namespace Pulse.WebApi.Features.Press.Kind;

using System.Text;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Plain-text cleaning for the release payload's text fields (contact, dateline, boilerplate, cross-post text): the same
/// rules as the other channels' payload text (control characters out FIRST, then every tag stripped by
/// <see cref="PostSanitizer"/>, then trimmed). Rendered as text by the client; never HTML.
/// </summary>
internal static class PressPlainText
{
    /// <summary>Cleans <paramref name="input"/> to plain text.</summary>
    /// <param name="input">The untrusted text.</param>
    /// <param name="multiline">Whether line breaks are kept (as <c>\n</c>) or folded to spaces.</param>
    /// <returns>The cleaned, trimmed text.</returns>
    public static string Clean(string input, bool multiline)
    {
        ArgumentNullException.ThrowIfNull(input);

        // Control characters go first: removed after tag stripping, "<\u0001script>" would survive the stripper and
        // then collapse into a live "<script>".
        return PostSanitizer.Sanitize(RemoveControls(input, multiline)).Trim();
    }

    /// <summary>The length in Unicode code points (what a cap counts).</summary>
    /// <param name="value">The text.</param>
    /// <returns>The code-point count.</returns>
    public static int CodePointLength(string value) => value.EnumerateRunes().Count();

    private static string RemoveControls(string input, bool multiline)
    {
        var builder = new StringBuilder(input.Length);
        for (var i = 0; i < input.Length; i++)
        {
            var c = input[i];
            if (c == '\r')
            {
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

    // The explicit bidi embeddings/overrides/isolates: invisible, and able to reorder displayed text (spoofing).
    private static bool IsBidiControl(char c) => c is >= '‪' and <= '‮' or >= '⁦' and <= '⁩';
}
