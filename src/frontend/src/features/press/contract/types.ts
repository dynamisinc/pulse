/**
 * features/press/contract/types.ts
 * ---------------------------------------------------------------------------
 * PC-1 / PC-2 wire shapes (press-room story 01, #738). The TS twin of
 * `Features/Press/Contracts/ReleasePayloadDtos.cs` + `ReleaseAuthorDtos.cs`,
 * field for field. Each type has a `*_KEYS` list checked EXHAUSTIVE against the
 * type at compile time (`wireKeys`, from the channels contract), and every list
 * is pinned to `pressWireContract.json`, which the C# suite also reads.
 *
 * Conventions (FC-3): camelCase keys, string ids, nullable fields (C# `T?`)
 * present and `null`, never omitted; every instant is a SCENARIO-time ISO string
 * (COR-053); every URL host-relative. Media is FC-3's `ContentMediaDto` and
 * revisions are FC-3's `ContentRevisionDto`, imported, never copied.
 *
 * XC-002: the participant shapes (`ReleaseParticipantPayloadDto`,
 * `ReleaseOrgRefDto`, `ReleaseContactDto`, `ReleaseDocumentDto`) never carry
 * `crossPost`, `approval`, `inputPath`, `boilerplate` or a persona id. The
 * author shapes are for the humans who may release as the org only.
 *
 * World: both (types only). No React, no MUI.
 */

import { wireKeys } from '@/features/channels/contract'
import type { ContentMediaDto, ContentRevisionDto } from '@/features/channels/contract'
import type { InputPath, ReleaseState } from './vocabulary'

// --- participant-safe parts (PC-1) --------------------------------------------

/** A release's press contact block. */
export interface ReleaseContactDto {
  readonly name: string
  readonly title: string | null
  readonly phone: string | null
  readonly email: string | null
}
export const RELEASE_CONTACT_KEYS = wireKeys<ReleaseContactDto>()(['name', 'title', 'phone', 'email'])

/** A release's download-only PDF attachment (name and size stamped by the server). */
export interface ReleaseDocumentDto {
  readonly mediaId: string
  readonly fileName: string
  readonly sizeBytes: number
}
export const RELEASE_DOCUMENT_KEYS = wireKeys<ReleaseDocumentDto>()(['mediaId', 'fileName', 'sizeBytes'])

/** The publishing organization as a participant sees it (no persona id). */
export interface ReleaseOrgRefDto {
  readonly name: string
  /** The org newsroom outlet id (the letterhead reference), or null before one exists. */
  readonly outletId: string | null
}
export const RELEASE_ORG_REF_KEYS = wireKeys<ReleaseOrgRefDto>()(['name', 'outletId'])

/** `ChannelContentDto.payload` for kind `release` on a participant read. */
export interface ReleaseParticipantPayloadDto {
  readonly org: ReleaseOrgRefDto
  readonly contact: ReleaseContactDto | null
  readonly dateline: string | null
  readonly document: ReleaseDocumentDto | null
}
export const RELEASE_PARTICIPANT_PAYLOAD_KEYS = wireKeys<ReleaseParticipantPayloadDto>()([
  'org', 'contact', 'dateline', 'document',
])

// --- author world (PC-2) --------------------------------------------------------

/** A draft's cross-post intent (the composer's checkbox state). Author-only. */
export interface ReleaseCrossPostDto {
  readonly text: string | null
}
export const RELEASE_CROSS_POST_KEYS = wireKeys<ReleaseCrossPostDto>()(['text'])

/** The author/org-mate projection of a release payload (never the `approval` block). */
export interface ReleaseAuthorPayloadDto {
  readonly orgPersonaId: string
  readonly inputPath: InputPath
  readonly contact: ReleaseContactDto | null
  readonly dateline: string | null
  readonly document: ReleaseDocumentDto | null
  readonly boilerplate: string | null
  readonly crossPost: ReleaseCrossPostDto | null
}
export const RELEASE_AUTHOR_PAYLOAD_KEYS = wireKeys<ReleaseAuthorPayloadDto>()([
  'orgPersonaId', 'inputPath', 'contact', 'dateline', 'document', 'boilerplate', 'crossPost',
])

/** An org's letterhead defaults: neutral (all null) when none are configured. */
export interface ReleaseLetterheadDto {
  readonly logo: ContentMediaDto | null
  readonly address: string | null
  readonly defaultContact: ReleaseContactDto | null
}
export const RELEASE_LETTERHEAD_KEYS = wireKeys<ReleaseLetterheadDto>()(['logo', 'address', 'defaultContact'])

