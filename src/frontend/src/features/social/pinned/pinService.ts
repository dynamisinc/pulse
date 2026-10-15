/**
 * features/social/pinned/pinService.ts
 * ---------------------------------------------------------------------------
 * The personal Pin WRITE seam (demo-feedback story 07; DF-6). Participant world -
 * pure service module, no UI. Routed through the shared axios client with a mock
 * adapter PER CALL behind the existing `USE_MOCK_DATA` switch, exactly like
 * `services/reactionService.ts` (the like / repost seam this mirrors).
 *
 * THE WIRE CONTRACT (implementation.md, story 04). A personal pin IS a reaction of kind
 * `pin`, on the existing reaction route:
 *   - `PUT    /api/posts/{postId}/reactions/pin` -> pin for myself
 *   - `DELETE /api/posts/{postId}/reactions/pin` -> unpin
 * Both answer `200` + `ReactionStateDto { postId, kind: 'pin', active, counts, viewer }`.
 * Idempotent. A pin never moves `counts` and nobody else ever sees it (DF-6), so the client
 * reconciles on `active` only and shows no count. Participant sessions with a bound persona
 * only; the server derives the persona and the exercise from the session.
 *
 * NO IDENTITY ON THE WIRE (COR-001/XC-002): no body, no query string - no `exerciseId`,
 * `personaId` or time. Post ids are opaque and URL-encoded.
 *
 * NO CLIENT TELEMETRY: the server emits `post.pinned` / `post.unpinned {scope:'personal'}`.
 *
 * FAIL CLOSED: a 2xx whose body is not a pin state for THIS post rejects, so the caller
 * rolls back rather than trust it.
 *
 * MOCK ADAPTER: records the state in `mockPins` (so the mock Pinned tab lists it) and
 * answers with the server's shape. `setMockPinFailure(true)` makes it reject with a 503.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { isMockPinFailing, recordMockPersonalPin } from './mockPins'

/** What the client reconciles a pin write onto: the state after the call. */
export interface PinState {
  readonly postId: string
  /** Whether the viewer's personal pin is on after the call. */
  readonly active: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The 200 body must be a `pin` state for the post that was asked about. */
function toPinState(data: unknown, postId: string): PinState | null {
  if (!isRecord(data)) return null
  if (data.postId !== postId || data.kind !== 'pin' || typeof data.active !== 'boolean') return null
  return { postId, active: data.active }
}

function mockAdapterFor(postId: string, wantActive: boolean): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    if (isMockPinFailing()) {
      const response = {
        data: { error: 'mock pin failure' },
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
        config,
      }
      return Promise.reject(
        new AxiosError('mock pin failure', AxiosError.ERR_BAD_RESPONSE, config, null, response),
      )
    }
    recordMockPersonalPin(postId, wantActive)
    // The server's shape. Counts are not the client's to reconcile for a pin (DF-6).
    const data = {
      postId,
      kind: 'pin',
      active: wantActive,
      counts: { reply: 0, repost: 0, like: 0 },
      viewer: { liked: false, reposted: false, pinned: wantActive },
    }
    return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
  }
}

async function writePin(method: 'put' | 'delete', postId: string): Promise<PinState> {
  const url = `/posts/${encodeURIComponent(postId)}/reactions/pin`
  const config = USE_MOCK_DATA ? { adapter: mockAdapterFor(postId, method === 'put') } : undefined
  const response =
    method === 'put'
      ? await api.put<unknown>(url, undefined, config)
      : await api.delete<unknown>(url, config)
  const state = toPinState(response.data, postId)
  if (state === null) {
    throw new Error(`${method === 'put' ? 'putPin' : 'deletePin'}: malformed pin state`)
  }
  return state
}

/** Pins `postId` for the viewer (`PUT`). Rejects on a non-2xx or a malformed body. */
export function putPin(postId: string): Promise<PinState> {
  return writePin('put', postId)
}

/** Removes the viewer's pin on `postId` (`DELETE`). See {@link putPin}. */
export function deletePin(postId: string): Promise<PinState> {
  return writePin('delete', postId)
}
