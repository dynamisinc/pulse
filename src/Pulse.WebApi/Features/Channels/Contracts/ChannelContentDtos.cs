namespace Pulse.WebApi.Features.Channels.Contracts;

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

// FROZEN FC-3 wire shapes (channels-foundation story 02, #698). Each record mirrors its TS twin in
// src/frontend/src/features/channels/contract/types.ts field for field; the camelCase key set of every
// type is pinned in contract/wireContract.json, which ChannelContractParityTests (C#) and
// wireContract.test.ts (TS) both read, so a one-sided drift fails a build.
//
// Conventions (the ParticipantShellDtos.cs / ParticipantPostDto pattern):
// - every key is an explicit [JsonPropertyName], so the wire key never depends on which serializer options
//   (REST, SignalR hub protocol) carry the frame;
// - enum-like fields are string-typed wire literals from ChannelVocabulary, never C# enums;
// - ids are strings (Guid "D" format) and every instant is a SCENARIO-time ISO string (COR-053);
// - nullable members serialize as an explicit null (FC-3 shows them as "…|null"), never omitted;
// - every type is SEALED and none derives from another. A participant DTO can therefore never be handed
//   a staff instance whose runtime type serializes extra members (the SignalR JSON protocol serializes an
//   argument's runtime type), and the summary can never carry a body.
//
// XC-002: the participant DTOs (OutletRefDto, OutletDto, ContentMediaDto, ContentBylineDto,
// ContentRevisionDto, ChannelContentSummaryDto, ChannelContentDto, ChannelContentTombstoneDto,
// ChannelContentListDto) carry NO origin, actingHumanId, wall clock, status, background, featuredRank,
// version, injectId or externalRef; a reflection test enforces it. Those live only on
// ChannelContentStaffDto and ContentWriteRequest.

/// <summary>The outlet reference embedded in every content DTO.</summary>
public sealed record OutletRefDto
{
    /// <summary>The outlet id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The outlet's channel (<see cref="ChannelVocabulary.ChannelIds"/>).</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The outlet slug, unique per exercise and channel.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The publishing brand's display name (a press release's is the publishing org, R-P1).</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The registered skin key the outlet's scope mounts.</summary>
    [JsonPropertyName("skinKey")]
    public required string SkinKey { get; init; }
}

/// <summary><c>GET /api/outlets</c> entry: the outlet registry row a participant may read.</summary>
public sealed record OutletDto
{
    /// <summary>The outlet id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The outlet's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The outlet slug.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The outlet display name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The outlet tagline, or null.</summary>
    [JsonPropertyName("tagline")]
    public string? Tagline { get; init; }

    /// <summary>The parent outlet (press org newsrooms are children of The Wire Room), or null.</summary>
    [JsonPropertyName("parentOutletId")]
    public string? ParentOutletId { get; init; }

    /// <summary>The paired E2 persona (NWS-004 / PRS-013 / WX-020), or null.</summary>
    [JsonPropertyName("pairedPersonaId")]
    public string? PairedPersonaId { get; init; }

    /// <summary>The outlet logo, or null.</summary>
    [JsonPropertyName("logo")]
    public ContentMediaDto? Logo { get; init; }

    /// <summary>The outlet's section categories, in display order.</summary>
    [JsonPropertyName("categories")]
    public IReadOnlyList<string> Categories { get; init; } = [];

    /// <summary>The registered skin key.</summary>
    [JsonPropertyName("skinKey")]
    public required string SkinKey { get; init; }

    /// <summary>
    /// A partial <c>OutletSkinTokens</c> (FC-3b), or null. Opaque here: validated server-side by
    /// <see cref="ISkinOverridesValidator"/>; the token type itself is story 13's.
    /// </summary>
    [JsonPropertyName("skinOverrides")]
    public JsonObject? SkinOverrides { get; init; }

    /// <summary>The outlet's host-relative home route (e.g. <c>/news/newsline-7</c>; FC-9.3).</summary>
    [JsonPropertyName("homeRoute")]
    public required string HomeRoute { get; init; }
}

/// <summary>
/// One media item on a content DTO. Reuses the existing media URL signing and dimensions; the EXERCISE
/// bands are drawn client-side (<c>ExerciseBands</c>), never baked in.
/// </summary>
public sealed record ContentMediaDto
{
    /// <summary>The media asset id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The media kind (<see cref="ChannelVocabulary.ContentMediaKinds"/>).</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The media role (<see cref="ChannelVocabulary.MediaRoles"/>).</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>The signed, host-relative media URL.</summary>
    [JsonPropertyName("url")]
    public required string Url { get; init; }

