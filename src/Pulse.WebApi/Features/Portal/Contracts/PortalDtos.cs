namespace Pulse.WebApi.Features.Portal.Contracts;

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Channels.Contracts;

// FROZEN PC-3 participant wire shapes (exercise-portal story 02, #768). Each record mirrors its TS twin in
// src/frontend/src/features/portal/contract/types.ts field for field; the camelCase key set of every type is
// pinned in contract/portalWireContract.json, which PortalContractParityTests (C#) and portalWireContract.test.ts
// (TS) both read, so a one-sided drift fails a build.
//
// Same conventions as the FC-3 records (ChannelContentDtos.cs): explicit [JsonPropertyName] on every key,
// string wire literals from PortalVocabulary, string ids, nullable members serialized as an explicit null,
// every type SEALED and deriving from nothing. Media is the FC-3 ContentMediaDto, imported, never copied.
//
// XC-002: these DTOs carry NO token, hash, version, actingHumanId, lastSeen, wall clock or exerciseId; a
// reflection test enforces it over the whole participant graph. FC-9.3: every URL is host-relative.
//
// DisplayStateDto and DisplayStaffDto are Deferred post-December (Q-35, Tom 10/29) and deliberately absent.

/// <summary><c>GET /api/portal</c>: the participant's portal composition (behind <c>RequireChannelEnabled('portal')</c>).</summary>
public sealed record PortalDto
{
    /// <summary>The resolved masthead (story 03 resolves the default name).</summary>
    [JsonPropertyName("masthead")]
    public required PortalMastheadDto Masthead { get; init; }

    /// <summary>The layout (<see cref="PortalVocabulary.LayoutKeys"/>).</summary>
    [JsonPropertyName("layoutKey")]
    public required string LayoutKey { get; init; }

    /// <summary>The ordered modules that are enabled in config AND whose source channel is enabled; nothing else.</summary>
    [JsonPropertyName("modules")]
    public IReadOnlyList<PortalModuleDto> Modules { get; init; } = [];

    /// <summary>
    /// A partial <c>OutletSkinTokens</c> (FC-3b), or null. Opaque here: validated server-side by
    /// <see cref="ISkinOverridesValidator"/> before it is stored.
    /// </summary>
    [JsonPropertyName("skinOverrides")]
    public JsonObject? SkinOverrides { get; init; }

    /// <summary>Whether at least one visible resource exists (drives the Resources link; no count, no ids).</summary>
    [JsonPropertyName("hasResources")]
    public required bool HasResources { get; init; }
}

/// <summary>The portal masthead a participant sees.</summary>
public sealed record PortalMastheadDto
{
    /// <summary>The resolved name: <c>PortalName</c>, else <c>"{CityName} Today"</c>, else <c>"Local Today"</c>.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The tagline, or null.</summary>
    [JsonPropertyName("tagline")]
    public string? Tagline { get; init; }

    /// <summary>The logo (FC-3 media), or null.</summary>
    [JsonPropertyName("logo")]
    public ContentMediaDto? Logo { get; init; }
}

/// <summary>One module entry in <see cref="PortalDto.Modules"/>.</summary>
public sealed record PortalModuleDto
{
    /// <summary>The module id (<see cref="PortalVocabulary.ModuleIds"/>).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The module's source channel; always <see cref="PortalVocabulary.ModuleChannelIds"/>[<see cref="Id"/>].</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }
}

/// <summary>
/// <c>GET /api/portal/resources</c> (an array, in <c>SortOrder</c>) and <c>GET /api/portal/resources/{id}</c>:
/// a visible, non-deleted resource of the caller's exercise.
/// </summary>
public sealed record PortalResourceDto
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

    /// <summary>The body, sanitized once at write with the F04 rich-body profile, or null.</summary>
    [JsonPropertyName("bodyHtml")]
    public string? BodyHtml { get; init; }

    /// <summary>The attached media (FC-3), or null.</summary>
    [JsonPropertyName("media")]
    public ContentMediaDto? Media { get; init; }
}
