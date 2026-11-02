namespace Pulse.WebApi.Features.Weather.Zones;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;

/// <summary>
/// The pure (no database) half of zone write validation (weather-source story 02): FC-1 slug, kind, lengths and control
/// characters. Slug uniqueness and the default rule need the scoped context and live in <see cref="WeatherZoneService"/>.
/// </summary>
/// <remarks>Every error is collected, so one 400 lists everything wrong. Strings are trimmed; an empty optional string is null.</remarks>
public static class WeatherZoneWriteValidator
{
    /// <summary>The zone kinds (WX-004).</summary>
    public static readonly IReadOnlyList<string> Kinds = ["county", "city", "region", "custom"];

    /// <summary>
    /// The refusal for a PUT that changes the slug. Products and forecasts reference zones by slug, so a slug is immutable
    /// once the zone exists.
    /// </summary>
    public const string SlugImmutableMessage =
        "slug cannot be changed after the zone is created (products and forecasts reference it).";

    /// <summary>Parses and validates a write body.</summary>
    /// <param name="request">The untrusted body, or null.</param>
    /// <param name="existing">The zone being edited (a PUT), or null for a create.</param>
    /// <returns>The draft, or the readable error.</returns>
    public static WeatherZoneParseResult Parse(WeatherZoneWriteRequest? request, WeatherZone? existing)
    {
        if (request is null)
        {
            return WeatherZoneParseResult.Fail("A request body is required.");
        }

        var errors = new List<string>();

        var slug = Trim(request.Slug);
        if (existing is not null && slug is null)
        {
            slug = existing.Slug; // a PUT may omit the immutable slug
        }

        if (slug is null || !ChannelVocabulary.IsSlug(slug))
        {
            errors.Add($"slug must be 1-{WeatherZone.MaxSlugLength} characters of a-z, 0-9 and '-'.");
        }
        else if (existing is not null && !string.Equals(slug, existing.Slug, StringComparison.Ordinal))
        {
            errors.Add(SlugImmutableMessage);
        }

        var name = Trim(request.Name);
        if (name is null)
        {
            errors.Add("name is required.");
        }
        else
        {
            CheckText("name", name, WeatherZone.MaxNameLength, errors);
        }

        var kind = Trim(request.Kind);
        if (kind is null || !Kinds.Contains(kind, StringComparer.Ordinal))
        {
            errors.Add($"kind must be one of {string.Join(", ", Kinds)}.");
        }

        var description = Trim(request.Description);
        if (description is not null)
        {
            CheckText("description", description, WeatherZone.MaxDescriptionLength, errors);
        }

        if (request.SortOrder is < 0)
        {
            errors.Add("sortOrder must not be negative.");
        }

        if (existing is not null && request.Version is null)
        {
            errors.Add("version is required.");
        }

        return errors.Count > 0
            ? WeatherZoneParseResult.Fail(string.Join(" ", errors))
            : WeatherZoneParseResult.Ok(new WeatherZoneDraft(slug!, name!, kind!, description, request.SortOrder, request.IsDefault));
    }

    private static void CheckText(string field, string value, int maxLength, List<string> errors)
    {
        if (value.Length > maxLength)
        {
            errors.Add($"{field} must be at most {maxLength} characters.");
        }

        if (OutletText.HasControlOrInvisible(value))
        {
            errors.Add($"{field} must not contain control or invisible formatting characters.");
        }
    }

    private static string? Trim(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }
}

/// <summary>A validated zone write, ready for the uniqueness and default checks.</summary>
/// <param name="Slug">The FC-1 slug.</param>
/// <param name="Name">The trimmed name.</param>
/// <param name="Kind">The zone kind.</param>
/// <param name="Description">The trimmed description, or null.</param>
/// <param name="SortOrder">The requested order, or null (create: last; edit: keep).</param>
/// <param name="IsDefault">The requested default flag, or null (keep).</param>
public sealed record WeatherZoneDraft(string Slug, string Name, string Kind, string? Description, int? SortOrder, bool? IsDefault);

/// <summary>The result of <see cref="WeatherZoneWriteValidator.Parse"/>.</summary>
/// <param name="Draft">The draft, when valid.</param>
/// <param name="Error">The readable error, when invalid.</param>
public sealed record WeatherZoneParseResult(WeatherZoneDraft? Draft, string? Error)
{
    /// <summary>A valid result.</summary>
    /// <param name="draft">The draft.</param>
    /// <returns>The result.</returns>
    public static WeatherZoneParseResult Ok(WeatherZoneDraft draft) => new(draft, null);

    /// <summary>An invalid result.</summary>
    /// <param name="error">The readable error.</param>
    /// <returns>The result.</returns>
    public static WeatherZoneParseResult Fail(string error) => new(null, error);
}
