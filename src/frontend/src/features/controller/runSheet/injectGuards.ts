/**
 * features/controller/runSheet/injectGuards.ts
 * ---------------------------------------------------------------------------
 * Runtime narrowing of the inject-queue wire bodies (staff world, no UI).
 *
 * WHY. The live service reads `GET /api/injects` every ~3 s and renders what it
 * gets. A body that is NOT the frozen contract — an HTML 200 from a SPA fallback
 * when `/api` is not routed, a backend that is a version behind, a status literal
 * this build does not know — must FAIL CLOSED and visibly (the panel shows its
 * "can't reach the run sheet" notice) rather than render a half-parsed row or,
 * worse, an empty sheet that reads as "nothing scripted". Same rule the other live
 * seams follow (`livePauseTierActions.parseState`, `resolveStaffPersonas`).
 *
 * Deliberately a LIGHT structural check (the fields the UI reads to decide what to
 * render and which actions to offer), not a full schema: the server owns validation.
 *
 * CHILDREN ARE CHECKED TOO. An item whose child lacks an `id`, `personaId`, `text`,
 * `sequence` or a known `status`, or has a malformed `media` / `replyTo` /
 * `engagementBaseline`, is MALFORMED and is never rendered: a row built from
 * it would show "Unknown persona" or offer an action it cannot honour. What happens next
 * depends on where it arrived:
 *   - a queue read (`parseInjectQueue`) DROPS the malformed item and keeps every other
 *     one: one odd row must not blank the run sheet in the middle of an exercise. The
 *     dropped ids come back with the read (`droppedItemIds`) so the panel can SHOW a
 *     staff-only warning (a silently shorter sheet would read as "nothing scripted"),
 *     and the service logs them. Only a malformed TOP-LEVEL shape (no `items` array, an
 *     unknown `pauseTier`) rejects the read, as before;
 *   - a 409's `item` (`isInjectItemDto`) is DROPPED, so the console falls back to the
 *     polled copy rather than patching a broken row into the cache.
 */

import type { InjectAssigneesDto, InjectItemDto, InjectQueueDto } from './types'
import { isInjectPostStatus, isInjectStatus } from './injectRules'

const PAUSE_TIERS: readonly string[] = ['running', 'injects', 'engine', 'freeze']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `null` is "absent": the server may write explicit nulls for optional members. */
const isAbsent = (value: unknown): boolean => value === undefined || value === null

/** `media`: absent, or an array of `{ mediaId, alt }` string pairs (no `null` entries). */
function isMediaList(value: unknown): boolean {
  if (isAbsent(value)) return true
  return (
    Array.isArray(value) &&
    value.every(entry => isRecord(entry) && typeof entry.mediaId === 'string' && typeof entry.alt === 'string')
  )
}

/**
 * `replyTo`: absent, or an object naming its target by `sequence` (whole, >= 1), `injectPostId` or
 * `postId`; at least one, and every one present must have the right type. The editor reads it with
 * `in` checks (`draftFromItem`), which throw on a string or `null`.
 */
function isReplyTo(value: unknown): boolean {
  if (isAbsent(value)) return true
  if (!isRecord(value) || Array.isArray(value)) return false
  const named = ['sequence', 'injectPostId', 'postId'].filter(key => key in value)
  if (named.length === 0) return false
  return (
    (!('sequence' in value) ||
      (typeof value.sequence === 'number' && Number.isInteger(value.sequence) && value.sequence >= 1)) &&
    (!('injectPostId' in value) || typeof value.injectPostId === 'string') &&
    (!('postId' in value) || typeof value.postId === 'string')
  )
}

/** `engagementBaseline`: absent, or an object whose like / repost / reply are numbers. */
function isBaseline(value: unknown): boolean {
  if (isAbsent(value)) return true
  if (!isRecord(value) || Array.isArray(value)) return false
  return ['like', 'repost', 'reply'].every(key => isAbsent(value[key]) || typeof value[key] === 'number')
}

/**
 * Whether `value` carries what a child needs to render and be edited: the required scalars
 * (id, persona, text, sequence, status) AND well-formed NESTED fields (media, replyTo,
 * engagementBaseline). The nested ones matter: the editor maps `media` and probes `replyTo` with
 * `in`, so `media: 'x'`, `media: [null]` or `replyTo: 'x'` would crash the panel on Edit / View.
 */
export function isInjectPostDto(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.personaId === 'string' && value.personaId.length > 0 &&
    typeof value.text === 'string' &&
    typeof value.sequence === 'number' && Number.isInteger(value.sequence) && value.sequence >= 1 &&
    isInjectPostStatus(value.status) &&
    isMediaList(value.media) &&
    isReplyTo(value.replyTo) &&
    isBaseline(value.engagementBaseline)
  )
}

/** Whether `value` carries the fields a row needs (id, status, counts, version, valid posts). */
export function isInjectItemDto(value: unknown): value is InjectItemDto {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.title === 'string' &&
    (value.kind === 'post' || value.kind === 'burst') &&
    isInjectStatus(value.status) &&
    typeof value.order === 'number' &&
    typeof value.version === 'number' &&
    typeof value.firedCount === 'number' &&
    typeof value.total === 'number' &&
    Array.isArray(value.posts) &&
    value.posts.every(isInjectPostDto)
  )
}

/**
 * A queue read as the console uses it: the frozen `InjectQueueDto` plus, when the server sent
 * rows this build cannot render, the ids of the rows that were dropped. `droppedItemIds` is
 * NOT part of the wire contract (the server never sends it); it is added here, only on read.
 */
export interface InjectQueueRead extends InjectQueueDto {
  readonly droppedItemIds?: readonly string[]
}

/** The id to report for a dropped element (never its content, which may be free text). */
function describeDropped(value: unknown): string {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    ? value.id
    : '(no id)'
}

/**
 * Parses a `GET /injects` (or reorder) body. A malformed TOP-LEVEL shape (not an object, no
 * `items` array, an unknown `pauseTier`) returns `undefined` — the caller treats the read as
 * failed. Otherwise every well-formed item is kept in order and each malformed one is dropped
 * and reported in `droppedItemIds`.
 */
export function parseInjectQueue(value: unknown): InjectQueueRead | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  if (typeof value.pauseTier !== 'string' || !PAUSE_TIERS.includes(value.pauseTier)) return undefined

  const items: InjectItemDto[] = []
  const dropped: string[] = []
  for (const candidate of value.items) {
    if (isInjectItemDto(candidate)) items.push(candidate)
    else dropped.push(describeDropped(candidate))
  }
  const pauseTier = value.pauseTier as InjectQueueDto['pauseTier']
  return dropped.length === 0
    ? { items, pauseTier }
    : { items, pauseTier, droppedItemIds: dropped }
}

export function isInjectAssigneesDto(value: unknown): value is InjectAssigneesDto {
  if (!isRecord(value)) return false
  return (
    typeof value.me === 'string' &&
    Array.isArray(value.assignees) &&
    value.assignees.every(
      a => isRecord(a) && typeof a.id === 'string' && typeof a.displayName === 'string',
    )
  )
}
