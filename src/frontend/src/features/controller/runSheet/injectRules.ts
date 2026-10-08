/**
 * features/controller/runSheet/injectRules.ts
 * ---------------------------------------------------------------------------
 * The pure rules of the run sheet (inject-queue story 07; CTL-010 lite, CTL-011,
 * CTL-014 lite, NFR-001). STAFF world, no UI, no React, no I/O — everything here
 * is a plain function so it is unit-testable and shared by the panel, the row,
 * the editor, the mock and the tests:
 *
 *   - `INJECT_LIMITS`      the authoring limits the server enforces (story 06);
 *                          the console mirrors them for fast feedback only — the
 *                          server stays authoritative and its 400 messages are
 *                          shown on the field/form too.
 *   - `countCodePoints`    the 280-char counter counts Unicode CODE POINTS, not
 *                          UTF-16 units (an emoji is 1, not 2).
 *   - `STATUS_*`           the status vocabulary: label + icon key. A status is
 *                          ALWAYS text + icon, never colour alone (NFR-001).
 *   - `can*`               which row actions the state machine allows (story 06:
 *                          hold, release, skip, unskip, retry, edit, delete, fire).
 *   - `filterItems` /
 *     `firstPending`       Mine/All + open/fired/all, and "Fire next" (the first
 *                          `pending` item in the CURRENT filter; held items are
 *                          passed over). "Mine" is a filter, not a lock (IQ-3).
 *   - `parseStoredFilters` the per-exercise localStorage payload, validated.
 *
 * No `exerciseId` anywhere: the server scopes everything (COR-001).
 */

import type { InjectItemDto, InjectItemWrite, InjectPostDto, InjectStatus } from './types'

/** Authoring limits (story 06 "Author and edit"). Mirrors the server; never loosens it. */
export const INJECT_LIMITS = {
  titleMax: 120,
  notesMax: 500,
  textMax: 280,
  burstMinPosts: 2,
  burstMaxPosts: 20,
  windowMin: 30,
  windowMax: 600,
  windowDefault: 90,
  mediaMax: 4,
  altMax: 1000,
  baselineMax: 1_000_000,
} as const

/**
 * Length in Unicode CODE POINTS. `'😀'.length` is 2 (two UTF-16 units) but it is
 * one code point, and the 280 limit (story 06) is a code-point limit.
 */
export function countCodePoints(text: string): number {
  return Array.from(text).length
}

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

/** Every item status, in the order a script usually moves through them. */
export const INJECT_STATUSES: readonly InjectStatus[] = [
  'pending',
  'held',
  'firing',
  'fired',
  'skipped',
  'failed',
]

export function isInjectStatus(value: unknown): value is InjectStatus {
  return typeof value === 'string' && (INJECT_STATUSES as readonly string[]).includes(value)
}

/** The status word shown on the chip (and in announcements). */
export const STATUS_LABEL: Readonly<Record<InjectStatus, string>> = {
  pending: 'Pending',
  held: 'Held',
  firing: 'Firing',
  fired: 'Fired',
  skipped: 'Skipped',
  failed: 'Failed',
}

/** The chip's text: "Firing 3/8" for a burst in flight, else the plain label. */
export function statusText(item: Pick<InjectItemDto, 'status' | 'firedCount' | 'total'>): string {
  return item.status === 'firing'
    ? `${STATUS_LABEL.firing} ${item.firedCount}/${item.total}`
    : STATUS_LABEL[item.status]
}

// ---------------------------------------------------------------------------
// State-machine capabilities (what the UI may offer)
// ---------------------------------------------------------------------------

/** Edits are accepted only while the item is pending, held or failed (story 06). */
export function isEditable(status: InjectStatus): boolean {
  return status === 'pending' || status === 'held' || status === 'failed'
}

