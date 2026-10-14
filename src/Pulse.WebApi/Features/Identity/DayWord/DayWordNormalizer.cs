namespace Pulse.WebApi.Features.Identity.DayWord;

using System.Globalization;
using System.Text;

/// <summary>
/// The ONE day-word normalisation (easy-login EL-9, amended): Unicode NFKD, drop combining marks, lower-case, keep
/// ASCII <c>a-z</c> and <c>0-9</c> only. It runs on BOTH sides of the word: before a staff-set word is hashed and
/// before a sign-in attempt is verified, so <c>Maple Harbor 42</c>, <c>maple-harbor-42</c> and <c>MAPLEHARBOR42</c>
/// are the same word, and so are <c>Café-7</c> and <c>cafe7</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Mirrors the client exactly.</b> The staff panel's live length hint
/// (<c>src/frontend/src/features/participantAdmin/dayWord/dayWordNormalize.ts</c>) runs
/// <c>normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')</c>; this is that chain step
/// for step, and <c>DayWordNormalizerTests</c> pins the shared test vectors (<c>café</c> → <c>cafe</c>,
/// <c>Ñandú 1</c> → <c>nandu1</c>, full-width forms, <c>Straße</c> → <c>strae</c>). The server stays authoritative.
/// </para>
/// <para>
/// <b>Never throws on hostile input.</b> <see cref="string.Normalize(NormalizationForm)"/> refuses ill-formed UTF-16
/// (a lone surrogate) where JavaScript's <c>normalize()</c> passes it through and the ASCII filter then drops it.
/// Lone surrogates are removed first so the two sides agree and an anonymous sign-in can never turn a malformed word
/// into a 500.
/// </para>
/// <para>
/// <b>The result is a secret.</b> Callers never log it, put it in telemetry, or echo it in an error.
/// </para>
/// </remarks>
public static class DayWordNormalizer
{
    /// <summary>The shortest accepted word, counted after normalisation.</summary>
    public const int MinLength = 6;

    /// <summary>The longest accepted word, counted after normalisation.</summary>
    public const int MaxLength = 64;

    /// <summary>
    /// The longest RAW word either route accepts, checked before normalising (a DoS guard on the anonymous sign-in and
    /// a sanity bound on the staff set): four times <see cref="MaxLength"/>, so spaces and punctuation around a
    /// legitimate word always fit. Longer is a <c>400</c>.
    /// </summary>
    public const int MaxRawLength = 4 * MaxLength;

    /// <summary>Normalises a word: NFKD, combining marks dropped, lower-cased, only <c>a-z0-9</c> kept.</summary>
    /// <param name="input">The word as typed, or <c>null</c>.</param>
    /// <returns>The normalised word; empty when nothing survives (or the input is <c>null</c>).</returns>
    public static string Normalize(string? input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return string.Empty;
        }

        var decomposed = Decompose(RemoveLoneSurrogates(input));
        var builder = new StringBuilder(decomposed.Length);

        foreach (var c in decomposed)
        {
            // \p{M}: non-spacing, spacing-combining and enclosing marks (é → e + U+0301 → e).
            var category = CharUnicodeInfo.GetUnicodeCategory(c);
            if (category is UnicodeCategory.NonSpacingMark
                or UnicodeCategory.SpacingCombiningMark
                or UnicodeCategory.EnclosingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(c);
            if (lower is (>= 'a' and <= 'z') or (>= '0' and <= '9'))
            {
                builder.Append(lower);
            }
        }

        return builder.ToString();
    }

    /// <summary>Whether a NORMALISED word has an accepted length (<see cref="MinLength"/> to <see cref="MaxLength"/>).</summary>
    /// <param name="normalized">A value returned by <see cref="Normalize"/>.</param>
    /// <returns><c>true</c> when the length is in range.</returns>
    public static bool IsAcceptableLength(string? normalized) =>
        normalized is not null && normalized.Length is >= MinLength and <= MaxLength;

    /// <summary>Applies Unicode compatibility decomposition (NFKD), falling back to the input if the runtime refuses it.</summary>
    private static string Decompose(string input)
    {
        try
        {
            return input.Normalize(NormalizationForm.FormKD);
        }
        catch (ArgumentException)
        {
            // Unreachable for well-formed UTF-16 (lone surrogates are removed above). Kept so no input can ever
            // surface as an exception (whose message could carry the word): the ASCII filter still applies.
            return input;
        }
    }

    /// <summary>Removes unpaired UTF-16 surrogates, keeping every well-formed pair.</summary>
    private static string RemoveLoneSurrogates(string input)
    {
        StringBuilder? builder = null;

        for (var i = 0; i < input.Length; i++)
        {
            var c = input[i];

            if (char.IsHighSurrogate(c) && i + 1 < input.Length && char.IsLowSurrogate(input[i + 1]))
            {
                builder?.Append(c).Append(input[i + 1]);
                i++;
                continue;
            }

            if (char.IsSurrogate(c))
            {
                builder ??= new StringBuilder(input, 0, i, input.Length);
                continue;
            }

            builder?.Append(c);
        }

        return builder?.ToString() ?? input;
    }
}
