namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Text.Json;
using System.Text.Json.Nodes;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The pure (no database) half of outlet write validation (channels-foundation story 03, AC "Validation"): shape,
/// FC-1 slug, lengths, control characters, categories and the FC-3b skin overrides. Reference checks (persona, parent,
/// logo) and slug uniqueness need the scoped context and live in <see cref="OutletService"/>.
/// </summary>
/// <remarks>
/// Every error is collected, so one 400 lists everything wrong. Strings are trimmed; an empty optional string is null.
/// </remarks>
public static class OutletWriteValidator
{
    /// <summary>The most categories an outlet may carry.</summary>
    public const int MaxCategories = 20;

    /// <summary>The longest category.</summary>
    public const int MaxCategoryLength = 40;

    /// <summary>
    /// A slug no outlet may take: <c>GET /api/outlets/staff</c> is a literal route, which routing prefers over
    /// <c>GET /api/outlets/{slug}</c>, so an outlet with this slug could never be read by slug.
    /// </summary>
    public const string ReservedSlug = "staff";

    /// <summary>Parses and validates a write body.</summary>
    /// <param name="request">The untrusted body, or null.</param>
    /// <param name="existing">The outlet being edited (a PUT), or null for a create.</param>
    /// <param name="validator">The FC-3b skin-overrides validator.</param>
    /// <returns>The draft, or the readable error.</returns>
    public static OutletParseResult Parse(OutletWriteRequest? request, Outlet? existing, ISkinOverridesValidator validator)
    {
        ArgumentNullException.ThrowIfNull(validator);
        if (request is null)
        {
            return OutletParseResult.Fail("A request body is required.");
        }

        var errors = new List<string>();

        var channelId = Trim(request.ChannelId);
        if (existing is null)
        {
            if (channelId is null || !ChannelVocabulary.ContentChannelIds.Contains(channelId, StringComparer.Ordinal))
            {
                errors.Add($"channelId must be one of {string.Join(", ", ChannelVocabulary.ContentChannelIds)}.");
            }
        }
        else if (channelId is not null && !string.Equals(channelId, existing.ChannelId, StringComparison.Ordinal))
        {
            errors.Add("channelId cannot be changed after the outlet is created.");
        }

        var slug = Trim(request.Slug);
        if (slug is null || !ChannelVocabulary.IsSlug(slug))
        {
            errors.Add("slug must be 1-80 characters of a-z, 0-9 and '-'.");
        }
        else if (slug == ReservedSlug)
        {
            errors.Add($"slug '{ReservedSlug}' is reserved.");
        }

        var name = Trim(request.Name);
        if (name is null)
        {
            errors.Add("name is required.");
        }
        else
        {
            CheckText("name", name, Outlet.MaxNameLength, errors);
        }

        var tagline = Trim(request.Tagline);
        if (tagline is not null)
        {
            CheckText("tagline", tagline, Outlet.MaxTaglineLength, errors);
        }

        var parentOutletId = ParseId("parentOutletId", request.ParentOutletId, errors);
        var pairedPersonaId = ParseId("pairedPersonaId", request.PairedPersonaId, errors);
        var logoMediaId = ParseId("logoMediaId", request.LogoMediaId, errors);

        var categories = ParseCategories(request.Categories, errors);

        var skinKey = Trim(request.SkinKey);
        var skinKeyValid = skinKey is not null && skinKey.Length <= Outlet.MaxSkinKeyLength && ChannelVocabulary.IsSlug(skinKey);
        if (!skinKeyValid)
        {
            errors.Add($"skinKey must be 1-{Outlet.MaxSkinKeyLength} characters of a-z, 0-9 and '-'.");
        }

        string? skinOverridesJson = null;
        switch (request.SkinOverrides)
        {
            case null:
                break;
            case JsonObject overrides:
                // Clutter and homeLead "clutter" depend on the skin key; an invalid key cannot be the tabloid one.
                var result = validator.Validate(skinKeyValid ? skinKey! : string.Empty, overrides);
                errors.AddRange(result.Errors);
                if (result.IsValid && overrides.Count > 0)
                {
                    skinOverridesJson = overrides.ToJsonString();
                }

                break;
            default:
                errors.Add("skinOverrides must be an object.");
                break;
        }

        if (request.SortOrder is < 0)
        {
            errors.Add("sortOrder must not be negative.");
        }

        if (existing is not null && request.Version is null)
        {
            errors.Add("version is required.");
        }

        if (errors.Count > 0)
        {
            return OutletParseResult.Fail(string.Join(" ", errors));
        }

        return OutletParseResult.Ok(new OutletDraft(
            existing?.ChannelId ?? channelId!,
            slug!,
            name!,
            tagline,
            parentOutletId,
            pairedPersonaId,
            logoMediaId,
            categories,
            JsonSerializer.Serialize(categories),
            skinKey!,
            skinOverridesJson,
            request.Enabled,
            request.SortOrder));
    }

