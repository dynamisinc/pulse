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
 * `sequence` or a known `status` is MALFORMED and is never rendered: a row built from
 * it would show "Unknown persona" or offer an action it cannot honour. What happens next
 * depends on where it arrived:
 *   - a queue read (`isInjectQueueDto`) is rejected as a whole, so the panel says it
 *     cannot load (or keeps the last good rows and says contact was lost) instead of
 *     silently showing a sheet with a scripted item missing;
 *   - a 409's `item` (`isInjectItemDto`) is DROPPED, so the console falls back to the
 *     polled copy rather than patching a broken row into the cache.
 */

import type { InjectAssigneesDto, InjectItemDto, InjectQueueDto } from './types'
import { isInjectPostStatus, isInjectStatus } from './injectRules'

const PAUSE_TIERS: readonly string[] = ['running', 'injects', 'engine', 'freeze']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether `value` carries what a child needs to render and be edited (id, persona, text...). */
export function isInjectPostDto(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.personaId === 'string' && value.personaId.length > 0 &&
    typeof value.text === 'string' &&
    typeof value.sequence === 'number' && Number.isInteger(value.sequence) && value.sequence >= 1 &&
    isInjectPostStatus(value.status)
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

export function isInjectQueueDto(value: unknown): value is InjectQueueDto {
  if (!isRecord(value)) return false
  return (
    Array.isArray(value.items) &&
    value.items.every(isInjectItemDto) &&
    typeof value.pauseTier === 'string' &&
    PAUSE_TIERS.includes(value.pauseTier)
  )
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
