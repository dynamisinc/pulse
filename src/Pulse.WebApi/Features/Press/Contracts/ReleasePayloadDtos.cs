namespace Pulse.WebApi.Features.Press.Contracts;

using System.Text.Json.Serialization;

// FROZEN PC-1 payload shapes (press-room story 01, #738). The stored payload (ContentItem.PayloadJson for kind
// `release`) is written by ReleaseKindDescriptor in its normalized form; these records are its two READ projections:
// the participant-safe one (ProjectPayload, XC-002) and the author/org-mate one (story 04's ReleaseAuthorDto).
// Each mirrors its TS twin in src/frontend/src/features/press/contract/types.ts field for field, pinned by
// contract/pressWireContract.json. Same conventions as FC-3: explicit [JsonPropertyName], string ids, nullable members
// written as an explicit null, every type SEALED and deriving from nothing.

/// <summary>A release's press contact block (PC-1 <c>contact</c>). Length-capped plain text (<see cref="PressVocabulary"/>).</summary>
public sealed record ReleaseContactDto
{
    /// <summary>The contact's name. Non-empty.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The contact's title, or null.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; init; }

    /// <summary>The contact's phone, or null.</summary>
    [JsonPropertyName("phone")]
    public string? Phone { get; init; }

    /// <summary>The contact's email, or null.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; init; }
}

/// <summary>
/// A release's download-only PDF attachment (PC-1 <c>document</c>; Q-03). <see cref="FileName"/> and
/// <see cref="SizeBytes"/> are stamped by the server from the media asset, never taken from the client.
/// </summary>
public sealed record ReleaseDocumentDto
{
    /// <summary>The exercise-owned <c>document</c> media asset id.</summary>
    [JsonPropertyName("mediaId")]
    public required string MediaId { get; init; }

    /// <summary>The original file name, as uploaded.</summary>
    [JsonPropertyName("fileName")]
    public required string FileName { get; init; }

    /// <summary>The file size in bytes.</summary>
    [JsonPropertyName("sizeBytes")]
    public required long SizeBytes { get; init; }
}

/// <summary>
/// The publishing organization as a participant sees it: its name and the letterhead reference (the org newsroom outlet,
/// whose logo and <c>ext.press</c> letterhead keys render the letterhead). Derived server-side from <c>orgPersonaId</c>;
/// the persona id itself is not exposed.
/// </summary>
public sealed record ReleaseOrgRefDto
{
    /// <summary>The publishing organization's name (the newsroom outlet's name, else the persona's display name).</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The org newsroom outlet id (the letterhead reference), or null when no newsroom exists yet.</summary>
    [JsonPropertyName("outletId")]
    public string? OutletId { get; init; }
}

/// <summary>
/// The participant-safe projection of a release payload (<c>ChannelContentDto.payload</c> for kind <c>release</c>).
/// Exactly <see cref="PressVocabulary.ParticipantPayloadKeys"/>: never <c>crossPost</c>, <c>approval</c> or
/// <c>inputPath</c> (XC-002).
/// </summary>
public sealed record ReleaseParticipantPayloadDto
{
    /// <summary>The publishing organization.</summary>
    [JsonPropertyName("org")]
    public required ReleaseOrgRefDto Org { get; init; }

    /// <summary>The press contact, or null.</summary>
    [JsonPropertyName("contact")]
    public ReleaseContactDto? Contact { get; init; }

    /// <summary>The dateline text, or null.</summary>
    [JsonPropertyName("dateline")]
    public string? Dateline { get; init; }

    /// <summary>The attached PDF, or null.</summary>
    [JsonPropertyName("document")]
    public ReleaseDocumentDto? Document { get; init; }
}

/// <summary>A draft's cross-post intent (PC-1 <c>crossPost</c>): the composer's checkbox state. Author-only.</summary>
public sealed record ReleaseCrossPostDto
{
    /// <summary>The Social post text, or null for the default link card text.</summary>
    [JsonPropertyName("text")]
    public string? Text { get; init; }
}

/// <summary>
/// The author/org-mate projection of a release payload (<c>ReleaseAuthorDto.payload</c>, story 04). Carries the author's
/// own draft state (<c>inputPath</c>, <c>boilerplate</c>, <c>crossPost</c>) but never the staff-set <c>approval</c> block.
/// </summary>
public sealed record ReleaseAuthorPayloadDto
{
    /// <summary>The organization persona the release is issued as.</summary>
    [JsonPropertyName("orgPersonaId")]
    public required string OrgPersonaId { get; init; }

    /// <summary>The input path (<see cref="PressVocabulary.InputPaths"/>).</summary>
    [JsonPropertyName("inputPath")]
    public required string InputPath { get; init; }

    /// <summary>The press contact, or null.</summary>
    [JsonPropertyName("contact")]
    public ReleaseContactDto? Contact { get; init; }

    /// <summary>The dateline text, or null.</summary>
    [JsonPropertyName("dateline")]
    public string? Dateline { get; init; }

    /// <summary>The attached PDF, or null.</summary>
    [JsonPropertyName("document")]
    public ReleaseDocumentDto? Document { get; init; }

    /// <summary>The "About {org}" boilerplate, or null.</summary>
    [JsonPropertyName("boilerplate")]
    public string? Boilerplate { get; init; }

    /// <summary>The cross-post intent, or null when the box is unchecked.</summary>
    [JsonPropertyName("crossPost")]
    public ReleaseCrossPostDto? CrossPost { get; init; }
}
