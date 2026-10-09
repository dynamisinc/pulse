/**
 * features/controller/services/takedownService.ts
 * ---------------------------------------------------------------------------
 * The controller's TAKEDOWN call (demo-polish C5, docs/features/demo-polish/22-takedown-ui.md;
 * CTL-025, DP-9, COR-001, XC-002). STAFF world — a pure service module: no UI, no COBRA, no
 * telemetry (the console's `useTakedown` emits the one `steering_action`, DP-9: the server emits
 * none).
 *
 * THE ENDPOINT (B6, implementation.md §1.5.5):
 *   `DELETE /api/staff/posts/{postId}?category=inappropriate|pii|real-world-reference|other`
 *   - `category` is a QUERY parameter, optional (absent means `other`) and matched EXACTLY and
 *     in lower case; anything else is a 400 whose body is a plain message. This client always
 *     sends one of the four values, so a 400 here means a client/server mismatch, shown to the
 *     controller verbatim;
 *   - 204 when the post is removed AND when it was already removed (idempotent: a repeat, a
 *     retry after a lost response, or a second controller all succeed with no second broadcast);
 *   - 404 for an unknown id or another exercise's id — the response is identical, so the UI
 *     says "no longer exists" and never hints which; 401 / 403 for an unresolved scope / a
 *     non-controller (the control is absent for non-controllers, so these are not expected).
 *   - NO CLIENT `exerciseId` (COR-001): scope is resolved server-side from the session. The
 *     post id is `encodeURIComponent`-ed into the path, defence in depth against an unexpected
 *     id corrupting the route.
 *   - BOUNDED: the shared axios instance has no default timeout, so a hung request would leave
 *     the row "Taking down…" for ever; the call carries {@link REQUEST_TIMEOUT_MS}.
 *
 * WHAT A SUCCESS DOES ON THIS CLIENT. After the 2xx the id is recorded in the session's
 * `removedPosts` store (`@/features/social/services/removedPosts`, a leaf module of opaque ids).
 * That is how the console row flips to "Removed" and stays that way if the row remounts (a
 * filter change), and how a participant feed mounted in the same tab (a staff preview, mock mode)
 * drops the post. The real participants learn of it from the server's `PostRemoved` broadcast, not
 * from this call.
 *
 * MOCK MODE (`USE_MOCK_DATA`; `npm run dev`). There is no server, so the call stands in for it so
 * the whole beat is demonstrable: it REMOVES the post from `postStore` (the mock backend's
 * soft delete: the feed read no longer returns it) and records the id in `removedPosts`, which is
 * what an open participant feed in the same tab reacts to. An id the store does not hold (and that
 * is not already removed) is the mock's 404, with the same message the UI shows for the real one;
 * a repeat of an already-removed id succeeds (idempotent, like the server).
 *
 * ERRORS. Every failure is a {@link TakedownError} carrying a controller-readable `message`
 * (rendered as TEXT, never HTML — NFR-001/NFR-004): the server's own message for a 400 (the
 * contract's `category must be one of: ...`), or a short single-line non-markup body for another
 * status; otherwise a plain sentence for the status or for a network failure. An HTML error page or
 * a stack trace is never shown. `status` is kept for callers that branch (none needs to today).
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'

/** The four incident categories the endpoint accepts (exact, lower-case). */
export type TakedownCategory = 'inappropriate' | 'pii' | 'real-world-reference' | 'other'

/** One category as the picker offers it: the wire value and its controller-facing label. */
export interface TakedownCategoryOption {
  readonly value: TakedownCategory
  readonly label: string
}

/** The picker's options, in the order the story lists them. */
export const TAKEDOWN_CATEGORIES: readonly TakedownCategoryOption[] = [
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'pii', label: 'PII' },
  { value: 'real-world-reference', label: 'Real-world reference' },
  { value: 'other', label: 'Other' },
]

/** The category pre-selected in the picker, and the server's own default for an absent one. */
export const DEFAULT_TAKEDOWN_CATEGORY: TakedownCategory = 'other'

/** Bounds a hung DELETE so the row cannot sit in "Taking down…" for ever. */
export const REQUEST_TIMEOUT_MS = 10_000

/**
 * True when the post has been taken down in this session (by this console, by another
 * controller's `PostRemoved` reaching this tab, or before the row mounted). A plain, NON-reactive
 * read of the session's `removedPosts` store — for a reactive one use `useRemovedPostIds` /
 * `useIsRowRemoved` (`../hooks/useRemovedPostIds`), which re-render their caller on change.
 */
export function isPostRemoved(postId: string): boolean {
  return removedPosts.has(postId)
}

