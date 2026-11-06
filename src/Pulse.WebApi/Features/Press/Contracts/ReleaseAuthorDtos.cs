namespace Pulse.WebApi.Features.Press.Contracts;

using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Channels.Contracts;

// FROZEN PC-2 author wire shapes (press-room story 01, #738). Participant world, but AUTHOR-only: served by story 04's
// /api/press/* routes to the humans who may release as the org, never on a public read (those reuse F06). Mirrors
// src/frontend/src/features/press/contract/types.ts, pinned by contract/pressWireContract.json.
//
// The author view is a superset of ChannelContentDto minus staff fields: no origin, actingHumanId, wall clock,
// exerciseId or injectId. It does carry `version` (the optimistic-concurrency token a PUT echoes back).

/// <summary><c>GET /api/press/orgs</c>: one organization the signed-in human may release as (PRS-001, COR-018).</summary>
public sealed record ReleaseOrgDto
{
    /// <summary>The organization persona id.</summary>
    [JsonPropertyName("personaId")]
    public required string PersonaId { get; init; }

    /// <summary>The org newsroom outlet id (provisioned by <c>OrgNewsroomProvisioner</c>).</summary>
    [JsonPropertyName("outletId")]
    public required string OutletId { get; init; }

    /// <summary>The organization's name (the newsroom outlet's name).</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The persona's handle, with its leading <c>@</c>.</summary>
    [JsonPropertyName("handle")]
    public required string Handle { get; init; }

    /// <summary>The handle of the Social persona a cross-post goes out as, or null when the newsroom has none.</summary>
    [JsonPropertyName("pairedHandle")]
    public string? PairedHandle { get; init; }

    /// <summary>The org's letterhead defaults (neutral when none are configured).</summary>
    [JsonPropertyName("letterhead")]
    public required ReleaseLetterheadDto Letterhead { get; init; }

    /// <summary>Whether a release from this org needs approval before it publishes (story 06; false by default).</summary>
    [JsonPropertyName("approvalRequired")]
    public required bool ApprovalRequired { get; init; }
}

/// <summary>
/// An org's letterhead defaults: the newsroom logo, plus the address and default contact read from the outlet's
/// <c>ext.press</c> letterhead keys. An org without them gets a NEUTRAL letterhead (nulls), never a platform-branded one.
/// </summary>
public sealed record ReleaseLetterheadDto
{
    /// <summary>The org logo (the newsroom's <c>LogoMediaId</c>), or null.</summary>
    [JsonPropertyName("logo")]
    public ContentMediaDto? Logo { get; init; }

    /// <summary>The org's mailing address, or null.</summary>
    [JsonPropertyName("address")]
    public string? Address { get; init; }

    /// <summary>The default press contact the composer pre-fills, or null.</summary>
    [JsonPropertyName("defaultContact")]
    public ReleaseContactDto? DefaultContact { get; init; }
}

/// <summary>Who last edited a release (display name only, own org only; Q-E5-4).</summary>
public sealed record ReleaseLastEditedByDto
{
    /// <summary>The editor's display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }
}

/// <summary>The approver's return note on a <c>returned</c> release (story 06).</summary>
public sealed record ReleaseReturnNoteDto
{
    /// <summary>The note text (non-empty).</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>The approver's display name.</summary>
    [JsonPropertyName("byDisplayName")]
    public required string ByDisplayName { get; init; }

    /// <summary>When the release was returned, in scenario time (ISO-8601 with offset).</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }
}

/// <summary>The author/org-mate view of one release (story 04: <c>GET /api/press/releases[/{id}]</c>).</summary>
public sealed record ReleaseAuthorDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The organization persona the release is issued as.</summary>
    [JsonPropertyName("orgPersonaId")]
    public required string OrgPersonaId { get; init; }

    /// <summary>The E5 state (<see cref="PressVocabulary.ReleaseStates"/>).</summary>
    [JsonPropertyName("state")]
    public required string State { get; init; }

    /// <summary>The headline (the only field required at publish, D4-001).</summary>
    [JsonPropertyName("headline")]
    public required string Headline { get; init; }

    /// <summary>The sanitized rich body (F04 <c>rich-tables</c>), possibly empty.</summary>
    [JsonPropertyName("bodyHtml")]
    public required string BodyHtml { get; init; }

    /// <summary>The author projection of the payload.</summary>
    [JsonPropertyName("payload")]
    public required ReleaseAuthorPayloadDto Payload { get; init; }

    /// <summary>The attached media, in order.</summary>
    [JsonPropertyName("media")]
    public IReadOnlyList<ContentMediaDto> Media { get; init; } = [];

    /// <summary>The embargo time while <c>scheduled</c>, else null (scenario time).</summary>
    [JsonPropertyName("scheduledScenarioTime")]
    public string? ScheduledScenarioTime { get; init; }

    /// <summary>The last visible update (scenario time), or null.</summary>
    [JsonPropertyName("updatedScenarioTime")]
    public string? UpdatedScenarioTime { get; init; }

    /// <summary>Who last edited the draft, or null.</summary>
    [JsonPropertyName("lastEditedBy")]
    public ReleaseLastEditedByDto? LastEditedBy { get; init; }

    /// <summary>The return note while <c>returned</c>, else null.</summary>
    [JsonPropertyName("returnNote")]
    public ReleaseReturnNoteDto? ReturnNote { get; init; }

    /// <summary>The host-relative permalink (<c>/press/{org}/{slug}</c>), or null before the slug exists.</summary>
    [JsonPropertyName("permalink")]
    public string? Permalink { get; init; }

    /// <summary>The optimistic-concurrency version a PUT must echo back (stale = 409).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }

    /// <summary>The participant-visible revisions (<c>update</c>/<c>correction</c>), oldest first.</summary>
    [JsonPropertyName("revisions")]
    public IReadOnlyList<ContentRevisionDto> Revisions { get; init; } = [];
}

/// <summary>
/// <c>POST /api/press/releases</c> and <c>PUT /api/press/releases/{id}</c> (story 04). No exercise id, no origin, no
/// acting human: the server takes all three from the session (COR-001, COR-018).
/// </summary>
public sealed record ReleaseWriteRequest
{
    /// <summary>The organization persona to release as (checked by <see cref="IReleaseOrgResolver.CanReleaseAsync"/>).</summary>
    [JsonPropertyName("orgPersonaId")]
    public string? OrgPersonaId { get; init; }

    /// <summary>The headline.</summary>
    [JsonPropertyName("headline")]
    public string? Headline { get; init; }

    /// <summary>The UNTRUSTED rich body; sanitized by the funnel's <c>rich-tables</c> profile.</summary>
    [JsonPropertyName("bodyHtml")]
    public string? BodyHtml { get; init; }

    /// <summary>The press contact, or null.</summary>
    [JsonPropertyName("contact")]
    public ReleaseContactDto? Contact { get; init; }

    /// <summary>The dateline, or null.</summary>
    [JsonPropertyName("dateline")]
    public string? Dateline { get; init; }

    /// <summary>The attached PDF's media id, or null.</summary>
    [JsonPropertyName("documentMediaId")]
    public string? DocumentMediaId { get; init; }

    /// <summary>The attached image media ids, in order.</summary>
    [JsonPropertyName("imageMediaIds")]
    public IReadOnlyList<string> ImageMediaIds { get; init; } = [];

    /// <summary>The version a PUT edits (0 on create).</summary>
    [JsonPropertyName("version")]
    public int Version { get; init; }
}
