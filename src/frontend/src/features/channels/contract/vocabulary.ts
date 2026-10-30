/**
 * features/channels/contract/vocabulary.ts
 * ---------------------------------------------------------------------------
 * FC-1, the frozen channels vocabulary (channels-foundation story 02, #698;
 * see docs/features/channels-foundation/implementation.md). The TS twin of
 * `Features/Channels/Contracts/ChannelVocabulary.cs`: every list here equals
 * the C# list, both pinned by `wireContract.json` (wireContract.test.ts on
 * this side, ChannelContractParityTests on the server).
 *
 * Additive-only after Wave 1, through the orchestrator. The guards are
 * CLOSED over these lists (fail-closed), so a new content kind is a
 * both-sides vocabulary change: add it here, in `ChannelVocabulary.cs` and in
 * `wireContract.json` together, and ship the client with or before the first
 * server that emits it.
 *
 * World: both (types only). No React, no MUI.
 */

/** Every participant channel id — the existing `ChannelCatalog` ids, unchanged. */
export const CHANNEL_IDS = ['social', 'portal', 'news', 'press', 'weather'] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]

/** The channels that own content items. Portal aggregates and owns none (Q7). */
export const CONTENT_CHANNEL_IDS = ['news', 'press', 'weather'] as const
export type ContentChannelId = (typeof CONTENT_CHANNEL_IDS)[number]

/** The December content kinds (an additive registry). */
export const CONTENT_KINDS = ['article', 'release', 'weather_product', 'forecast'] as const
export type ContentKind = (typeof CONTENT_KINDS)[number]

/** Lifecycle status. Staff-only: never on a participant DTO. */
export const CONTENT_STATUSES = ['draft', 'scheduled', 'published', 'retracted'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/** The only states a participant DTO carries (XC-002). */
export const PARTICIPANT_CONTENT_STATES = ['published', 'retracted'] as const
export type ParticipantContentState = (typeof PARTICIPANT_CONTENT_STATES)[number]

/** Provenance. Staff-only (XC-002). `engine` items always land as `draft`. */
export const CONTENT_ORIGINS = ['controller', 'participant', 'engine', 'inject'] as const
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number]

/**
 * Revision kinds. `edit` is draft history and never moves the Updated stamp;
 * `update` / `correction` move it and add a `revisions[]` entry;
 * `silent_rewrite` moves it with no entry (news FU-1).
 */
export const REVISION_KINDS = ['edit', 'update', 'correction', 'silent_rewrite'] as const
export type RevisionKind = (typeof REVISION_KINDS)[number]

/** The revision kinds a participant sees in `revisions[]`. */
export const PARTICIPANT_REVISION_KINDS = ['update', 'correction'] as const
export type ParticipantRevisionKind = (typeof PARTICIPANT_REVISION_KINDS)[number]

/** The revision kinds that move `updatedScenarioTime` (FC-1 Updated stamp rule). */
export const STAMP_MOVING_REVISION_KINDS = ['update', 'correction', 'silent_rewrite'] as const

/** Alert severities, frozen by the shell (`AlertBar/alertTypes.ts`). */
export const ALERT_SEVERITIES = ['info', 'advisory', 'emergency'] as const

/** Media roles on a content item. */
export const MEDIA_ROLES = ['hero', 'inline', 'attachment'] as const
export type MediaRole = (typeof MEDIA_ROLES)[number]

/** Media kinds. `document` is E5's download-only PDF attachment. */
export const CONTENT_MEDIA_KINDS = ['image', 'video', 'document'] as const
export type ContentMediaKind = (typeof CONTENT_MEDIA_KINDS)[number]

/** FC-5 client event names on the existing exercise hub. */
export const CHANNEL_REALTIME_EVENTS = [
  'ContentPublished',
  'ContentRevised',
  'ContentRetracted',
  'AlertsChanged',
] as const
export type ChannelRealtimeEvent = (typeof CHANNEL_REALTIME_EVENTS)[number]

/** The longest FC-1 slug. */
export const SLUG_MAX_LENGTH = 80

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/

/** Whether `value` is an FC-1 slug: `[a-z0-9-]{1,80}`. */
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value)
}

function isOneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
}

export const isChannelId = isOneOf(CHANNEL_IDS)
export const isContentChannelId = isOneOf(CONTENT_CHANNEL_IDS)
export const isContentKind = isOneOf(CONTENT_KINDS)
export const isContentStatus = isOneOf(CONTENT_STATUSES)
export const isContentOrigin = isOneOf(CONTENT_ORIGINS)
export const isRevisionKind = isOneOf(REVISION_KINDS)
export const isParticipantRevisionKind = isOneOf(PARTICIPANT_REVISION_KINDS)
export const isMediaRole = isOneOf(MEDIA_ROLES)
export const isContentMediaKind = isOneOf(CONTENT_MEDIA_KINDS)
