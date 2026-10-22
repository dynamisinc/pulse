namespace Pulse.WebApi.Features.Identity.Credentials;

using System.Collections.Frozen;
using System.Text;

/// <summary>Who a new password is for, which decides its minimum length (ADMIN-IDENTITY-MODEL §3.2).</summary>
public enum PasswordAudience
{
    /// <summary>Any person with a staff enrollment or an org role: minimum <see cref="PasswordPolicy.StaffMinimumLength"/>.</summary>
    Staff,

    /// <summary>A participant-only person or a one-off account: minimum <see cref="PasswordPolicy.ParticipantMinimumLength"/>.</summary>
    Participant,
}

/// <summary>
/// The words a new password must not contain (ADMIN-IDENTITY-MODEL §3.2): the organization name, the email's local part
/// and the person's display name. Every member is optional; a missing one simply contributes nothing.
/// </summary>
public sealed class PasswordContext
{
    /// <summary>The empty context (no context-specific words).</summary>
    public static PasswordContext None { get; } = new();

    /// <summary>The organization's name, or <c>null</c>.</summary>
    public string? OrganizationName { get; init; }

    /// <summary>The person's email address (only the local part is used), or <c>null</c>.</summary>
    public string? Email { get; init; }

    /// <summary>The person's display name, or <c>null</c>.</summary>
    public string? DisplayName { get; init; }
}

/// <summary>
/// The NIST SP 800-63B password policy (identity-auth-roles/21, ADMIN-IDENTITY-MODEL §3.2, Tier-2 sign-off §8.3): a
/// length floor by audience, a 128 ceiling, NO composition rules, an embedded top-10k blocklist, and the
/// context-specific words. Returns a specific, non-leaking error code — never the matched word, never which context
/// field it came from.
/// </summary>
/// <remarks>
/// <para>
/// <b>Length is counted in Unicode code points</b> (800-63B §5.1.1.2: "each Unicode code point SHALL be counted as a
/// single character"), so an emoji is one character, not two UTF-16 units. The password itself is hashed exactly as
/// typed: the sign-in path does not normalize, so neither may this.
/// </para>
/// <para>
/// <b>Blocklist.</b> The embedded resource <c>common-passwords-10k.txt</c> (SecLists, MIT — see its NOTICE file),
/// compared case-insensitively against the WHOLE password. Only ten of its entries are 12+ characters, so for staff the
/// list is a backstop; the length floor does most of the work, as 800-63B intends.
/// </para>
/// <para>
/// <b>Context words.</b> Each source is lower-cased and reduced to its letters and digits, both whole (e.g.
/// <c>"Fairhaven County EM"</c> → <c>fairhavencountyem</c>) and word by word; every resulting term of at least
/// <see cref="MinimumContextTermLength"/> characters is refused anywhere inside the equally-reduced password. The floor
/// keeps short names ("Al", "EM") from refusing unrelated passwords. The ORGANIZATION name contributes its whole name
/// but only its DISTINCTIVE words (Gate-1 S-006): at least <see cref="MinimumOrganizationWordLength"/> characters and not
/// a generic agency word (<see cref="GenericOrganizationWords"/>), so "Fairhaven County Emergency Management" refuses
/// "fairhaven" but not every password that happens to contain "county" or "emergency".
/// </para>
/// <para>
/// <b>The blocklist is compared on a trimmed, case-folded COPY</b> (Gate-1 S-006), so <c>"password1234 "</c> cannot slip
/// past it; the password itself is never trimmed or altered (800-63B: spaces are legitimate characters).
/// </para>
/// </remarks>
public static class PasswordPolicy
{
    /// <summary>The minimum length for staff and org admins (§3.2).</summary>
    public const int StaffMinimumLength = 12;

    /// <summary>The minimum length for participant-only people and one-off accounts (§3.2).</summary>
    public const int ParticipantMinimumLength = 8;

    /// <summary>The maximum length for everyone (§3.2).</summary>
    public const int MaximumLength = 128;

    /// <summary>The shortest context term that is refused inside a password.</summary>
    public const int MinimumContextTermLength = 4;

    /// <summary>The shortest organization-name WORD that is refused on its own (the whole name is always refused).</summary>
    public const int MinimumOrganizationWordLength = 6;

    /// <summary>Generic agency words that are never refused on their own as organization-name words.</summary>
    public static IReadOnlySet<string> GenericOrganizationWords { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "county", "city", "emergency", "management", "department", "office", "agency", "services", "service",
        "public", "safety", "region", "regional", "state", "government", "district", "authority", "organization",
    };

    /// <summary>The error code for a missing or too-short password.</summary>
    public const string TooShortError = "password-too-short";

    /// <summary>The error code for a password over <see cref="MaximumLength"/>.</summary>
    public const string TooLongError = "password-too-long";

