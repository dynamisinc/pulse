namespace Pulse.WebApi.Features.Identity.Roster;

using System.Globalization;
using System.Text;

/// <summary>
/// Derives a participant's sign-in name (<c>Account.Username</c>) from their name, by the FROZEN rule in
/// <c>docs/features/easy-login/implementation.md</c> ("Derivation and matching rules"), character for character the
/// rule the staff roster mock implements (<c>participantAdmin/mocks/rosterMocks.ts</c>, <c>deriveSignInName</c>) and
/// the roster screen explains to staff.
/// </summary>
/// <remarks>
/// <para>
/// ASCII-fold the name (strip diacritics), lower-case, drop the suffix words <c>jr sr ii iii iv md phd</c>, then take
/// the first initial of the first word plus the last word, letters and digits only, at most 32 characters. A derived
/// name under 3 characters gets <c>1</c> appended. <c>Jane Smith</c> is <c>jsmith</c>, <c>Mary-Ann O'Neil</c> is
/// <c>moneil</c>, <c>José Álvarez</c> is <c>jalvarez</c>, <c>Madonna</c> is <c>madonna</c>, <c>Ng</c> is <c>ng1</c>.
/// </para>
/// <para>
/// <b>Collisions.</b> When the base is taken, the smallest free integer from 2 is appended (<c>jsmith2</c>), the base
/// being shortened so the result still fits in 32 characters. What counts as taken is the caller's decision
/// (<see cref="RosterWorkspace"/> passes every sign-in name in the exercise, every name an earlier row of the same file
/// claimed, and every persona handle in the exercise, so a sign-in name is never a public handle, EL-1). Pure and
/// stateless.
/// </para>
/// </remarks>
public static class SignInNameDeriver
{
    /// <summary>The longest derived sign-in name.</summary>
    public const int MaxLength = 32;

    /// <summary>A derived name shorter than this gets <c>1</c> appended.</summary>
    public const int MinLength = 3;

    /// <summary>The name-suffix words dropped before the initial and last word are taken.</summary>
    private static readonly HashSet<string> Suffixes = new(StringComparer.Ordinal) { "jr", "sr", "ii", "iii", "iv", "md", "phd" };

    /// <summary>Derives the sign-in name for <paramref name="name"/>, stepping around every name <paramref name="isTaken"/> reports.</summary>
    /// <param name="name">The participant's (sanitized) name.</param>
    /// <param name="isTaken">Whether a lower-case candidate is already taken.</param>
    /// <returns>The first free candidate: the base, else the base plus 2, 3, and so on.</returns>
    public static string Derive(string name, Func<string, bool> isTaken)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(isTaken);

        var baseName = DeriveBase(name);
        if (!isTaken(baseName))
        {
            return baseName;
        }

        for (var n = 2; ; n++)
        {
            var suffix = n.ToString(CultureInfo.InvariantCulture);
            var candidate = string.Concat(baseName.AsSpan(0, Math.Min(baseName.Length, MaxLength - suffix.Length)), suffix);
            if (!isTaken(candidate))
            {
                return candidate;
            }
        }
    }

    /// <summary>The uncollided base for <paramref name="name"/> (no suffix for a collision).</summary>
    /// <param name="name">The participant's (sanitized) name.</param>
    /// <returns>The base sign-in name.</returns>
    public static string DeriveBase(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var words = AsciiFold(name)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(LettersAndDigits)
            .Where(word => word.Length > 0 && !Suffixes.Contains(word))
            .ToList();

        var first = words.Count > 0 ? words[0] : string.Empty;
        var last = words.Count > 0 ? words[^1] : string.Empty;
        var baseName = words.Count <= 1 ? last : string.Concat(first.AsSpan(0, 1), last);

        if (baseName.Length > MaxLength)
        {
            baseName = baseName[..MaxLength];
        }

        if (baseName.Length < MinLength)
        {
            baseName += "1";
        }

        return baseName;
    }

    /// <summary>
    /// Decomposes <paramref name="value"/>, drops the combining marks (so <c>é</c> becomes <c>e</c>) and lower-cases it
    /// invariantly. Shared with <see cref="PersonaHandleDeriver"/> so the two derivations fold names identically.
    /// </summary>
    /// <param name="value">The text to fold.</param>
    /// <returns>The folded, lower-case text.</returns>
    internal static string AsciiFold(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            {
                builder.Append(c);
            }
        }

        return builder.ToString().ToLowerInvariant();
    }

    private static string LettersAndDigits(string word)
    {
        var builder = new StringBuilder(word.Length);
        foreach (var c in word)
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(c);
            }
        }

        return builder.ToString();
    }
}
