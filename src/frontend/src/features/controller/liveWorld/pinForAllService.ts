/**
 * features/controller/liveWorld/pinForAllService.ts
 * ---------------------------------------------------------------------------
 * The controller's PIN FOR EVERYONE call (story 08, DF-7; backend story 04). STAFF
 * world, a pure service: no UI, no COBRA, no telemetry (the server records
 * `post.pinned` / `post.unpinned`, implementation.md "Telemetry").
 *
 * THE ENDPOINT (frozen contract, implementation.md "Routes" / "Types"):
 *   `PUT    /api/staff/posts/{postId}/pin`  pins the post for everyone   -> 204
 *   `DELETE /api/staff/posts/{postId}/pin`  unpins it                    -> 204
 *   404 when the post is not in the exercise or has been taken down; 401 / 403 for an
 *   expired session / a non-controller. Staff + controller role only. NO client
 *   `exerciseId` (COR-001): the session binds the exercise server-side. The id is
 *   `encodeURIComponent`-ed into the path, and every call is bounded by
 *   {@link PIN_REQUEST_TIMEOUT_MS} (the shared axios instance has no default timeout).
 *
 * The server broadcasts `PostPinChanged` to the exercise group, which is how OTHER
 * consoles (and participants' Pinned tabs) learn of it; this console applies its own
 * change from the 2xx straight away.
 *
 * MOCK MODE (`USE_MOCK_DATA`). No server: the call succeeds, except for a post this
 * session has taken down (the server's 404), so the beat is demonstrable on mocks.
 *
 * ERRORS. Every failure is a {@link PinForAllError} whose `message` is a plain sentence
 * for the controller, shown as TEXT (never HTML, NFR-004). A server body is shown only
 * when it is a short single-line non-markup message; otherwise the staff copy for the
 * status is used. Nothing is swallowed: the caller renders the message in the row.
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { removedPosts } from '@/features/social/services/removedPosts'

/** Bounds a hung PUT/DELETE so the row cannot sit in "Pinning…" for ever. */
export const PIN_REQUEST_TIMEOUT_MS = 10_000

/** A failed pin or unpin. `message` is plain text meant to be shown as-is. */
export class PinForAllError extends Error {
  /** The HTTP status, when the server answered. */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PinForAllError'
    this.status = status
  }
}

/** The sentence for a busy server or a timed-out request. */
const BUSY_MESSAGE = 'The server is busy right now. Try again in a moment.'

/** Longest server message shown (a sentence, never a page). */
const MAX_SERVER_MESSAGE_LENGTH = 200

/** The server's own words, when short, single-line and not markup. */
function showableServerMessage(data: unknown): string | undefined {
  let text: string | undefined
  if (typeof data === 'string') {
    text = data.trim()
  } else if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        text = value.trim()
        break
      }
    }
  }
  if (text === undefined || text.length === 0) return undefined
  if (text.length > MAX_SERVER_MESSAGE_LENGTH || /[\r\n]/.test(text)) return undefined
  if (/<\s*[a-z!/?]/i.test(text)) return undefined
  return text
}

/** The staff sentence for a status the server answered without a usable message. */
function messageForStatus(status: number, pin: boolean): string {
  if (status === 404) return 'That post no longer exists in this exercise, or it was taken down.'
  if (status === 401) return 'Your console session has expired. Sign in again.'
  if (status === 403) return 'Only a controller assigned to this exercise can pin posts for everyone.'
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return BUSY_MESSAGE
  }
  return `The post was not ${pin ? 'pinned' : 'unpinned'} (the server answered ${status}).`
}

/** Narrows any thrown transport failure to a {@link PinForAllError}. */
function toPinError(error: unknown, pin: boolean): PinForAllError {
  if (error instanceof PinForAllError) return error
  if (axios.isAxiosError(error)) {
    // A request that timed out (our own bound, or the browser's) is "busy, try again".
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new PinForAllError(BUSY_MESSAGE)
    }
    const status = error.response?.status
    if (status === undefined) {
      return new PinForAllError('The server could not be reached. Check the connection and try again.')
    }
    const reason = (status === 400 ? showableServerMessage(error.response?.data) : undefined)
      ?? messageForStatus(status, pin)
    return new PinForAllError(reason, status)
  }
  return new PinForAllError(`The post was not ${pin ? 'pinned' : 'unpinned'}. Try again.`)
}

/**
 * Pins (`pinned: true`) or unpins (`false`) the post for everyone. Resolves on success;
 * rejects with a {@link PinForAllError}.
 */
export async function setPinnedForAll(postId: string, pinned: boolean): Promise<void> {
  if (postId.length === 0) {
    throw new PinForAllError('That post no longer exists in this exercise.', 404)
  }
  if (USE_MOCK_DATA) {
    if (removedPosts.has(postId)) {
      throw new PinForAllError(messageForStatus(404, pinned), 404)
    }
    return
  }
  const url = `/staff/posts/${encodeURIComponent(postId)}/pin`
  try {
    if (pinned) await api.put(url, undefined, { timeout: PIN_REQUEST_TIMEOUT_MS })
    else await api.delete(url, { timeout: PIN_REQUEST_TIMEOUT_MS })
  } catch (error) {
    throw toPinError(error, pinned)
  }
}