    /// <summary>The signed poster URL (video), or null.</summary>
    [JsonPropertyName("posterUrl")]
    public string? PosterUrl { get; init; }

    /// <summary>The sniffed content type (e.g. <c>image/jpeg</c>).</summary>
    [JsonPropertyName("contentType")]
    public required string ContentType { get; init; }

    /// <summary>The pixel width, or null (documents).</summary>
    [JsonPropertyName("width")]
    public int? Width { get; init; }

    /// <summary>The pixel height, or null (documents).</summary>
    [JsonPropertyName("height")]
    public int? Height { get; init; }

    /// <summary>The duration in seconds (video), or null.</summary>
    [JsonPropertyName("durationSec")]
    public double? DurationSec { get; init; }

    /// <summary>The alt text. Empty only for decorative media.</summary>
    [JsonPropertyName("alt")]
    public required string Alt { get; init; }

    /// <summary>The caption, or null.</summary>
    [JsonPropertyName("caption")]
    public string? Caption { get; init; }
}

/// <summary>The byline on a content item.</summary>
public sealed record ContentBylineDto
{
    /// <summary>The byline name as printed (e.g. <c>Staff</c>).</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The byline's persona, or null.</summary>
    [JsonPropertyName("personaId")]
    public string? PersonaId { get; init; }
}

/// <summary>
/// One revision entry. On a participant DTO only <c>update</c> / <c>correction</c> appear; the staff
/// <c>revisionLog</c> carries every kind, including <c>edit</c> and <c>silent_rewrite</c>.
/// </summary>
public sealed record ContentRevisionDto
{
    /// <summary>The revision number (1-based, per item).</summary>
    [JsonPropertyName("number")]
    public required int Number { get; init; }

    /// <summary>The revision kind (<see cref="ChannelVocabulary.RevisionKinds"/>).</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The scenario-time instant of the revision.</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }

    /// <summary>The editor's note, or null.</summary>
    [JsonPropertyName("note")]
    public string? Note { get; init; }
}

/// <summary>
/// A list row and the <c>ContentPublished</c> frame payload: no body. <c>updatedScenarioTime</c> follows
/// FC-1's Updated stamp rule (moved by <c>update</c> / <c>correction</c> / <c>silent_rewrite</c>).
/// </summary>
public sealed record ChannelContentSummaryDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The item's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The item's kind (<see cref="ChannelVocabulary.ContentKinds"/>).</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The publishing outlet.</summary>
    [JsonPropertyName("outlet")]
    public required OutletRefDto Outlet { get; init; }

    /// <summary>The content slug.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The host-relative permalink <c>/{channelId}/{outletSlug}/{contentSlug}</c> (FC-9.3).</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }

    /// <summary>
    /// Always <c>published</c> on a summary: lists and pushes never carry a retracted row. Get-only, so no mapper can
    /// put a draft or scheduled state on a participant DTO (XC-002).
    /// </summary>
    [JsonPropertyName("state")]
    public string State => ChannelVocabulary.StatusPublished;

    /// <summary>The headline.</summary>
    [JsonPropertyName("headline")]
    public required string Headline { get; init; }

    /// <summary>The dek, or null. A kind may derive a non-empty dek (R-P1).</summary>
    [JsonPropertyName("dek")]
    public string? Dek { get; init; }

    /// <summary>The kicker, or null.</summary>
    [JsonPropertyName("kicker")]
    public string? Kicker { get; init; }

    /// <summary>The category, or null.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; init; }

    /// <summary>The hero media, or null.</summary>
    [JsonPropertyName("hero")]
    public ContentMediaDto? Hero { get; init; }

    /// <summary>The scenario-time publish instant.</summary>
    [JsonPropertyName("publishedScenarioTime")]
    public required string PublishedScenarioTime { get; init; }

    /// <summary>The Updated stamp, or null.</summary>
    [JsonPropertyName("updatedScenarioTime")]
    public string? UpdatedScenarioTime { get; init; }

    /// <summary>Whether the item is featured (PRT-004). The rank itself is staff-only.</summary>
    [JsonPropertyName("featured")]
    public bool Featured { get; init; }
}