    private static List<string> ParseCategories(IReadOnlyList<string?>? raw, List<string> errors)
    {
        var categories = new List<string>();
        if (raw is null)
        {
            return categories;
        }

        if (raw.Count > MaxCategories)
        {
            errors.Add($"categories may hold at most {MaxCategories} entries.");
            return categories;
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < raw.Count; index++)
        {
            var category = Trim(raw[index]);
            var label = $"categories[{index}]";
            if (category is null)
            {
                errors.Add($"{label} must not be blank.");
                continue;
            }

            CheckText(label, category, MaxCategoryLength, errors);
            if (!seen.Add(category))
            {
                errors.Add($"{label} '{category}' is a duplicate.");
                continue;
            }

            categories.Add(category);
        }

        return categories;
    }

    private static Guid? ParseId(string field, string? raw, List<string> errors)
    {
        var trimmed = Trim(raw);
        if (trimmed is null)
        {
            return null;
        }

        if (!Guid.TryParse(trimmed, out var id) || id == Guid.Empty)
        {
            errors.Add($"{field} must be a GUID.");
            return null;
        }

        return id;
    }

    private static void CheckText(string field, string value, int maxLength, List<string> errors)
    {
        if (value.Length > maxLength)
        {
            errors.Add($"{field} must be at most {maxLength} characters.");
        }

        if (value.Any(char.IsControl))
        {
            errors.Add($"{field} must not contain control characters.");
        }
    }

    private static string? Trim(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }
}

/// <summary>A validated outlet write, ready for the reference checks.</summary>
/// <param name="ChannelId">The content channel.</param>
/// <param name="Slug">The FC-1 slug.</param>
/// <param name="Name">The trimmed name.</param>
/// <param name="Tagline">The trimmed tagline, or null.</param>
/// <param name="ParentOutletId">The parent outlet id, or null.</param>
/// <param name="PairedPersonaId">The paired persona id, or null.</param>
/// <param name="LogoMediaId">The logo asset id, or null.</param>
/// <param name="Categories">The trimmed, de-duplicated categories.</param>
/// <param name="CategoriesJson">The categories as the stored JSON array.</param>
/// <param name="SkinKey">The skin key.</param>
/// <param name="SkinOverridesJson">The compact overrides JSON, or null when absent or empty.</param>
/// <param name="Enabled">The requested visibility, or null (create: true; edit: keep).</param>
/// <param name="SortOrder">The requested order, or null (create: last; edit: keep).</param>
public sealed record OutletDraft(
    string ChannelId,
    string Slug,
    string Name,
    string? Tagline,
    Guid? ParentOutletId,
    Guid? PairedPersonaId,
    Guid? LogoMediaId,
    IReadOnlyList<string> Categories,
    string CategoriesJson,
    string SkinKey,
    string? SkinOverridesJson,
    bool? Enabled,
    int? SortOrder);

/// <summary>The result of <see cref="OutletWriteValidator.Parse"/>.</summary>
/// <param name="Draft">The draft, when valid.</param>
/// <param name="Error">The readable error, when invalid.</param>
public sealed record OutletParseResult(OutletDraft? Draft, string? Error)
{
    /// <summary>A valid result.</summary>
    /// <param name="draft">The draft.</param>
    /// <returns>The result.</returns>
    public static OutletParseResult Ok(OutletDraft draft) => new(draft, null);

    /// <summary>An invalid result.</summary>
    /// <param name="error">The readable error.</param>
    /// <returns>The result.</returns>
    public static OutletParseResult Fail(string error) => new(null, error);
}
