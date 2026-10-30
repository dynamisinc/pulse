namespace Pulse.WebApi.Features.Weather.Kinds;

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;

/// <summary>What the two weather descriptors share: the zone check, the stored-item lookup and the normalized write-back.</summary>
internal static class WeatherKindSupport
{
    /// <summary>The weather kinds may attach images and videos (radar loops, cone graphics, snowfall maps — WX-013), no documents.</summary>
    public static IReadOnlySet<string> AllowedMediaKinds { get; } =
        new HashSet<string>([ChannelVocabulary.MediaKindImage, ChannelVocabulary.MediaKindVideo], StringComparer.Ordinal);

    /// <summary>Plain records, camelCase by attribute; every nullable key written as null (the TS guards need every key).</summary>
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Serializes a normalized payload record to a fresh JSON object.</summary>
    /// <typeparam name="T">The record type.</typeparam>
    /// <param name="value">The record.</param>
    /// <returns>The object.</returns>
    public static JsonObject ToJsonObject<T>(T value) =>
        JsonSerializer.SerializeToNode(value, SerializerOptions)!.AsObject();

    /// <summary>
    /// Replaces the CONTENT of <paramref name="payload"/> with <paramref name="normalized"/>, so the funnel stores the cleaned,
    /// unknown-key-free payload it validated (the instance it passed in) rather than the raw request.
    /// </summary>
    /// <param name="payload">The payload the funnel passed to validation.</param>
    /// <param name="normalized">The normalized form.</param>
    public static void ReplaceContent(JsonObject payload, JsonObject normalized)
    {
        payload.Clear();
        foreach (var key in normalized.Select(p => p.Key).ToList())
        {
            var node = normalized[key];
            normalized.Remove(key);
            payload[key] = node;
        }
    }

    /// <summary>
    /// The stored payload of the item being written (an edit or revise), when it is a weather item of
    /// <paramref name="kind"/> in the resolved exercise that has been PUBLISHED at least once; else null (a create, a
    /// never-published draft, or nothing to grandfather).
    /// </summary>
    /// <param name="context">The validation context.</param>
    /// <param name="kind">The kind.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The stored payload, or null.</returns>
    public static async Task<JsonObject?> StoredPayloadAsync(
        PayloadValidationContext context, string kind, CancellationToken cancellationToken)
    {
        if (context.ContentItemId is not { } id)
        {
            return null;
        }

        // The central filter already scopes the context to context.ExerciseId; the explicit predicate is belt and braces.
        var json = await context.Db.ContentItems
            .Where(c => c.Id == id && c.ExerciseId == context.ExerciseId
                        && c.ChannelId == ChannelVocabulary.Weather && c.Kind == kind
                        && c.PublishedScenarioTime != null)
            .Select(c => c.PayloadJson)
            .FirstOrDefaultAsync(cancellationToken);
        return json is null ? null : TryParseObject(json);
    }

    /// <summary>Parses stored JSON, or null when it is not an object.</summary>
    /// <param name="json">The stored JSON.</param>
    /// <returns>The object, or null.</returns>
    public static JsonObject? TryParseObject(string json)
    {
        try
        {
            return JsonNode.Parse(json) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Checks every slug is a live zone of the resolved exercise through <see cref="IWeatherZoneCatalog"/>. A slug the item
    /// being edited ALREADY stores is accepted even if its zone was soft-deleted since, so a deleted zone never invalidates a
    /// published item. No catalog registered = fail closed.
    /// </summary>
    /// <param name="slugs">The slugs, with the field path of each.</param>
    /// <param name="grandfathered">Slugs the stored item already references.</param>
    /// <param name="context">The validation context.</param>
    /// <param name="errors">Receives the problems.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public static async Task CheckZonesAsync(
        IReadOnlyList<(string Slug, string Path)> slugs,
        IReadOnlySet<string> grandfathered,
        PayloadValidationContext context,
        List<string> errors,
        CancellationToken cancellationToken)
    {
        var toCheck = slugs.Where(s => !grandfathered.Contains(s.Slug)).ToList();
        if (toCheck.Count == 0)
        {
            return;
        }

        var catalog = context.Services.GetService<IWeatherZoneCatalog>();
        if (catalog is null)
        {
            errors.Add($"{toCheck[0].Path}: zone_catalog_unavailable (no weather zone catalog is registered)");
            return;
        }

        var missing = await catalog.ExistAsync(toCheck.Select(s => s.Slug).ToList(), cancellationToken);
        if (missing.Count == 0)
        {
            return;
        }

        if (!await catalog.HasAnyAsync(cancellationToken))
        {
            errors.Add($"{toCheck[0].Path}: no_zones (add a weather zone to the exercise first)");
            return;
        }

        foreach (var (slug, path) in toCheck.Where(s => missing.Contains(s.Slug)))
        {
            errors.Add($"{path}: unknown_zone '{slug}' is not a zone in this exercise");
        }
    }

    /// <summary>
    /// The permalink of a PUBLISHED <c>weather_product</c> in the resolved exercise, or null when there is none with that id
    /// (unknown, another exercise's, draft, retracted, deleted or another kind — all the same answer).
    /// </summary>
    /// <param name="context">The validation context.</param>
    /// <param name="id">The candidate content id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The host-relative permalink, or null.</returns>
    public static async Task<string?> PublishedProductPermalinkAsync(
        PayloadValidationContext context, Guid id, CancellationToken cancellationToken)
    {
        var db = context.Db;
        var row = await (
                from c in db.ContentItems
                where c.Id == id && c.ExerciseId == context.ExerciseId
                      && c.ChannelId == ChannelVocabulary.Weather
                      && c.Kind == ChannelVocabulary.KindWeatherProduct
                      && c.Status == ChannelVocabulary.StatusPublished
                join o in db.Outlets on new { Id = c.OutletId, c.ExerciseId } equals new { o.Id, o.ExerciseId }
                select new { OutletSlug = o.Slug, c.Slug })
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : ContentPermalinks.Build(ChannelVocabulary.Weather, row.OutletSlug, row.Slug);
    }

    /// <summary>The zone slugs a stored weather payload references (<c>zoneSlugs</c> or <c>zoneSlug</c>).</summary>
    /// <param name="stored">The stored payload, or null.</param>
    /// <returns>The slugs.</returns>
    public static IReadOnlySet<string> StoredZoneSlugs(JsonObject? stored)
    {
        var slugs = new HashSet<string>(StringComparer.Ordinal);
        if (stored is null)
        {
            return slugs;
        }

        if (stored["zoneSlugs"] is JsonArray array)
        {
            foreach (var node in array)
            {
                if (node is JsonValue value && value.TryGetValue<string>(out var slug))
                {
                    slugs.Add(slug);
                }
            }
        }

        if (stored["zoneSlug"] is JsonValue single && single.TryGetValue<string>(out var one))
        {
            slugs.Add(one);
        }

        return slugs;
    }
}
