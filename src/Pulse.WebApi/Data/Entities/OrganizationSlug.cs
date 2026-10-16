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
}
