/**
 * features/channels/contract/types.ts
 * ---------------------------------------------------------------------------
 * FC-3 / FC-5 wire shapes (channels-foundation story 02, #698). The TS twin of
 * `Features/Channels/Contracts/ChannelContentDtos.cs` + `ChannelRealtimeDtos.cs`
 * + `PublishOptions.cs`, field for field. Each type has a `*_KEYS` list that is
 * checked EXHAUSTIVE against the type at compile time (`wireKeys`), and every
 * list is pinned to `wireContract.json`, which the C# suite also reads: a
 * one-sided drift is a type error or a failing test, not a review comment.
 *
 * Conventions: camelCase keys; ids are strings; every instant is a
 * SCENARIO-time ISO string, rendered with `formatScenarioTime` /
 * `useScenarioTime` (COR-053); nullable fields are present and `null`, never
 * omitted; every URL is host-relative (FC-9.3).
 *
 * XC-002: the participant shapes never carry `origin`, `actingHumanId`, a wall
 * clock, `status`, `background`, `featuredRank`, `version`, `injectId` or
 * `externalRef`. Only `ChannelContentStaffDto` and `ContentWriteRequest` (staff
 * world) do.
 *
 * World: both (types only). No React, no MUI.
 */

import type { Alert } from '@/features/participant-shell/components/AlertBar/alertTypes'
import type {
  ChannelId,
  ContentKind,
  ContentMediaKind,
  ContentOrigin,
  ContentStatus,
  MediaRole,
  ParticipantRevisionKind,
  RevisionKind,
} from './vocabulary'

/** An opaque JSON object (a kind payload, a partial skin-token set). */
export type JsonObject = Readonly<Record<string, unknown>>

type MissingKeys<T, K extends readonly PropertyKey[]> = Exclude<keyof T, K[number]>

/**
 * Returns `keys` unchanged, but only type-checks when they name EVERY key of
 * `T` (and nothing else), so a field added to a type without its key list —
 * or the reverse — fails `npm run type-check`.
 */
export function wireKeys<T>() {
  return <const K extends readonly (keyof T)[]>(
    keys: K & ([MissingKeys<T, K>] extends [never] ? unknown : { missingKeys: MissingKeys<T, K> }),
  ): K => keys
}

/** Embedded in every content DTO. */
export interface OutletRefDto {
  readonly id: string
  readonly channelId: ChannelId
  readonly slug: string
  readonly name: string
  readonly skinKey: string
}
export const OUTLET_REF_KEYS = wireKeys<OutletRefDto>()(['id', 'channelId', 'slug', 'name', 'skinKey'])

/** One media item. `url` / `posterUrl` are signed, host-relative URLs. */
export interface ContentMediaDto {
  readonly id: string
  readonly kind: ContentMediaKind
  readonly role: MediaRole
  readonly url: string
  readonly posterUrl: string | null
  readonly contentType: string
  readonly width: number | null
  readonly height: number | null
  readonly durationSec: number | null
  readonly alt: string
  readonly caption: string | null
}
export const CONTENT_MEDIA_KEYS = wireKeys<ContentMediaDto>()([
  'id', 'kind', 'role', 'url', 'posterUrl', 'contentType', 'width', 'height', 'durationSec', 'alt', 'caption',
])

/** `GET /api/outlets` entry. */
export interface OutletDto {
  readonly id: string
  readonly channelId: ChannelId
  readonly slug: string
  readonly name: string
  readonly tagline: string | null
  readonly parentOutletId: string | null
  readonly pairedPersonaId: string | null
  readonly logo: ContentMediaDto | null
  readonly categories: readonly string[]
  readonly skinKey: string
  /** A partial `OutletSkinTokens` (FC-3b); the token type itself is story 13's. */
  readonly skinOverrides: JsonObject | null
  /** Host-relative, e.g. `/news/newsline-7`. */
  readonly homeRoute: string
}
export const OUTLET_KEYS = wireKeys<OutletDto>()([
  'id', 'channelId', 'slug', 'name', 'tagline', 'parentOutletId', 'pairedPersonaId', 'logo', 'categories',
  'skinKey', 'skinOverrides', 'homeRoute',
])