/** Fire is offered for `pending` only (held -> release first; failed -> retry). */
export const canFire = (status: InjectStatus): boolean => status === 'pending'
/** `pending -> held`, and `firing -> held` for a burst (suspends its remaining posts). */
export const canHold = (status: InjectStatus): boolean => status === 'pending' || status === 'firing'
export const canRelease = (status: InjectStatus): boolean => status === 'held'
export const canSkip = (status: InjectStatus): boolean => status === 'pending' || status === 'held'
export const canUnskip = (status: InjectStatus): boolean => status === 'skipped'
export const canRetry = (status: InjectStatus): boolean => status === 'failed'
/** Delete is offered for pending / held / skipped only (the server also refuses fired/firing). */
export const canDelete = (status: InjectStatus): boolean =>
  status === 'pending' || status === 'held' || status === 'skipped'

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type ScopeFilter = 'mine' | 'all'
export type StatusFilter = 'open' | 'fired' | 'all'

export interface RunSheetFilters {
  readonly scope: ScopeFilter
  readonly status: StatusFilter
}

/** Defaults: everyone's items, every status (AC "defaults to All"). */
export const DEFAULT_FILTERS: RunSheetFilters = { scope: 'all', status: 'all' }

/**
 * `open` = still needs a decision or attention (pending, held, firing, failed);
 * `fired` = done; `all` = everything, including skipped (which is only reachable
 * here, so an Unskip is never more than a filter click away).
 */
const OPEN_STATUSES: readonly InjectStatus[] = ['pending', 'held', 'firing', 'failed']

export function matchesStatusFilter(status: InjectStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'fired') return status === 'fired'
  return OPEN_STATUSES.includes(status)
}

/**
 * Applies Mine/All + open/fired/all, in the server's `order`. "Mine" = items whose
 * `assigneeId` is the caller's staff id (`InjectAssigneesDto.me`); when `me` is not
 * known yet nothing is "mine" (fail closed — never show someone else's rows as mine).
 */
export function filterItems(
  items: readonly InjectItemDto[],
  filters: RunSheetFilters,
  me: string | undefined,
): InjectItemDto[] {
  return items
    .filter(item => filters.scope === 'all' || (me !== undefined && item.assigneeId === me))
    .filter(item => matchesStatusFilter(item.status, filters.status))
    .slice()
    .sort((a, b) => a.order - b.order)
}

/** "Fire next": the first `pending` item of the (already filtered) list; held ones are skipped. */
export function firstPending(items: readonly InjectItemDto[]): InjectItemDto | undefined {
  return items.find(item => item.status === 'pending')
}

// ---------------------------------------------------------------------------
// Persisted filters (per exercise, localStorage, always try/catch)
// ---------------------------------------------------------------------------

