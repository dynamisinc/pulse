/**
 * features/channels/contract/guards.ts
 * ---------------------------------------------------------------------------
 * Runtime guards for every FC-3 / FC-5 shape a participant or staff client
 * READS (channels-foundation story 02, #698). Same discipline as the shell's
 * `isAlert` (`AlertBar/useAlerts.ts`): a live endpoint that returns an
 * out-of-shape body must fail CLOSED (the guard returns false and the caller
 * throws), never be cast blindly. EXTRA keys are tolerated, so the contract
 * can evolve additively without breaking deployed clients.
 *
 * Stricter than `isAlert` in one place, deliberately: a scenario instant must
 * be an ISO-8601 date-time with an explicit offset, not anything `Date.parse`
 * happens to accept ("Oct 1 2026" parses in V8). Permalinks, home routes and
 * alert hrefs must be host-relative paths (FC-9.3).
 *
 * Request bodies (`ContentWriteRequest`, `PublishOptions`) are produced by the
 * client, so they have no guard.
 *
 * World: both. No React, no MUI.
 */

import {
  ALERT_SEVERITIES,
  isChannelId,
  isContentKind,
  isContentMediaKind,
  isContentOrigin,
  isContentStatus,
  isMediaRole,
  isParticipantRevisionKind,
  isRevisionKind,
} from './vocabulary'
import type {
  AlertDto,
  AlertsChangedDto,
  ChannelContentDto,
  ChannelContentListDto,
  ChannelContentReadDto,
  ChannelContentStaffDto,
  ChannelContentSummaryDto,
  ChannelContentTombstoneDto,
  ContentBylineDto,
  ContentMediaDto,
  ContentRetractedDto,
  ContentRevisedDto,
  ContentRevisionDto,
  ContentRevisionLogEntryDto,
  LinkPreviewDto,
  OutletDto,
  OutletRefDto,
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

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is readonly T[] {
  return Array.isArray(value) && value.every(guard)
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * Whether `value` is an ISO-8601 date-time WITH an offset (`Z` or `±hh:mm`)
 * that is also a real instant. The wire convention for every `*ScenarioTime`.
 */
export function isIsoScenarioTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
}

function isNullableIsoScenarioTime(value: unknown): value is string | null {
  return value === null || isIsoScenarioTime(value)
}

// C0, DEL and C1: the same set as .NET char.IsControl, so both sides agree.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Whether `value` is a host-relative path: starts with a single `/`, carries
 * no scheme and no host (FC-9.3, COR-008). `//host/x` is protocol-relative,
 * so it is rejected too, as is any control character: URL parsers strip
 * tab/CR/LF, so `"/\t/evil.test"` would otherwise resolve as `//evil.test`.
 * Mirrors the server's `ChannelVocabulary.IsHostRelativePath`.
 */
export function isHostRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('://') &&
    !value.includes('\\') &&
    !CONTROL_CHARACTER.test(value)
  )
}

function isNullableHostRelativePath(value: unknown): value is string | null {
  return value === null || isHostRelativePath(value)
}

function isAlertSeverity(value: unknown): value is AlertDto['severity'] {
  return typeof value === 'string' && (ALERT_SEVERITIES as readonly string[]).includes(value)
}

export function isOutletRefDto(value: unknown): value is OutletRefDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isChannelId(c.channelId) &&
    isNonEmptyString(c.slug) &&
    isNonEmptyString(c.name) &&
    isNonEmptyString(c.skinKey)
  )
}

export function isContentMediaDto(value: unknown): value is ContentMediaDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isContentMediaKind(c.kind) &&
    isMediaRole(c.role) &&
    isNonEmptyString(c.url) &&
    isNullableString(c.posterUrl) &&
    isNonEmptyString(c.contentType) &&
    isNullableNumber(c.width) &&
    isNullableNumber(c.height) &&
    isNullableNumber(c.durationSec) &&
    typeof c.alt === 'string' &&
    isNullableString(c.caption)
  )
}

function isNullableMedia(value: unknown): value is ContentMediaDto | null {
  return value === null || isContentMediaDto(value)
}

export function isOutletDto(value: unknown): value is OutletDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isChannelId(c.channelId) &&
    isNonEmptyString(c.slug) &&
    isNonEmptyString(c.name) &&
    isNullableString(c.tagline) &&
    isNullableString(c.parentOutletId) &&
    isNullableString(c.pairedPersonaId) &&
    isNullableMedia(c.logo) &&
    isArrayOf(c.categories, (item): item is string => typeof item === 'string') &&
    isNonEmptyString(c.skinKey) &&
    (c.skinOverrides === null || asRecord(c.skinOverrides) !== null) &&
    isHostRelativePath(c.homeRoute)
  )
}

export function isContentBylineDto(value: unknown): value is ContentBylineDto {
  const c = asRecord(value)
  return !!c && isNonEmptyString(c.name) && isNullableString(c.personaId)
}

function hasRevisionFields(c: Candidate | null): c is Candidate {
  return (
    !!c &&
    typeof c.number === 'number' && Number.isInteger(c.number) && c.number > 0 &&
    isIsoScenarioTime(c.scenarioTime) &&
    isNullableString(c.note)
  )
}

/** A participant revision: `update` / `correction` only (never `edit` or `silent_rewrite`). */
export function isContentRevisionDto(value: unknown): value is ContentRevisionDto {
  const c = asRecord(value)
  return hasRevisionFields(c) && isParticipantRevisionKind(c.kind)
}