export interface ContentBylineDto {
  readonly name: string
  readonly personaId: string | null
}
export const CONTENT_BYLINE_KEYS = wireKeys<ContentBylineDto>()(['name', 'personaId'])

/** A participant-visible revision: `update` or `correction` only. */
export interface ContentRevisionDto {
  readonly number: number
  readonly kind: ParticipantRevisionKind
  readonly scenarioTime: string
  readonly note: string | null
}
export const CONTENT_REVISION_KEYS = wireKeys<ContentRevisionDto>()(['number', 'kind', 'scenarioTime', 'note'])

/** A staff revision-log entry: same keys, every revision kind. */
export interface ContentRevisionLogEntryDto extends Omit<ContentRevisionDto, 'kind'> {
  readonly kind: RevisionKind
}

/** A list row and the `ContentPublished` payload. No body. */
export interface ChannelContentSummaryDto {
  readonly id: string
  readonly channelId: ChannelId
  readonly kind: ContentKind
  readonly outlet: OutletRefDto
  readonly slug: string
  /** `/{channelId}/{outletSlug}/{contentSlug}`, host-relative. */
  readonly permalink: string
  readonly state: 'published'
  readonly headline: string
  readonly dek: string | null
  readonly kicker: string | null
  readonly category: string | null
  readonly hero: ContentMediaDto | null
  readonly publishedScenarioTime: string
  /** The Updated stamp (moved by update / correction / silent_rewrite). */
  readonly updatedScenarioTime: string | null
  readonly featured: boolean
}
export const CHANNEL_CONTENT_SUMMARY_KEYS = wireKeys<ChannelContentSummaryDto>()([
  'id', 'channelId', 'kind', 'outlet', 'slug', 'permalink', 'state', 'headline', 'dek', 'kicker', 'category',
  'hero', 'publishedScenarioTime', 'updatedScenarioTime', 'featured',
])

/** The permalink read of a PUBLISHED item. */
export interface ChannelContentDto extends ChannelContentSummaryDto {
  readonly byline: ContentBylineDto | null
  /** Sanitized server-side; render only through `SanitizedBody`. */
  readonly bodyHtml: string
  readonly media: readonly ContentMediaDto[]
  readonly revisions: readonly ContentRevisionDto[]
  readonly pairedPostId: string | null
  readonly alertId: string | null
  /** The kind's participant-safe projection; each channel narrows it. */
  readonly payload: JsonObject
}
export const CHANNEL_CONTENT_KEYS = wireKeys<ChannelContentDto>()([
  ...CHANNEL_CONTENT_SUMMARY_KEYS,
  'byline', 'bodyHtml', 'media', 'revisions', 'pairedPostId', 'alertId', 'payload',
])

/** The permalink read of a RETRACTED item (XC-010 tombstone). No headline, no body. */
export interface ChannelContentTombstoneDto {
  readonly id: string
  readonly channelId: ChannelId
  readonly kind: ContentKind
  readonly outlet: OutletRefDto
  readonly slug: string
  readonly permalink: string
  readonly state: 'retracted'
  readonly retractedScenarioTime: string
}
export const CHANNEL_CONTENT_TOMBSTONE_KEYS = wireKeys<ChannelContentTombstoneDto>()([
  'id', 'channelId', 'kind', 'outlet', 'slug', 'permalink', 'state', 'retractedScenarioTime',
])

/** What a permalink read returns: discriminate on `state`. */
export type ChannelContentReadDto = ChannelContentDto | ChannelContentTombstoneDto