    /// <summary>The error code for a password on the common-password blocklist.</summary>
    public const string CommonError = "password-too-common";

    /// <summary>The error code for a password containing the org name, the email local part or the display name.</summary>
    public const string PersonalInfoError = "password-contains-personal-info";

    /// <summary>The manifest name of the embedded blocklist (pinned in the project file).</summary>
    public const string BlocklistResourceName = "Pulse.WebApi.Credentials.common-passwords-10k.txt";

    private static readonly Lazy<FrozenSet<string>> Blocklist = new(LoadBlocklist);

    /// <summary>The number of distinct entries in the embedded blocklist (for tests and diagnostics).</summary>
    public static int BlocklistCount => Blocklist.Value.Count;

    /// <summary>The minimum length for <paramref name="audience"/>.</summary>
    /// <param name="audience">Who the password is for.</param>
    /// <returns>The minimum length in code points.</returns>
    public static int MinimumLengthFor(PasswordAudience audience) =>
        audience == PasswordAudience.Staff ? StaffMinimumLength : ParticipantMinimumLength;

    /// <summary>Checks <paramref name="password"/> against the policy.</summary>
    /// <param name="password">The candidate password, exactly as typed (may be <c>null</c>).</param>
    /// <param name="audience">Who the password is for.</param>
    /// <param name="context">The context-specific words to refuse.</param>
    /// <returns><c>null</c> when the password is acceptable; otherwise one of the error-code constants.</returns>
    public static string? Validate(string? password, PasswordAudience audience, PasswordContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (string.IsNullOrEmpty(password))
        {
            return TooShortError;
        }

        var length = CountCodePoints(password);
        if (length < MinimumLengthFor(audience))
        {
            return TooShortError;
        }

        if (length > MaximumLength)
        {
            return TooLongError;
        }

        if (Blocklist.Value.Contains(password.Trim().ToLowerInvariant()))
        {
            return CommonError;
        }

        var reduced = Reduce(password);
        foreach (var term in ContextTerms(context))
        {
            if (reduced.Contains(term, StringComparison.Ordinal))
            {
                return PersonalInfoError;
            }
        }

        return null;
    }

    private static int CountCodePoints(string value)
    {
        var count = 0;
        foreach (var _ in value.EnumerateRunes())
        {
            count++;
        }

        return count;
    }

    private static IEnumerable<string> ContextTerms(PasswordContext context)
    {
        var emailLocalPart = context.Email is { } email && email.IndexOf('@', StringComparison.Ordinal) is var at and > 0
            ? email[..at]
            : context.Email;

        foreach (var (source, isOrganization) in new[] { (context.OrganizationName, true), (emailLocalPart, false), (context.DisplayName, false) })
        {
            if (string.IsNullOrWhiteSpace(source))
            {
                continue;
            }

            var whole = Reduce(source);
            if (whole.Length >= MinimumContextTermLength)
            {
                yield return whole;
            }

            foreach (var word in Words(source))
            {
                var distinctive = isOrganization
                    ? word.Length >= MinimumOrganizationWordLength && !GenericOrganizationWords.Contains(word)
                    : word.Length >= MinimumContextTermLength;
                if (distinctive)
                {
                    yield return word;
                }
            }
        }
    }

    /// <summary>Lower-cases and keeps only letters and digits.</summary>
    private static string Reduce(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var rune in value.ToLowerInvariant().EnumerateRunes())
        {
            if (Rune.IsLetterOrDigit(rune))
            {
                builder.Append(rune.ToString());
            }
        }

        return builder.ToString();
    }

    /// <summary>The reduced runs of letters and digits in <paramref name="value"/>.</summary>
    private static IEnumerable<string> Words(string value)
    {
        var current = new StringBuilder();
        foreach (var rune in value.ToLowerInvariant().EnumerateRunes())
        {
            if (Rune.IsLetterOrDigit(rune))
            {
                current.Append(rune.ToString());
                continue;
            }

            if (current.Length > 0)
            {
                yield return current.ToString();
                current.Clear();
            }
        }

        if (current.Length > 0)
        {
            yield return current.ToString();
        }
    }

    private static FrozenSet<string> LoadBlocklist()
    {
        using var stream = typeof(PasswordPolicy).Assembly.GetManifestResourceStream(BlocklistResourceName)
            ?? throw new InvalidOperationException(
                $"The embedded password blocklist '{BlocklistResourceName}' is missing; refusing to run the password "
                + "policy without it (identity-auth-roles/21).");
        using var reader = new StreamReader(stream, Encoding.UTF8);

        var entries = new HashSet<string>(StringComparer.Ordinal);
        while (reader.ReadLine() is { } line)
        {
            var entry = line.Trim();
            if (entry.Length > 0)
            {
                entries.Add(entry.ToLowerInvariant());
            }
        }

        return entries.ToFrozenSet(StringComparer.Ordinal);
    }
}
