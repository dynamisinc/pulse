namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Channels.Contracts;

// STAFF-world wire shapes for /api/outlets* (channels-foundation story 03). They live here, not in Contracts/, because
// they are this slice's own: the participant shape is the frozen OutletDto. Explicit camelCase [JsonPropertyName] on
// every property, like the contract DTOs, so the wire is fixed whatever the serializer options.

/// <summary>
/// The staff view of one outlet: every <see cref="OutletDto"/> field plus the staff-only <c>logoMediaId</c>,
/// <c>enabled</c>, <c>sortOrder</c> and <c>version</c>. Returned by the staff list and every write; never served on a
/// participant route (XC-002).
/// </summary>
public sealed record OutletStaffDto
{
    /// <summary>The outlet id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The outlet's channel (immutable after create).</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The outlet slug, unique per exercise and channel.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The tagline, or null.</summary>
    [JsonPropertyName("tagline")]
    public string? Tagline { get; init; }

    /// <summary>The parent (press) outlet, or null.</summary>
    [JsonPropertyName("parentOutletId")]
    public string? ParentOutletId { get; init; }

    /// <summary>The paired persona, or null.</summary>
    [JsonPropertyName("pairedPersonaId")]
    public string? PairedPersonaId { get; init; }

    /// <summary>The signed logo, or null.</summary>
    [JsonPropertyName("logo")]
    public ContentMediaDto? Logo { get; init; }

    /// <summary>The section categories, in display order.</summary>
    [JsonPropertyName("categories")]
    public IReadOnlyList<string> Categories { get; init; } = [];

    /// <summary>The registered skin key.</summary>
    [JsonPropertyName("skinKey")]
    public required string SkinKey { get; init; }

    /// <summary>The validated partial <c>OutletSkinTokens</c>, or null.</summary>
    [JsonPropertyName("skinOverrides")]
    public JsonObject? SkinOverrides { get; init; }

    /// <summary>The host-relative home route (<c>/{channelId}/{slug}</c>).</summary>
    [JsonPropertyName("homeRoute")]
    public required string HomeRoute { get; init; }

    /// <summary>The logo's media asset id, or null (staff-only).</summary>
    [JsonPropertyName("logoMediaId")]
    public string? LogoMediaId { get; init; }

    /// <summary>Whether participants see the outlet (staff-only).</summary>
    [JsonPropertyName("enabled")]
    public required bool Enabled { get; init; }

    /// <summary>Display order within the channel (staff-only).</summary>
    [JsonPropertyName("sortOrder")]
    public required int SortOrder { get; init; }

    /// <summary>The optimistic-concurrency token a PUT or DELETE must echo (staff-only).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>
/// <c>POST /api/outlets</c> and <c>PUT /api/outlets/{id}</c> body. Every scalar is nullable so a missing field is a
/// readable validation 400, never a deserialization failure. There is deliberately no exercise id: scope comes only
/// from the resolved session (COR-001).
/// </summary>
/// <remarks>
/// A PUT replaces the outlet's fields: an omitted optional field (<c>tagline</c>, <c>parentOutletId</c>,
/// <c>pairedPersonaId</c>, <c>logoMediaId</c>, <c>categories</c>, <c>skinOverrides</c>) is cleared. Two fields keep
/// their current value when omitted on a PUT: <c>enabled</c> and <c>sortOrder</c> (on a create they default to
/// <c>true</c> and "after the last outlet of the channel"). <c>channelId</c> is set on create and immutable after.
/// </remarks>
public sealed record OutletWriteRequest
{
    /// <summary>The content channel (create only; a PUT may echo it but not change it).</summary>
    [JsonPropertyName("channelId")]
    public string? ChannelId { get; init; }

    /// <summary>The FC-1 slug.</summary>
    [JsonPropertyName("slug")]
    public string? Slug { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    /// <summary>The tagline.</summary>
    [JsonPropertyName("tagline")]
    public string? Tagline { get; init; }

    /// <summary>The parent press outlet's id.</summary>
    [JsonPropertyName("parentOutletId")]
    public string? ParentOutletId { get; init; }

    /// <summary>The paired persona's id.</summary>
    [JsonPropertyName("pairedPersonaId")]
    public string? PairedPersonaId { get; init; }

    /// <summary>The logo's media asset id (an image in this exercise).</summary>
    [JsonPropertyName("logoMediaId")]
    public string? LogoMediaId { get; init; }

    /// <summary>The section categories.</summary>
    [JsonPropertyName("categories")]
    public IReadOnlyList<string?>? Categories { get; init; }

    /// <summary>The registered skin key.</summary>
    [JsonPropertyName("skinKey")]
    public string? SkinKey { get; init; }

    /// <summary>A partial <c>OutletSkinTokens</c> (FC-3b), validated by <see cref="ISkinOverridesValidator"/>.</summary>
    [JsonPropertyName("skinOverrides")]
    public JsonNode? SkinOverrides { get; init; }

    /// <summary>Whether participants see the outlet.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; init; }

    /// <summary>Display order within the channel.</summary>
    [JsonPropertyName("sortOrder")]
    public int? SortOrder { get; init; }

    /// <summary>The version last read (required on a PUT).</summary>
    [JsonPropertyName("version")]
    public int? Version { get; init; }
}

/// <summary><c>POST /api/outlets/reorder</c> body: one channel's complete new order.</summary>
public sealed record OutletReorderRequest
{
    /// <summary>The content channel whose outlets are reordered.</summary>
    [JsonPropertyName("channelId")]
    public string? ChannelId { get; init; }

    /// <summary>Every non-deleted outlet of the channel, exactly once, in the new order.</summary>
    [JsonPropertyName("ids")]
    public IReadOnlyList<string?>? Ids { get; init; }
}

/// <summary><c>POST /api/outlets/defaults</c> body.</summary>
public sealed record OutletDefaultsRequest
{
    /// <summary>The content channel to add the default outlets to.</summary>
    [JsonPropertyName("channelId")]
    public string? ChannelId { get; init; }
}

/// <summary><c>POST /api/outlets/defaults</c> response.</summary>
public sealed record OutletDefaultsResultDto
{
    /// <summary>The outlets this call created (empty on a repeat call).</summary>
    [JsonPropertyName("created")]
    public required IReadOnlyList<OutletStaffDto> Created { get; init; }

    /// <summary>The catalog slugs that already existed in the exercise (live or deleted) and were left alone.</summary>
    [JsonPropertyName("skipped")]
    public required IReadOnlyList<string> Skipped { get; init; }

    /// <summary>The paired handles of created outlets that name no persona in this exercise (left unpaired).</summary>
    [JsonPropertyName("unresolvedHandles")]
    public required IReadOnlyList<string> UnresolvedHandles { get; init; }
}
