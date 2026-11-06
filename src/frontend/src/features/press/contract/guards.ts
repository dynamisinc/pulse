/**
 * features/press/contract/guards.ts
 * ---------------------------------------------------------------------------
 * Runtime guards for every press-room shape a client READS (press-room story
 * 01, #738): the participant payload and its parts, the org, the letterhead and
 * the author DTO and its parts. Same discipline as the FC-3 guards they build
 * on (`features/channels/contract/guards.ts`): an out-of-shape body fails
 * CLOSED (the guard returns false), never a blind cast. EXTRA keys are
 * tolerated so the contract can evolve additively, with ONE deliberate
 * exception: `isReleaseParticipantPayload` REJECTS a payload carrying any
 * `STAFF_ONLY_PAYLOAD_KEYS` key (crossPost, approval, inputPath, boilerplate,
 * orgPersonaId), so a server leak is caught at the client boundary too
 * (XC-002).
 *
 * `isReleaseContentDto` is the participant permalink read: an FC-3
 * `ChannelContentDto` of kind `release` with a participant-safe payload.
 *
 * The write request is produced by the client, so it has no guard.
 *
 * World: both. No React, no MUI.
 */

import {
  isChannelContentDto,
  isContentMediaDto,
  isContentRevisionDto,
  isHostRelativePath,
  isIsoScenarioTime,
} from '@/features/channels/contract'
import type { ChannelContentDto, ContentMediaDto } from '@/features/channels/contract'
import { STAFF_ONLY_PAYLOAD_KEYS, isInputPath, isReleaseState } from './vocabulary'
import type {
  ReleaseAuthorDto,
  ReleaseAuthorPayloadDto,
  ReleaseContactDto,
  ReleaseCrossPostDto,
  ReleaseDocumentDto,
  ReleaseLastEditedByDto,
  ReleaseLetterheadDto,
  ReleaseOrgDto,
  ReleaseOrgRefDto,
  ReleaseParticipantPayloadDto,
  ReleaseReturnNoteDto,
} from './types'

type Candidate = Record<string, unknown>

function asRecord(value: unknown): Candidate | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Candidate) : null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is readonly T[] {
  return Array.isArray(value) && value.every(guard)
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || isIsoScenarioTime(value)
}

function isNullableMedia(value: unknown): value is ContentMediaDto | null {
  return value === null || isContentMediaDto(value)
}

export function isReleaseContactDto(value: unknown): value is ReleaseContactDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.name) &&
    isNullableString(c.title) &&
    isNullableString(c.phone) &&
    isNullableString(c.email)
  )
}

export function isReleaseDocumentDto(value: unknown): value is ReleaseDocumentDto {
  const c = asRecord(value)
  return !!c && isNonEmptyString(c.mediaId) && isNonEmptyString(c.fileName) && isCount(c.sizeBytes)
}

export function isReleaseOrgRefDto(value: unknown): value is ReleaseOrgRefDto {
  const c = asRecord(value)
  return !!c && isNonEmptyString(c.name) && isNullableString(c.outletId)
}

function isNullableContact(value: unknown): value is ReleaseContactDto | null {
  return value === null || isReleaseContactDto(value)
}

function isNullableDocument(value: unknown): value is ReleaseDocumentDto | null {
  return value === null || isReleaseDocumentDto(value)
}

/** The participant-safe payload; rejects any staff-only key (XC-002). */
export function isReleaseParticipantPayload(value: unknown): value is ReleaseParticipantPayloadDto {
  const c = asRecord(value)
  return (
    !!c &&
    !STAFF_ONLY_PAYLOAD_KEYS.some(key => key in c) &&
    isReleaseOrgRefDto(c.org) &&
    isNullableContact(c.contact) &&
    isNullableString(c.dateline) &&
    isNullableDocument(c.document)
  )
}

/** The participant permalink read of a release: FC-3 content of kind `release`, safe payload. */
export function isReleaseContentDto(value: unknown): value is ChannelContentDto {
  return (
    isChannelContentDto(value) &&
    value.kind === 'release' &&
    isReleaseParticipantPayload(value.payload)
  )
}

export function isReleaseCrossPostDto(value: unknown): value is ReleaseCrossPostDto {
  const c = asRecord(value)
  return !!c && isNullableString(c.text)
}

export function isReleaseAuthorPayloadDto(value: unknown): value is ReleaseAuthorPayloadDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.orgPersonaId) &&
    isInputPath(c.inputPath) &&
    isNullableContact(c.contact) &&
    isNullableString(c.dateline) &&
    isNullableDocument(c.document) &&
    isNullableString(c.boilerplate) &&
    (c.crossPost === null || isReleaseCrossPostDto(c.crossPost))
  )
}

export function isReleaseLetterheadDto(value: unknown): value is ReleaseLetterheadDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNullableMedia(c.logo) &&
    isNullableString(c.address) &&
    isNullableContact(c.defaultContact)
  )
}

export function isReleaseOrgDto(value: unknown): value is ReleaseOrgDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.personaId) &&
    isNonEmptyString(c.outletId) &&
    isNonEmptyString(c.name) &&
    isNonEmptyString(c.handle) &&
    isNullableString(c.pairedHandle) &&
    isReleaseLetterheadDto(c.letterhead) &&
    typeof c.approvalRequired === 'boolean'
  )
}

export function isReleaseLastEditedByDto(value: unknown): value is ReleaseLastEditedByDto {
  const c = asRecord(value)
  return !!c && isNonEmptyString(c.displayName)
}

export function isReleaseReturnNoteDto(value: unknown): value is ReleaseReturnNoteDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.text) &&
    isNonEmptyString(c.byDisplayName) &&
    isIsoScenarioTime(c.scenarioTime)
  )
}

export function isReleaseAuthorDto(value: unknown): value is ReleaseAuthorDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isNonEmptyString(c.orgPersonaId) &&
    isReleaseState(c.state) &&
    isNonEmptyString(c.headline) &&
    typeof c.bodyHtml === 'string' &&
    isReleaseAuthorPayloadDto(c.payload) &&
    isArrayOf(c.media, isContentMediaDto) &&
    isNullableIso(c.scheduledScenarioTime) &&
    isNullableIso(c.updatedScenarioTime) &&
    (c.lastEditedBy === null || isReleaseLastEditedByDto(c.lastEditedBy)) &&
    (c.returnNote === null || isReleaseReturnNoteDto(c.returnNote)) &&
    (c.permalink === null || isHostRelativePath(c.permalink)) &&
    isCount(c.version) &&
    isArrayOf(c.revisions, isContentRevisionDto)
  )
}

/** `GET /api/press/orgs`: an array of orgs. */
export function isReleaseOrgList(value: unknown): value is readonly ReleaseOrgDto[] {
  return isArrayOf(value, isReleaseOrgDto)
}

/** `GET /api/press/releases`: an array of author DTOs. */
export function isReleaseAuthorList(value: unknown): value is readonly ReleaseAuthorDto[] {
  return isArrayOf(value, isReleaseAuthorDto)
}