/// <summary>
/// The permalink read of a PUBLISHED item: every summary field plus the body. Flat by design (see the file
/// header); a retracted item is a <see cref="ChannelContentTombstoneDto"/> instead.
/// </summary>
public sealed record ChannelContentDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The item's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The item's kind.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The publishing outlet.</summary>
    [JsonPropertyName("outlet")]
    public required OutletRefDto Outlet { get; init; }

    /// <summary>The content slug.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The host-relative permalink.</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }

    /// <summary>Always <c>published</c> on this shape (get-only, XC-002).</summary>
    [JsonPropertyName("state")]
    public string State => ChannelVocabulary.StatusPublished;

    /// <summary>The headline.</summary>
    [JsonPropertyName("headline")]
    public required string Headline { get; init; }

    /// <summary>The dek, or null.</summary>
    [JsonPropertyName("dek")]
    public string? Dek { get; init; }

    /// <summary>The kicker, or null.</summary>
    [JsonPropertyName("kicker")]
    public string? Kicker { get; init; }

    /// <summary>The category, or null.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; init; }

    /// <summary>The hero media, or null.</summary>
    [JsonPropertyName("hero")]
    public ContentMediaDto? Hero { get; init; }

    /// <summary>The scenario-time publish instant.</summary>
    [JsonPropertyName("publishedScenarioTime")]
    public required string PublishedScenarioTime { get; init; }

    /// <summary>The Updated stamp, or null.</summary>
    [JsonPropertyName("updatedScenarioTime")]
    public string? UpdatedScenarioTime { get; init; }

    /// <summary>Whether the item is featured.</summary>
    [JsonPropertyName("featured")]
    public bool Featured { get; init; }

    /// <summary>The byline, or null.</summary>
    [JsonPropertyName("byline")]
    public ContentBylineDto? Byline { get; init; }

    /// <summary>The body, sanitized once at write by the kind's <c>BodyPolicy</c> (NFR-004).</summary>
    [JsonPropertyName("bodyHtml")]
    public required string BodyHtml { get; init; }

    /// <summary>The non-hero media, in display order.</summary>
    [JsonPropertyName("media")]
    public IReadOnlyList<ContentMediaDto> Media { get; init; } = [];

    /// <summary>
    /// The participant-visible revisions: <c>update</c> / <c>correction</c> ONLY. The projector filters with
    /// <see cref="ChannelVocabulary.ParticipantRevisionKinds"/>; an <c>edit</c> or <c>silent_rewrite</c> here fails the
    /// client guard and blanks the read.
    /// </summary>
    [JsonPropertyName("revisions")]
    public IReadOnlyList<ContentRevisionDto> Revisions { get; init; } = [];

    /// <summary>The paired Social post, or null.</summary>
    [JsonPropertyName("pairedPostId")]
    public string? PairedPostId { get; init; }

    /// <summary>The alert this item raised, or null.</summary>
    [JsonPropertyName("alertId")]
    public string? AlertId { get; init; }

    /// <summary>The kind's participant-safe payload projection (<c>IContentKindDescriptor.ProjectPayload</c>).</summary>
    [JsonPropertyName("payload")]
    public JsonObject Payload { get; init; } = [];
}

/// <summary>
/// The permalink read of a RETRACTED item (XC-010 tombstone): identity and the retraction instant only.
/// Structurally carries no headline, body, media or payload.
/// </summary>
public sealed record ChannelContentTombstoneDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The item's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The item's kind.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The publishing outlet (the tombstone renders in its skin).</summary>
    [JsonPropertyName("outlet")]
    public required OutletRefDto Outlet { get; init; }

    /// <summary>The content slug.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The host-relative permalink.</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }

    /// <summary>Always <c>retracted</c> on this shape (get-only).</summary>
    [JsonPropertyName("state")]
    public string State => ChannelVocabulary.StatusRetracted;

    /// <summary>The scenario-time retraction instant.</summary>
    [JsonPropertyName("retractedScenarioTime")]
    public required string RetractedScenarioTime { get; init; }
}

/// <summary><c>GET /api/channels/{channelId}/content</c> body.</summary>
public sealed record ChannelContentListDto
{
    /// <summary>The published rows, newest first (or featured order).</summary>
    [JsonPropertyName("items")]
    public IReadOnlyList<ChannelContentSummaryDto> Items { get; init; } = [];

    /// <summary>The opaque cursor for the next page, or null at the end.</summary>
    [JsonPropertyName("nextCursor")]
    public string? NextCursor { get; init; }
}