/** A staff revision-log entry: any revision kind. */
export function isContentRevisionLogEntryDto(value: unknown): value is ContentRevisionLogEntryDto {
  const c = asRecord(value)
  return hasRevisionFields(c) && isRevisionKind(c.kind)
}

/** The fields every content read shares, through `publishedScenarioTime` (exclusive). */
function hasContentIdentity(c: Candidate): boolean {
  return (
    isNonEmptyString(c.id) &&
    isChannelId(c.channelId) &&
    isContentKind(c.kind) &&
    isOutletRefDto(c.outlet) &&
    isNonEmptyString(c.slug) &&
    isHostRelativePath(c.permalink)
  )
}

function hasSummaryFields(c: Candidate): boolean {
  return (
    hasContentIdentity(c) &&
    isNonEmptyString(c.headline) &&
    isNullableString(c.dek) &&
    isNullableString(c.kicker) &&
    isNullableString(c.category) &&
    isNullableMedia(c.hero) &&
    isNullableIsoScenarioTime(c.updatedScenarioTime) &&
    typeof c.featured === 'boolean'
  )
}

function hasBodyFields(c: Candidate): boolean {
  return (
    (c.byline === null || isContentBylineDto(c.byline)) &&
    typeof c.bodyHtml === 'string' &&
    isArrayOf(c.media, isContentMediaDto) &&
    isArrayOf(c.revisions, isContentRevisionDto) &&
    isNullableString(c.pairedPostId) &&
    isNullableString(c.alertId) &&
    asRecord(c.payload) !== null
  )
}

export function isChannelContentSummaryDto(value: unknown): value is ChannelContentSummaryDto {
  const c = asRecord(value)
  return (
    !!c &&
    c.state === 'published' &&
    hasSummaryFields(c) &&
    isIsoScenarioTime(c.publishedScenarioTime)
  )
}

export function isChannelContentDto(value: unknown): value is ChannelContentDto {
  const c = asRecord(value)
  return !!c && isChannelContentSummaryDto(c) && hasBodyFields(c)
}

export function isChannelContentTombstoneDto(value: unknown): value is ChannelContentTombstoneDto {
  const c = asRecord(value)
  return (
    !!c &&
    c.state === 'retracted' &&
    hasContentIdentity(c) &&
    isIsoScenarioTime(c.retractedScenarioTime)
  )
}

/** A permalink read: a published item or a tombstone, discriminated by `state`. */
export function isChannelContentReadDto(value: unknown): value is ChannelContentReadDto {
  return isChannelContentDto(value) || isChannelContentTombstoneDto(value)
}

export function isChannelContentListDto(value: unknown): value is ChannelContentListDto {
  const c = asRecord(value)
  return !!c && isArrayOf(c.items, isChannelContentSummaryDto) && isNullableString(c.nextCursor)
}

export function isChannelContentStaffDto(value: unknown): value is ChannelContentStaffDto {
  const c = asRecord(value)
  return (
    !!c &&
    (c.state === null || c.state === 'published' || c.state === 'retracted') &&
    hasSummaryFields(c) &&
    isNullableIsoScenarioTime(c.publishedScenarioTime) &&
    hasBodyFields(c) &&
    isContentStatus(c.status) &&
    isContentOrigin(c.origin) &&
    isNonEmptyString(c.actingHumanId) &&
    isNullableIsoScenarioTime(c.scheduledScenarioTime) &&
    isNullableString(c.publishedWallClock) &&
    typeof c.background === 'boolean' &&
    isNullableNumber(c.featuredRank) &&
    isNullableString(c.injectId) &&
    isNullableString(c.externalSource) &&
    isNullableString(c.externalRef) &&
    isCount(c.revisionCount) &&
    isArrayOf(c.revisionLog, isContentRevisionLogEntryDto) &&
    isCount(c.version)
  )
}

export function isAlertDto(value: unknown): value is AlertDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isAlertSeverity(c.severity) &&
    isNonEmptyString(c.message) &&
    isIsoScenarioTime(c.scenarioTime) &&
    isNullableHostRelativePath(c.href) &&
    (c.sourceChannel === null || isChannelId(c.sourceChannel)) &&
    isNullableString(c.contentId) &&
    isNullableIsoScenarioTime(c.expiresScenarioTime)
  )
}

export function isAlertsChangedDto(value: unknown): value is AlertsChangedDto {
  const c = asRecord(value)
  return !!c && isArrayOf(c.alerts, isAlertDto)
}

export function isContentRevisedDto(value: unknown): value is ContentRevisedDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isChannelId(c.channelId) &&
    isHostRelativePath(c.permalink) &&
    isNullableIsoScenarioTime(c.updatedScenarioTime) &&
    isArrayOf(c.revisions, isContentRevisionDto) &&
    isNonEmptyString(c.headline) &&
    isNullableString(c.dek)
  )
}

export function isContentRetractedDto(value: unknown): value is ContentRetractedDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isChannelId(c.channelId) &&
    isHostRelativePath(c.permalink) &&
    isIsoScenarioTime(c.retractedScenarioTime)
  )
}

export function isLinkPreviewDto(value: unknown): value is LinkPreviewDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.title) &&
    (c.description === undefined || isNullableString(c.description)) &&
    (c.image === undefined || isNullableMedia(c.image)) &&
    isNonEmptyString(c.sourceName) &&
    isHostRelativePath(c.permalink)
  )
}
