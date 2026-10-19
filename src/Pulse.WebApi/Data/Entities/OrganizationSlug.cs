namespace Pulse.WebApi.Data.Entities;

using System.Text;

/// <summary>
/// Derives an <see cref="Organization.Slug"/> from an organization name (ADMIN-IDENTITY-MODEL §1.1). The rule is
/// the SAME one the <c>AdminIdentityFoundation</c> migration's backfill applies in T-SQL, so a slug derived here
/// for a new organization looks exactly like a backfilled one: ASCII letters and digits are lower-cased and kept,
/// every other run of characters collapses to one hyphen, leading/trailing hyphens are trimmed, the result is cut
/// to <see cref="Organization.MaxSlugLength"/>, and an empty result becomes <c>org</c>.
/// </summary>
public static class OrganizationSlug
{
    /// <summary>The slug used when a name contains no ASCII letter or digit at all.</summary>
    public const string Fallback = "org";

    /// <summary>Derives the slug for <paramref name="name"/>.</summary>
    /// <param name="name">The organization's display name.</param>
    /// <returns>A non-empty slug of at most <see cref="Organization.MaxSlugLength"/> characters.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="name"/> is <c>null</c>.</exception>
    public static string FromName(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var builder = new StringBuilder(Organization.MaxSlugLength);
        var lastWasHyphen = false;

        foreach (var character in name)
        {
            if (char.IsAsciiLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
                lastWasHyphen = false;
            }
            else if (!lastWasHyphen && builder.Length > 0)
            {
                builder.Append('-');
                lastWasHyphen = true;
            }
        }

        if (builder.Length > Organization.MaxSlugLength)
        {
            builder.Length = Organization.MaxSlugLength;
        }

        while (builder.Length > 0 && builder[^1] == '-')
        {
            builder.Length--;
        }

        return builder.Length == 0 ? Fallback : builder.ToString();
    }

    /// <summary>
    /// The <paramref name="ordinal"/>-th collision candidate for <paramref name="baseSlug"/> — the SAME rule the
    /// <c>AdminIdentityFoundation</c> backfill applies in T-SQL (<c>LEFT(@base, 63 - LEN(@suffix)) + @suffix</c>, with
    /// <c>@suffix = '-' + n</c> for n = 2, 3, …), so a collision-suffixed slug minted here looks exactly like a
    /// backfilled one and still fits <see cref="Organization.MaxSlugLength"/>.
    /// </summary>
    /// <param name="baseSlug">The un-suffixed slug (from <see cref="FromName"/>).</param>
    /// <param name="ordinal">The suffix number (2 for the first collision).</param>
    /// <returns>The suffixed slug.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="baseSlug"/> is <c>null</c>.</exception>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="ordinal"/> is below 2.</exception>
    public static string WithCollisionSuffix(string baseSlug, int ordinal)
    {
        ArgumentNullException.ThrowIfNull(baseSlug);
        ArgumentOutOfRangeException.ThrowIfLessThan(ordinal, 2);

        var suffix = "-" + ordinal.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var keep = Math.Min(baseSlug.Length, Organization.MaxSlugLength - suffix.Length);
        return string.Concat(baseSlug.AsSpan(0, keep), suffix);
    }
}
