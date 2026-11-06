namespace Pulse.WebApi.Features.Weather.Zones;

using System.Text.Json.Serialization;

// Wire shapes for /api/weather/zones* (weather-source story 02, WX-004). Explicit camelCase [JsonPropertyName] on every
// property, like the outlet and contract DTOs, so the wire is fixed whatever the serializer options.

/// <summary>
/// The PARTICIPANT view of one zone (XC-002): exactly <c>{ slug, name, kind, isDefault }</c>. Never the id, the exercise,
/// the order, the version, the description or any clock.
/// </summary>
public sealed record WeatherZoneDto
{
    /// <summary>The FC-1 zone slug, unique per exercise.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The zone kind: <c>county</c> / <c>city</c> / <c>region</c> / <c>custom</c>.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>Whether this is the site's initial selection and the widget's zone (exactly one per list).</summary>
    [JsonPropertyName("isDefault")]
    public required bool IsDefault { get; init; }
}

/// <summary>The STAFF view of one zone: the participant fields plus id, description, order and version.</summary>
public sealed record WeatherZoneStaffDto
{
    /// <summary>The zone id (the PUT / DELETE route key).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The FC-1 slug (immutable after create).</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The zone kind.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The staff description, or null.</summary>
    [JsonPropertyName("description")]
    public string? Description { get; init; }

    /// <summary>Display order.</summary>
    [JsonPropertyName("sortOrder")]
    public required int SortOrder { get; init; }

    /// <summary>Whether this is the exercise's default zone.</summary>
    [JsonPropertyName("isDefault")]
    public required bool IsDefault { get; init; }

    /// <summary>The optimistic-concurrency token a PUT or DELETE must echo.</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>
/// <c>GET /api/weather/zones/staff</c>: the live zones plus the authoring state, so the editor can prompt "add a zone
/// first" instead of discovering the <c>no_zones</c> validation error on save.
/// </summary>
public sealed record WeatherZoneStaffListDto
{
    /// <summary>
    /// The value of <see cref="AuthoringBlockedReason"/> when the exercise has no live zone: the same code story 01's
    /// validators return for a weather product or forecast written before any zone exists.
    /// </summary>
    public const string NoZones = "no_zones";

    /// <summary>The live zones, in display order.</summary>
    [JsonPropertyName("zones")]
    public required IReadOnlyList<WeatherZoneStaffDto> Zones { get; init; }

    /// <summary>Whether a weather product or forecast can be authored (at least one live zone).</summary>
    [JsonPropertyName("canAuthor")]
    public required bool CanAuthor { get; init; }

    /// <summary><see cref="NoZones"/> when <see cref="CanAuthor"/> is false; otherwise null.</summary>
    [JsonPropertyName("authoringBlockedReason")]
    public string? AuthoringBlockedReason { get; init; }
}

/// <summary>
/// The untrusted body of <c>POST /api/weather/zones</c> and <c>PUT /api/weather/zones/{id}</c>. On a PUT every field is
/// replaced except <c>slug</c> (immutable; it may be echoed unchanged), <c>sortOrder</c> and <c>isDefault</c> (null =
/// keep), and <c>version</c> is required.
/// </summary>
public sealed record WeatherZoneWriteRequest
{
    /// <summary>The FC-1 slug (create; immutable afterwards).</summary>
    [JsonPropertyName("slug")]
    public string? Slug { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    /// <summary>The zone kind.</summary>
    [JsonPropertyName("kind")]
    public string? Kind { get; init; }

    /// <summary>The optional staff description.</summary>
    [JsonPropertyName("description")]
    public string? Description { get; init; }

    /// <summary>The display order (create: null = last; edit: null = keep).</summary>
    [JsonPropertyName("sortOrder")]
    public int? SortOrder { get; init; }

    /// <summary>
    /// <c>true</c> makes this the default (the previous default is cleared). <c>false</c> on the current default is refused:
    /// there is always exactly one, so make another zone the default instead. Null = keep (the first zone is the default).
    /// </summary>
    [JsonPropertyName("isDefault")]
    public bool? IsDefault { get; init; }

    /// <summary>The version the caller last read (required on a PUT).</summary>
    [JsonPropertyName("version")]
    public int? Version { get; init; }
}