/** `GET /api/press/orgs` entry: an organization the signed-in human may release as. */
export interface ReleaseOrgDto {
  readonly personaId: string
  readonly outletId: string
  readonly name: string
  /** With its leading `@`. */
  readonly handle: string
  readonly pairedHandle: string | null
  readonly letterhead: ReleaseLetterheadDto
  readonly approvalRequired: boolean
}
export const RELEASE_ORG_KEYS = wireKeys<ReleaseOrgDto>()([
  'personaId', 'outletId', 'name', 'handle', 'pairedHandle', 'letterhead', 'approvalRequired',
])

/** Who last edited a release (display name only, own org only). */
export interface ReleaseLastEditedByDto {
  readonly displayName: string
}
export const RELEASE_LAST_EDITED_BY_KEYS = wireKeys<ReleaseLastEditedByDto>()(['displayName'])

/** The approver's return note on a `returned` release. */
export interface ReleaseReturnNoteDto {
  readonly text: string
  readonly byDisplayName: string
  /** Scenario time, ISO-8601 with offset. */
  readonly scenarioTime: string
}
export const RELEASE_RETURN_NOTE_KEYS = wireKeys<ReleaseReturnNoteDto>()([
  'text', 'byDisplayName', 'scenarioTime',
])

/** `GET /api/press/releases[/{id}]`: the author/org-mate view of one release. */
export interface ReleaseAuthorDto {
  readonly id: string
  readonly orgPersonaId: string
  readonly state: ReleaseState
  readonly headline: string
  /** Sanitized server-side; render only through `SanitizedBody`. Possibly empty. */
  readonly bodyHtml: string
  readonly payload: ReleaseAuthorPayloadDto
  readonly media: readonly ContentMediaDto[]
  /** The embargo time while `scheduled`, else null (scenario time). */
  readonly scheduledScenarioTime: string | null
  readonly updatedScenarioTime: string | null
  readonly lastEditedBy: ReleaseLastEditedByDto | null
  readonly returnNote: ReleaseReturnNoteDto | null
  /** Host-relative `/press/{org-slug}/{slug}`, or null before the slug exists. */
  readonly permalink: string | null
  /** The optimistic-concurrency version a PUT echoes back (stale = 409). */
  readonly version: number
  readonly revisions: readonly ContentRevisionDto[]
}
export const RELEASE_AUTHOR_KEYS = wireKeys<ReleaseAuthorDto>()([
  'id', 'orgPersonaId', 'state', 'headline', 'bodyHtml', 'payload', 'media', 'scheduledScenarioTime',
  'updatedScenarioTime', 'lastEditedBy', 'returnNote', 'permalink', 'version', 'revisions',
])

/**
 * `POST` / `PUT /api/press/releases[/{id}]` body. Never an exercise id, origin
 * or acting human: the server takes those from the session (COR-001, COR-018).
 */
export interface ReleaseWriteRequest {
  readonly orgPersonaId: string | null
  readonly headline: string | null
  /** Untrusted; sanitized server-side. */
  readonly bodyHtml: string | null
  readonly contact: ReleaseContactDto | null
  readonly dateline: string | null
  readonly documentMediaId: string | null
  readonly imageMediaIds: readonly string[]
  /** The version a PUT edits (0 on create). */
  readonly version: number
}
export const RELEASE_WRITE_KEYS = wireKeys<ReleaseWriteRequest>()([
  'orgPersonaId', 'headline', 'bodyHtml', 'contact', 'dateline', 'documentMediaId', 'imageMediaIds', 'version',
])

/** Every pinned shape's key list, by its golden-file name. */
export const PRESS_WIRE_SHAPE_KEYS = {
  ReleaseContactDto: RELEASE_CONTACT_KEYS,
  ReleaseDocumentDto: RELEASE_DOCUMENT_KEYS,
  ReleaseOrgRefDto: RELEASE_ORG_REF_KEYS,
  ReleaseParticipantPayloadDto: RELEASE_PARTICIPANT_PAYLOAD_KEYS,
  ReleaseCrossPostDto: RELEASE_CROSS_POST_KEYS,
  ReleaseAuthorPayloadDto: RELEASE_AUTHOR_PAYLOAD_KEYS,
  ReleaseOrgDto: RELEASE_ORG_KEYS,
  ReleaseLetterheadDto: RELEASE_LETTERHEAD_KEYS,
  ReleaseLastEditedByDto: RELEASE_LAST_EDITED_BY_KEYS,
  ReleaseReturnNoteDto: RELEASE_RETURN_NOTE_KEYS,
  ReleaseAuthorDto: RELEASE_AUTHOR_KEYS,
  ReleaseWriteRequest: RELEASE_WRITE_KEYS,
} as const