/** True when `value` is one of the four wire categories (a runtime check for untyped input). */
export function isTakedownCategory(value: unknown): value is TakedownCategory {
  return TAKEDOWN_CATEGORIES.some(option => option.value === value)
}

/** A failed takedown. `message` is plain text meant to be shown to the controller as-is. */
export class TakedownError extends Error {
  /** The HTTP status, when the server answered (absent for a network failure or a mock error). */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'TakedownError'
    this.status = status
  }
}

const NOT_FOUND_MESSAGE = 'That post no longer exists in this exercise.'

/** A reason off a server error body: a bare string, or an object's message / detail / title. */
function serverMessageOf(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    }
  }
  return undefined
}

/** Longest 400 body shown (B6's own message is under 100 characters). */
const MAX_BAD_REQUEST_MESSAGE_LENGTH = 500

/** Longest body shown for any other status: a short sentence, never a page. */
const MAX_OTHER_MESSAGE_LENGTH = 200

/** True for text that looks like markup (an HTML error page from a proxy or front door). */
function looksLikeMarkup(text: string): boolean {
  return /<\s*[a-z!/?]/i.test(text)
}

/**
 * The server's own words, when they are safe and useful to show the controller. The contract
 * promises a message for the 400 (`category must be one of: ...`), shown verbatim. For any other
 * status only a SHORT, single-line, non-markup body qualifies: a 502 HTML page from a proxy or an
 * ASP.NET developer exception page (multi-line plain text with a stack trace) must never reach the
 * console as a wall of text. Anything else falls back to the staff copy for that status.
 */
function showableServerMessage(status: number, data: unknown): string | undefined {
  const text = serverMessageOf(data)
  if (text === undefined || looksLikeMarkup(text)) return undefined
  if (status === 400) return text.length <= MAX_BAD_REQUEST_MESSAGE_LENGTH ? text : undefined
  return text.length <= MAX_OTHER_MESSAGE_LENGTH && !/[\r\n]/.test(text) ? text : undefined
}

/** The plain sentence for a status the server answered without a usable message. */
function messageForStatus(status: number): string {
  if (status === 400) return 'The server did not accept that take down. Try again with another category.'
  if (status === 404) return NOT_FOUND_MESSAGE
  if (status === 401) return 'Your console session has expired. Sign in again to take this post down.'
  if (status === 403) return 'Only a controller assigned to this exercise can take a post down.'
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return 'The server is busy right now. Try again in a moment.'
  }
  return `The post was not taken down (the server answered ${status}).`
}

/** Narrows any thrown transport failure to a {@link TakedownError}. */
function toTakedownError(error: unknown): TakedownError {
  if (error instanceof TakedownError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === undefined) {
      return new TakedownError('The server could not be reached. Check the connection and try again.')
    }
    const reason = showableServerMessage(status, error.response?.data) ?? messageForStatus(status)
    return new TakedownError(reason, status)
  }
  return new TakedownError('The post was not taken down. Try again.')
}

/**
 * The mock backend's takedown: soft-deletes from `postStore`. An id the store does not hold is a
 * 404 unless it was already taken down (then it is the idempotent repeat).
 */
function takeDownInMockStore(postId: string): void {
  const present = postStore.removePost(postId)
  if (!present && !removedPosts.has(postId)) throw new TakedownError(NOT_FOUND_MESSAGE, 404)
}

/**
 * Takes the post down. Resolves once it is gone (or already was); rejects with a
 * {@link TakedownError}. On success the id is recorded in `removedPosts` (see the module header).
 * It emits no telemetry — the caller (`useTakedown`) emits the one `steering_action`.
 *
 * `category` defaults to `other`, matching the server's default for an absent one; a value that
 * is not one of the four rejects BEFORE any request (the server would answer 400 anyway).
 */
export async function takeDownPost(
  postId: string,
  category: TakedownCategory = DEFAULT_TAKEDOWN_CATEGORY,
): Promise<void> {
  if (postId.length === 0) throw new TakedownError(NOT_FOUND_MESSAGE, 404)
  if (!isTakedownCategory(category)) {
    throw new TakedownError(
      `category must be one of: ${TAKEDOWN_CATEGORIES.map(option => option.value).join(', ')}.`,
      400,
    )
  }

  if (USE_MOCK_DATA) {
    takeDownInMockStore(postId)
  } else {
    try {
      await api.delete(`/staff/posts/${encodeURIComponent(postId)}`, {
        params: { category },
        timeout: REQUEST_TIMEOUT_MS,
      })
    } catch (error) {
      throw toTakedownError(error)
    }
  }

  removedPosts.add(postId)
}