/** `GET /api/channels/{channelId}/content` body. */
export interface ChannelContentListDto {
  readonly items: readonly ChannelContentSummaryDto[]
  readonly nextCursor: string | null
}
export const CHANNEL_CONTENT_LIST_KEYS = wireKeys<ChannelContentListDto>()(['items', 'nextCursor'])

/** STAFF read of an item in any status. Staff world only. */
export interface ChannelContentStaffDto extends Omit<ChannelContentDto, 'state' | 'publishedScenarioTime'> {
  /** The participant projection's state, or null while draft / scheduled. */
  readonly state: 'published' | 'retracted' | null
  readonly publishedScenarioTime: string | null
  readonly status: ContentStatus
  readonly origin: ContentOrigin
  readonly actingHumanId: string
  readonly scheduledScenarioTime: string | null
  /** Wall clock: staff-only, never shown in-fiction. */
  readonly publishedWallClock: string | null
  readonly background: boolean
  readonly featuredRank: number | null
  readonly injectId: string | null
  readonly externalSource: string | null
  readonly externalRef: string | null
  readonly revisionCount: number
  readonly revisionLog: readonly ContentRevisionLogEntryDto[]
  readonly version: number
}
export const CHANNEL_CONTENT_STAFF_KEYS = wireKeys<ChannelContentStaffDto>()([
  ...CHANNEL_CONTENT_KEYS,
  'status', 'origin', 'actingHumanId', 'scheduledScenarioTime', 'publishedWallClock', 'background',
  'featuredRank', 'injectId', 'externalSource', 'externalRef', 'revisionCount', 'revisionLog', 'version',
])

export interface ContentMediaWriteRequest {
  readonly mediaId: string
  readonly role: MediaRole
  readonly alt: string | null
}
export const CONTENT_MEDIA_WRITE_KEYS = wireKeys<ContentMediaWriteRequest>()(['mediaId', 'role', 'alt'])

/**
 * `POST` / `PUT /api/content-items` body (staff). No `origin` /
 * `actingHumanId`: those come from the session, never a body.
 */
export interface ContentWriteRequest {
  readonly kind: ContentKind
  readonly outletId: string
  readonly headline: string
  readonly dek: string | null
  readonly kicker: string | null
  readonly category: string | null
  readonly bylineName: string | null
  readonly bylinePersonaId: string | null
  /** Untrusted; sanitized server-side. */
  readonly bodyHtml: string
  readonly heroMediaId: string | null
  readonly media: readonly ContentMediaWriteRequest[]
  readonly payload: JsonObject
  readonly background: boolean
  readonly featuredRank: number | null
  readonly scheduledScenarioTime: string | null
  readonly externalSource: string | null
  readonly externalRef: string | null
  /** The concurrency token last read (0 on create); stale = 409. */
  readonly version: number
}
export const CONTENT_WRITE_KEYS = wireKeys<ContentWriteRequest>()([
  'kind', 'outletId', 'headline', 'dek', 'kicker', 'category', 'bylineName', 'bylinePersonaId', 'bodyHtml',
  'heroMediaId', 'media', 'payload', 'background', 'featuredRank', 'scheduledScenarioTime', 'externalSource',
  'externalRef', 'version',
])

/**
 * `GET /api/alerts` entry and `AlertsChanged` element. A superset of the
 * shell's frozen `Alert`: the shell guard tolerates the extra keys.
 */
export interface AlertDto extends Alert {
  /** Host-relative "Details" target, or null. */
  readonly href: string | null
  readonly sourceChannel: ChannelId | null
  readonly contentId: string | null
  readonly expiresScenarioTime: string | null
}
export const ALERT_KEYS = wireKeys<AlertDto>()([
  'id', 'severity', 'message', 'scenarioTime', 'href', 'sourceChannel', 'contentId', 'expiresScenarioTime',
])

/** `AlertsChanged` frame: the full active set. */
export interface AlertsChangedDto {
  readonly alerts: readonly AlertDto[]
}
export const ALERTS_CHANGED_KEYS = wireKeys<AlertsChangedDto>()(['alerts'])