/// <summary>
/// The STAFF read of a content item in any status: every summary and content field plus the staff-only
/// provenance. Staff world only; never projected to a participant, never broadcast on the exercise group.
/// Not derived from the participant shapes (see the file header).
/// </summary>
public sealed record ChannelContentStaffDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The item's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The item's kind.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The publishing outlet.</summary>
    [JsonPropertyName("outlet")]
    public required OutletRefDto Outlet { get; init; }

    /// <summary>The content slug.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The host-relative permalink (stable once first published).</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }

    /// <summary>
    /// The participant <c>state</c> the item would project as: <c>published</c> or <c>retracted</c>, or
    /// null while it is a draft or scheduled (it has no participant projection yet).
    /// </summary>
    [JsonPropertyName("state")]
    public string? State { get; init; }

    /// <summary>The headline.</summary>
    [JsonPropertyName("headline")]
    public required string Headline { get; init; }

    /// <summary>The dek, or null.</summary>
    [JsonPropertyName("dek")]
    public string? Dek { get; init; }

    /// <summary>The kicker, or null.</summary>
    [JsonPropertyName("kicker")]
    public string? Kicker { get; init; }

    /// <summary>The category, or null.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; init; }

    /// <summary>The hero media, or null.</summary>
    [JsonPropertyName("hero")]
    public ContentMediaDto? Hero { get; init; }

    /// <summary>The scenario-time publish instant, or null if never published.</summary>
    [JsonPropertyName("publishedScenarioTime")]
    public string? PublishedScenarioTime { get; init; }

    /// <summary>The Updated stamp, or null.</summary>
    [JsonPropertyName("updatedScenarioTime")]
    public string? UpdatedScenarioTime { get; init; }

    /// <summary>Whether the item is featured.</summary>
    [JsonPropertyName("featured")]
    public bool Featured { get; init; }

    /// <summary>The byline, or null.</summary>
    [JsonPropertyName("byline")]
    public ContentBylineDto? Byline { get; init; }

    /// <summary>The sanitized body.</summary>
    [JsonPropertyName("bodyHtml")]
    public required string BodyHtml { get; init; }

    /// <summary>The non-hero media.</summary>
    [JsonPropertyName("media")]
    public IReadOnlyList<ContentMediaDto> Media { get; init; } = [];

    /// <summary>The participant-visible revisions, as a participant would see them.</summary>
    [JsonPropertyName("revisions")]
    public IReadOnlyList<ContentRevisionDto> Revisions { get; init; } = [];

    /// <summary>The paired Social post, or null.</summary>
    [JsonPropertyName("pairedPostId")]
    public string? PairedPostId { get; init; }

    /// <summary>The raised alert, or null.</summary>
    [JsonPropertyName("alertId")]
    public string? AlertId { get; init; }

    /// <summary>The participant-safe payload projection (what preview-as-participant renders).</summary>
    [JsonPropertyName("payload")]
    public JsonObject Payload { get; init; } = [];

    /// <summary>The lifecycle status (<see cref="ChannelVocabulary.ContentStatuses"/>). Staff-only.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The provenance (<see cref="ChannelVocabulary.ContentOrigins"/>). Staff-only.</summary>
    [JsonPropertyName("origin")]
    public required string Origin { get; init; }

    /// <summary>The acting human behind the last state change. Staff-only.</summary>
    [JsonPropertyName("actingHumanId")]
    public required string ActingHumanId { get; init; }

    /// <summary>The scheduled scenario instant, or null.</summary>
    [JsonPropertyName("scheduledScenarioTime")]
    public string? ScheduledScenarioTime { get; init; }

    /// <summary>The wall-clock publish instant, or null. Staff-only; never shown in-fiction.</summary>
    [JsonPropertyName("publishedWallClock")]
    public string? PublishedWallClock { get; init; }

    /// <summary>Whether the item is evergreen portal filler (PRT-031). Staff-only.</summary>
    [JsonPropertyName("background")]
    public bool Background { get; init; }

    /// <summary>The featured rank (PRT-004), or null. Staff-only.</summary>
    [JsonPropertyName("featuredRank")]
    public int? FeaturedRank { get; init; }

    /// <summary>The firing inject, or null. Staff-only.</summary>
    [JsonPropertyName("injectId")]
    public string? InjectId { get; init; }

    /// <summary>The external system (the Cadence seam, PDF-06), or null. Staff-only.</summary>
    [JsonPropertyName("externalSource")]
    public string? ExternalSource { get; init; }

    /// <summary>The external system's id, or null. Staff-only.</summary>
    [JsonPropertyName("externalRef")]
    public string? ExternalRef { get; init; }

    /// <summary>The revision count. Staff-only.</summary>
    [JsonPropertyName("revisionCount")]
    public int RevisionCount { get; init; }

    /// <summary>Every revision, of every kind (including <c>edit</c> and <c>silent_rewrite</c>). Staff-only.</summary>
    [JsonPropertyName("revisionLog")]
    public IReadOnlyList<ContentRevisionDto> RevisionLog { get; init; } = [];

    /// <summary>The concurrency token; a stale <c>version</c> on a write is a 409. Staff-only.</summary>
    [JsonPropertyName("version")]
    public int Version { get; init; }
}