/** Validates a parsed localStorage payload; anything unexpected falls back to the defaults. */
export function parseStoredFilters(raw: unknown): RunSheetFilters {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_FILTERS
  const candidate = raw as { scope?: unknown; status?: unknown }
  const scope: ScopeFilter = candidate.scope === 'mine' ? 'mine' : 'all'
  const status: StatusFilter =
    candidate.status === 'open' || candidate.status === 'fired' ? candidate.status : 'all'
  return { scope, status }
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

/** "T+15" for `plannedMinute`, or an em dash when the item has no planned minute. */
export function plannedLabel(plannedMinute: number | undefined): string {
  return plannedMinute === undefined ? 'T+—' : `T+${plannedMinute}`
}

/** The first failed post's message, for a failed burst whose item-level `error` is empty. */
export function firstPostError(posts: readonly InjectPostDto[]): string | undefined {
  return posts.find(post => post.status === 'failed' && post.error)?.error
}

/** The text to show on a failed row: the server's reason, item-level first. */
export function failureReason(item: InjectItemDto): string | undefined {
  return item.error ?? firstPostError(item.posts)
}

/** Shortens `text` to `max` code points with an ellipsis (display only). */
export function excerpt(text: string, max: number): string {
  const points = Array.from(text)
  return points.length <= max ? text : `${points.slice(0, max).join('').trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Write validation (client mirror of story 06's validation matrix)
// ---------------------------------------------------------------------------

const isInteger = (n: number): boolean => Number.isInteger(n)

/**
 * Validates an `InjectItemWrite` against the authoring limits and returns
 * `{ fieldPath: message }` (empty = valid). Paths are dotted and match the
 * normalised server paths (`injectErrors.normalizeFieldPath`): `title`, `notes`,
 * `plannedMinute`, `burstWindowSeconds`, `posts`, `posts.0.personaId`,
 * `posts.0.text`, `posts.0.media`, `posts.0.media.1.alt`, `posts.0.replyTo`,
 * `posts.0.engagementBaseline`.
 *
 * Used by the editor (fast feedback before a round trip) AND the mock (so a mock
 * 400 reads like the server's). The server remains authoritative: its messages are
 * shown on the field/form as well, and nothing here loosens a server rule.
 */
export function validateWrite(write: InjectItemWrite): Record<string, string> {
  const errors: Record<string, string> = {}
  const L = INJECT_LIMITS

  if (write.title.trim().length === 0) errors.title = 'Give the item a title'
  else if (countCodePoints(write.title) > L.titleMax) {
    errors.title = `Title must be ${L.titleMax} characters or fewer`
  }

  if (write.notes !== undefined && countCodePoints(write.notes) > L.notesMax) {
    errors.notes = `Notes must be ${L.notesMax} characters or fewer`
  }

  if (write.plannedMinute !== undefined) {
    if (!isInteger(write.plannedMinute) || write.plannedMinute < 0) {
      errors.plannedMinute = 'T+N must be a whole number of minutes, 0 or more'
    }
  }

  const count = write.posts.length
  if (write.kind === 'post') {
    if (count !== 1) errors.posts = 'A single post needs exactly one post'
  } else {
    if (count < L.burstMinPosts || count > L.burstMaxPosts) {
      errors.posts = `A burst needs ${L.burstMinPosts} to ${L.burstMaxPosts} posts`
    }
    const w = write.burstWindowSeconds
    if (w !== undefined && (!isInteger(w) || w < L.windowMin || w > L.windowMax)) {
      errors.burstWindowSeconds = `Window must be ${L.windowMin} to ${L.windowMax} seconds`
    }
  }

  write.posts.forEach((post, i) => {
    const at = `posts.${i}`
    if (post.personaId.trim().length === 0) errors[`${at}.personaId`] = 'Choose a persona'

    const points = countCodePoints(post.text)
    if (post.text.trim().length === 0) errors[`${at}.text`] = 'Write the post text'
    else if (points > L.textMax) errors[`${at}.text`] = `Text is ${points - L.textMax} over the ${L.textMax} limit`

    const media = post.media ?? []
    if (media.length > L.mediaMax) errors[`${at}.media`] = `At most ${L.mediaMax} media per post`
    media.forEach((m, j) => {
      if (m.mediaId.trim().length === 0) errors[`${at}.media.${j}.mediaId`] = 'Media id is required'
      if (m.alt.trim().length === 0) errors[`${at}.media.${j}.alt`] = 'Alt text is required'
      else if (countCodePoints(m.alt) > L.altMax) {
        errors[`${at}.media.${j}.alt`] = `Alt text must be ${L.altMax} characters or fewer`
      }
    })

    const reply = post.replyTo
    if (reply) {
      if ('sequence' in reply) {
        // An EARLIER sibling of this item, 1-based: strictly before this post's own position.
        const own = i + 1
        if (!Number.isInteger(reply.sequence) || reply.sequence < 1 || reply.sequence >= own) {
          errors[`${at}.replyTo`] = 'Reply to an earlier post in this burst'
        }
      } else {
        const id = 'injectPostId' in reply ? reply.injectPostId : reply.postId
        if (id.trim().length === 0) errors[`${at}.replyTo`] = 'Choose the post to reply to'
      }
    }

    const baseline = post.engagementBaseline
    if (baseline) {
      for (const [key, value] of Object.entries(baseline)) {
        if (value !== undefined && (!isInteger(value) || value < 0 || value > L.baselineMax)) {
          errors[`${at}.engagementBaseline`] =
            `Engagement ${key} must be a whole number from 0 to ${L.baselineMax.toLocaleString('en-US')}`
        }
      }
    }
  })

  return errors
}