/** `ContentRevised` frame. No body; the client refetches the item. */
export interface ContentRevisedDto {
  readonly id: string
  readonly channelId: ChannelId
  readonly permalink: string
  readonly updatedScenarioTime: string | null
  readonly revisions: readonly ContentRevisionDto[]
  readonly headline: string
  readonly dek: string | null
}
export const CONTENT_REVISED_KEYS = wireKeys<ContentRevisedDto>()([
  'id', 'channelId', 'permalink', 'updatedScenarioTime', 'revisions', 'headline', 'dek',
])

/** `ContentRetracted` frame. */
export interface ContentRetractedDto {
  readonly id: string
  readonly channelId: ChannelId
  readonly permalink: string
  readonly retractedScenarioTime: string
}
export const CONTENT_RETRACTED_KEYS = wireKeys<ContentRetractedDto>()([
  'id', 'channelId', 'permalink', 'retractedScenarioTime',
])

/** `GET /api/link-previews` body. */
export interface LinkPreviewDto {
  readonly title: string
  /** FC-4 marks these two optional: the server sends `null`, a guard also accepts absent. */
  readonly description?: string | null
  readonly image?: ContentMediaDto | null
  readonly sourceName: string
  readonly permalink: string
}
export const LINK_PREVIEW_KEYS = wireKeys<LinkPreviewDto>()([
  'title', 'description', 'image', 'sourceName', 'permalink',
])

export interface PairedPostOptions {
  readonly text: string | null
}
export const PAIRED_POST_OPTIONS_KEYS = wireKeys<PairedPostOptions>()(['text'])

export interface PublishAlertOptions {
  readonly severity: Alert['severity']
  readonly headline: string | null
  readonly expiresScenarioTime: string | null
}
export const PUBLISH_ALERT_OPTIONS_KEYS = wireKeys<PublishAlertOptions>()([
  'severity', 'headline', 'expiresScenarioTime',
])

/** A publish's side effects (the staff dialog; persisted for scheduled / inject items, FC-7a). */
export interface PublishOptions {
  readonly pairedPost: PairedPostOptions | null
  readonly alert: PublishAlertOptions | null
}
export const PUBLISH_OPTIONS_KEYS = wireKeys<PublishOptions>()(['pairedPost', 'alert'])

/** Every pinned shape's key list, by its C# / golden-file name. */
export const WIRE_SHAPE_KEYS = {
  OutletRefDto: OUTLET_REF_KEYS,
  OutletDto: OUTLET_KEYS,
  ContentMediaDto: CONTENT_MEDIA_KEYS,
  ContentBylineDto: CONTENT_BYLINE_KEYS,
  ContentRevisionDto: CONTENT_REVISION_KEYS,
  ChannelContentSummaryDto: CHANNEL_CONTENT_SUMMARY_KEYS,
  ChannelContentDto: CHANNEL_CONTENT_KEYS,
  ChannelContentTombstoneDto: CHANNEL_CONTENT_TOMBSTONE_KEYS,
  ChannelContentListDto: CHANNEL_CONTENT_LIST_KEYS,
  ChannelContentStaffDto: CHANNEL_CONTENT_STAFF_KEYS,
  ContentMediaWriteRequest: CONTENT_MEDIA_WRITE_KEYS,
  ContentWriteRequest: CONTENT_WRITE_KEYS,
  AlertDto: ALERT_KEYS,
  AlertsChangedDto: ALERTS_CHANGED_KEYS,
  ContentRevisedDto: CONTENT_REVISED_KEYS,
  ContentRetractedDto: CONTENT_RETRACTED_KEYS,
  LinkPreviewDto: LINK_PREVIEW_KEYS,
  PublishOptions: PUBLISH_OPTIONS_KEYS,
  PairedPostOptions: PAIRED_POST_OPTIONS_KEYS,
  PublishAlertOptions: PUBLISH_ALERT_OPTIONS_KEYS,
} as const