/// <summary>One media attachment on a <see cref="ContentWriteRequest"/>.</summary>
public sealed record ContentMediaWriteRequest
{
    /// <summary>An in-scope media library asset id.</summary>
    [JsonPropertyName("mediaId")]
    public string MediaId { get; init; } = string.Empty;

    /// <summary>The media role (<see cref="ChannelVocabulary.MediaRoles"/>).</summary>
    [JsonPropertyName("role")]
    public string Role { get; init; } = ChannelVocabulary.MediaRoleInline;

    /// <summary>The alt text, or null.</summary>
    [JsonPropertyName("alt")]
    public string? Alt { get; init; }
}

/// <summary>
/// <c>POST</c> / <c>PUT /api/content-items</c> body (staff world). <c>PUT</c> carries <see cref="Version"/>;
/// a stale version is a 409. Binding is lenient (an explicit JSON <c>null</c> for <see cref="Payload"/> or
/// <see cref="Media"/> binds null despite the annotation), so the endpoint validates nulls into a 400.
/// <c>origin</c> and <c>actingHumanId</c> are deliberately ABSENT: they come from
/// the caller's authenticated session, never a request body (FC-7).
/// </summary>
public sealed record ContentWriteRequest
{
    /// <summary>The content kind.</summary>
    [JsonPropertyName("kind")]
    public string Kind { get; init; } = string.Empty;

    /// <summary>The publishing outlet (in scope).</summary>
    [JsonPropertyName("outletId")]
    public string OutletId { get; init; } = string.Empty;

    /// <summary>The headline.</summary>
    [JsonPropertyName("headline")]
    public string Headline { get; init; } = string.Empty;

    /// <summary>The dek, or null.</summary>
    [JsonPropertyName("dek")]
    public string? Dek { get; init; }

    /// <summary>The kicker, or null.</summary>
    [JsonPropertyName("kicker")]
    public string? Kicker { get; init; }

    /// <summary>The category, or null.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; init; }

    /// <summary>The byline name, or null.</summary>
    [JsonPropertyName("bylineName")]
    public string? BylineName { get; init; }

    /// <summary>The byline persona, or null.</summary>
    [JsonPropertyName("bylinePersonaId")]
    public string? BylinePersonaId { get; init; }

    /// <summary>The body: UNTRUSTED, sanitized server-side by the kind's <c>BodyPolicy</c>.</summary>
    [JsonPropertyName("bodyHtml")]
    public string BodyHtml { get; init; } = string.Empty;

    /// <summary>The hero media asset, or null.</summary>
    [JsonPropertyName("heroMediaId")]
    public string? HeroMediaId { get; init; }

    /// <summary>The non-hero media attachments.</summary>
    [JsonPropertyName("media")]
    public IReadOnlyList<ContentMediaWriteRequest> Media { get; init; } = [];

    /// <summary>The kind-specific payload, validated by the kind's <c>ValidatePayloadAsync</c>.</summary>
    [JsonPropertyName("payload")]
    public JsonObject Payload { get; init; } = [];

    /// <summary>Whether the item is evergreen portal filler.</summary>
    [JsonPropertyName("background")]
    public bool Background { get; init; }

    /// <summary>The featured rank, or null.</summary>
    [JsonPropertyName("featuredRank")]
    public int? FeaturedRank { get; init; }

    /// <summary>The scheduled scenario instant, or null.</summary>
    [JsonPropertyName("scheduledScenarioTime")]
    public string? ScheduledScenarioTime { get; init; }

    /// <summary>The external system, or null.</summary>
    [JsonPropertyName("externalSource")]
    public string? ExternalSource { get; init; }

    /// <summary>The external id, or null. Unique per exercise when set.</summary>
    [JsonPropertyName("externalRef")]
    public string? ExternalRef { get; init; }

    /// <summary>
    /// The concurrency token the client last read (0 on create). An omitted key also reads as 0, so the PUT endpoint
    /// (story 07) treats 0 against an existing item as stale (409), never as a first write.
    /// </summary>
    [JsonPropertyName("version")]
    public int Version { get; init; }
}
