namespace Pulse.WebApi.Features.Identity.Roster;

using System.Globalization;
using System.Text;

/// <summary>
/// Derives the handle of the citizen persona the roster auto-creates for a participant (EL-4), by the FROZEN rule in
/// <c>docs/features/easy-login/implementation.md</c> ("Derivation and matching rules"), character for character the
/// rule the staff roster mock implements (<c>participantAdmin/mocks/rosterMocks.ts</c>, <c>deriveAutoPersonaHandle</c>).
/// </summary>
/// <remarks>
/// <para>
/// The full name as a slug: ASCII-folded, lower-case, every run of characters outside <c>[a-z0-9]</c> becomes one
/// <c>_</c>, leading and trailing <c>_</c> trimmed, at most 30 characters (<c>Jane Smith</c> is <c>jane_smith</c>). A
/// name with nothing left is <c>participant</c>. When the base is taken, <c>_2</c>, <c>_3</c> and so on are appended,
/// the base being shortened so the result still fits in 30 characters.
/// </para>
/// <para>
/// What counts as taken is the caller's decision: <see cref="RosterWorkspace"/> passes every persona handle in the
/// exercise (case-insensitive, with or without a leading <c>@</c>), every handle an earlier row of the same file
/// claimed, AND every sign-in name in the exercise including the row's own, so a public handle never exposes a sign-in
/// name: <c>Madonna</c> signs in as <c>madonna</c> and posts as <c>@madonna_2</c> (EL-1). Pure and stateless.
/// </para>
/// </remarks>
public static class PersonaHandleDeriver
{
    /// <summary>The longest derived handle.</summary>
    public const int MaxLength = 30;

    /// <summary>The base used when the name slugs to nothing.</summary>
    public const string FallbackBase = "participant";

    /// <summary>Derives the auto persona handle for <paramref name="name"/>, stepping around every handle <paramref name="isTaken"/> reports.</summary>
    /// <param name="name">The participant's (sanitized) name.</param>
    /// <param name="isTaken">Whether a lower-case candidate is already taken.</param>
    /// <returns>The first free candidate: the base, else the base plus <c>_2</c>, <c>_3</c>, and so on.</returns>
    public static string Derive(string name, Func<string, bool> isTaken)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(isTaken);

        var baseHandle = DeriveBase(name);
        if (!isTaken(baseHandle))
        {
            return baseHandle;
        }

        for (var n = 2; ; n++)
        {
            var suffix = "_" + n.ToString(CultureInfo.InvariantCulture);
            var candidate = string.Concat(baseHandle.AsSpan(0, Math.Min(baseHandle.Length, MaxLength - suffix.Length)), suffix);
            if (!isTaken(candidate))
            {
                return candidate;
            }
        }
    }

    /// <summary>The uncollided base handle for <paramref name="name"/>.</summary>
    /// <param name="name">The participant's (sanitized) name.</param>
    /// <returns>The base handle.</returns>
    public static string DeriveBase(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var folded = SignInNameDeriver.AsciiFold(name);
        var builder = new StringBuilder(folded.Length);
        var pendingSeparator = false;
        foreach (var c in folded)
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                if (pendingSeparator && builder.Length > 0)
                {
                    builder.Append('_');
                }

                pendingSeparator = false;
                builder.Append(c);
            }
            else
            {
                pendingSeparator = true;
            }
        }

        // Leading separators were never written and trailing ones are still pending, so the slug is already trimmed.
        var slug = builder.ToString();
        if (slug.Length > MaxLength)
        {
            slug = slug[..MaxLength];
        }

        return slug.Length > 0 ? slug : FallbackBase;
    }
}
