namespace Pulse.WebApi.Features.Portal.Contracts;

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Channels.Contracts;

// Staff-world PC-3 shapes (exercise-portal story 02, #768) for GET|PUT /api/portal/config and the
// /api/portal/resources* authoring routes (PC-4). Same conventions and golden-file parity as PortalDtos.cs.
// These carry `version` (optimistic concurrency) and are NEVER returned on a participant route; the
// participant projection is PortalDto / PortalResourceDto, which share no type with these.

/// <summary>One stored module setting: the full ordered list, disabled entries included.</summary>
public sealed record PortalModuleSettingDto
{
    /// <summary>The module id (<see cref="PortalVocabulary.ModuleIds"/>).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>Whether the planner wants it shown (it still needs its source channel enabled).</summary>
    [JsonPropertyName("enabled")]
    public required bool Enabled { get; init; }
}

/// <summary>Staff <c>GET /api/portal/config</c> (and the <c>PUT</c> response).</summary>
public sealed record PortalConfigStaffDto
{
    /// <summary>The stored portal name, or null (the default is resolved).</summary>
    [JsonPropertyName("portalName")]
    public string? PortalName { get; init; }

    /// <summary>The stored city name, or null.</summary>
    [JsonPropertyName("cityName")]
    public string? CityName { get; init; }

    /// <summary>The stored tagline, or null.</summary>
    [JsonPropertyName("tagline")]
    public string? Tagline { get; init; }

    /// <summary>The logo (FC-3 media), or null.</summary>
    [JsonPropertyName("logo")]
    public ContentMediaDto? Logo { get; init; }

    /// <summary>The layout (<see cref="PortalVocabulary.LayoutKeys"/>).</summary>
    [JsonPropertyName("layoutKey")]
    public required string LayoutKey { get; init; }

    /// <summary>The stored module order and toggles (every module id, disabled ones included).</summary>
    [JsonPropertyName("modules")]
    public IReadOnlyList<PortalModuleSettingDto> Modules { get; init; } = [];

    /// <summary>The stored partial <c>OutletSkinTokens</c> (FC-3b), or null.</summary>
    [JsonPropertyName("skinOverrides")]
    public JsonObject? SkinOverrides { get; init; }

    /// <summary>The masthead name participants see now (the default resolution applied), for the console read-out.</summary>
    [JsonPropertyName("resolvedName")]
    public required string ResolvedName { get; init; }

    /// <summary>The row version; <c>0</c> when no row exists yet (the first <c>PUT</c> creates it).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>Staff <c>PUT /api/portal/config</c> body. No exercise id: the scope is the session's.</summary>
public sealed record PortalConfigWriteRequest
{
    /// <summary>The portal name (≤ <see cref="PortalVocabulary.MastheadNameMaxLength"/>), or null for the default.</summary>
    [JsonPropertyName("portalName")]
    public string? PortalName { get; init; }

    /// <summary>The city name, or null.</summary>
    [JsonPropertyName("cityName")]
    public string? CityName { get; init; }

    /// <summary>The tagline, or null.</summary>
    [JsonPropertyName("tagline")]
    public string? Tagline { get; init; }

    /// <summary>An image media asset of this exercise, or null.</summary>
    [JsonPropertyName("logoMediaId")]
    public string? LogoMediaId { get; init; }

    /// <summary>The layout (<see cref="PortalVocabulary.LayoutKeys"/>).</summary>
    [JsonPropertyName("layoutKey")]
    public required string LayoutKey { get; init; }

    /// <summary>The ordered module settings (stored as <c>ModulesJson</c>, ≤ <see cref="PortalVocabulary.ModulesJsonMaxBytes"/>).</summary>
    [JsonPropertyName("modules")]
    public IReadOnlyList<PortalModuleSettingDto> Modules { get; init; } = [];

    /// <summary>A partial <c>OutletSkinTokens</c>, validated by <see cref="ISkinOverridesValidator"/>, or null.</summary>
    [JsonPropertyName("skinOverrides")]
    public JsonObject? SkinOverrides { get; init; }

    /// <summary>The version read; a stale value is a 409. <c>0</c> when creating the first row.</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>Staff <c>GET /api/portal/resources[/{id}]</c> row (hidden rows included; deleted rows excluded).</summary>
public sealed record PortalResourceStaffDto
{
    /// <summary>The resource id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The title.</summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The summary, or null.</summary>
    [JsonPropertyName("summary")]
    public string? Summary { get; init; }

    /// <summary>The sanitized body, or null.</summary>
    [JsonPropertyName("bodyHtml")]
    public string? BodyHtml { get; init; }

    /// <summary>The attached media (FC-3), or null.</summary>
    [JsonPropertyName("media")]
    public ContentMediaDto? Media { get; init; }

    /// <summary>The shelf position (ascending).</summary>
    [JsonPropertyName("sortOrder")]
    public required int SortOrder { get; init; }

    /// <summary>Whether participants see it.</summary>
    [JsonPropertyName("visible")]
    public required bool Visible { get; init; }

    /// <summary>The row version (optimistic concurrency).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>Staff <c>POST /api/portal/resources</c> and <c>PUT /api/portal/resources/{id}</c> body.</summary>
public sealed record PortalResourceWriteRequest
{
    /// <summary>The title (≤ <see cref="PortalVocabulary.ResourceTitleMaxLength"/>).</summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The summary (≤ <see cref="PortalVocabulary.ResourceSummaryMaxLength"/>), or null.</summary>
    [JsonPropertyName("summary")]
    public string? Summary { get; init; }

    /// <summary>The raw body; sanitized once server-side with the F04 rich-body profile. Or null.</summary>
    [JsonPropertyName("bodyHtml")]
    public string? BodyHtml { get; init; }

    /// <summary>An image (or, behind story 04's flag, document) media asset of this exercise, or null.</summary>
    [JsonPropertyName("mediaAssetId")]
    public string? MediaAssetId { get; init; }

    /// <summary>Whether participants see it.</summary>
    [JsonPropertyName("visible")]
    public required bool Visible { get; init; }

    /// <summary>The version read (send <c>0</c> on create, where it is ignored; a stale value on update is a 409).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>Staff <c>POST /api/portal/resources/reorder</c> body: the new shelf order.</summary>
public sealed record PortalResourceReorderRequest
{
    /// <summary>Every non-deleted resource id of the exercise, exactly once, in the new order.</summary>
    [JsonPropertyName("orderedIds")]
    public IReadOnlyList<string> OrderedIds { get; init; } = [];
}
