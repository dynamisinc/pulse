/**
 * features/controller/noise/noiseService.ts
 * ---------------------------------------------------------------------------
 * The white-noise calls and the live push (demo-feedback story 09; backend story 05). STAFF
 * world, no UI.
 *
 *   - `fetchNoiseState()`  -> `GET /api/staff/noise` (any assigned staff role);
 *   - `putNoiseLevel(lvl)` -> `PUT /api/staff/noise { level }` (controller role; an evaluator gets
 *                             403, which is shown as words, story 11 hides the control later);
 *   - `subscribeNoiseState(onState, onResync)` -> the staff-group `NoiseStateChanged` frame on the
 *     ONE shared hub connection (`@/core/realtime/connection`; no second connection is opened),
 *     plus a resync on every (re)connect, the pattern `liveReviewStore` uses. The frame carries a
 *     whole `NoiseStateDto`, validated by `parseNoiseState` before anyone sees it.
 *
 * No request names an exercise (COR-001): the server resolves the scope from the session.
 *
 * MOCK <-> LIVE. Under `USE_MOCK_DATA` both calls go through `mockNoiseAdapter` on the same shared
 * axios client, and the push comes from the mock store instead of the hub (`noiseMock.ts`).
 *
 * ERRORS are sentences for a person (`NoiseRequestError.message`): the server's own ProblemDetails
 * `detail` for a 400, a fixed sentence per status otherwise, never a bare status code.
 */

import axios from 'axios'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { api } from '@/core/services/api'
import {
  HubConnectionState,
  realtimeConnection,
  type RealtimeConnection,
} from '@/core/realtime/connection'
import { mockNoiseAdapter, subscribeMockNoiseState } from './noiseMock'
import { parseNoiseState, type NoiseLevel, type NoiseStateDto } from './noiseTypes'

/** The route, relative to the API base (`/api`). */
export const NOISE_PATH = '/staff/noise'

/** The staff-group hub event (story 05's `NoiseBroadcaster.NoiseStateChangedEvent`). */
export const NOISE_STATE_CHANGED_EVENT = 'NoiseStateChanged'

const REQUEST_TIMEOUT_MS = 15_000

/** A failed white-noise read or write, with a message meant for the controller. */
export class NoiseRequestError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'NoiseRequestError'
    this.status = status
  }
}

const MAX_DETAIL_LENGTH = 300

/** The ProblemDetails `detail` when it is a short, single-line, non-markup sentence. */
export function problemDetailOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const detail = (data as { detail?: unknown }).detail
  if (typeof detail !== 'string') return undefined
  const text = detail.trim()
  if (text.length === 0 || text.length > MAX_DETAIL_LENGTH) return undefined
  if (/[\r\n]/.test(text) || /<\s*[a-z!/?]/i.test(text)) return undefined
  return text
}

function messageForStatus(status: number, action: 'read' | 'write'): string {
  switch (status) {
    case 400:
      return 'The server did not accept that white-noise level.'
    case 401:
      return 'Your console session has expired or has no exercise. Sign in again.'
    case 403:
      return action === 'write'
        ? 'Only a controller can change white noise.'
        : 'Only staff assigned to this exercise can see white noise.'
    case 404:
      return 'This exercise no longer exists.'
    default:
      return action === 'write'
        ? `White noise was not changed (the server answered ${status}).`
        : `White noise could not be read (the server answered ${status}).`
  }
}

/** Narrows any thrown failure to a {@link NoiseRequestError}. */
export function toNoiseRequestError(error: unknown, action: 'read' | 'write'): NoiseRequestError {
  if (error instanceof NoiseRequestError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === undefined) {
      return new NoiseRequestError(
        action === 'write'
          ? 'The server could not be reached. White noise was not changed.'
          : 'The server could not be reached, so white noise could not be read.',
      )
    }
    const detail = status === 400 ? problemDetailOf(error.response?.data) : undefined
    return new NoiseRequestError(detail ?? messageForStatus(status, action), status)
  }
  return new NoiseRequestError(
    action === 'write' ? 'White noise was not changed. Try again.' : 'White noise could not be read.',
  )
}

function mockOptions() {
  return USE_MOCK_DATA ? { adapter: mockNoiseAdapter } : {}
}

function parseOrThrow(data: unknown, action: 'read' | 'write'): NoiseStateDto {
  const state = parseNoiseState(data)
  if (state === undefined) {
    throw new NoiseRequestError(
      action === 'write'
        ? 'The server answered with a white-noise state the console does not understand.'
        : 'The server sent a white-noise state the console does not understand.',
    )
  }
  return state
}

/** Reads the resolved exercise's white-noise state. */
export async function fetchNoiseState(): Promise<NoiseStateDto> {
  try {
    const response = await api.get<unknown>(NOISE_PATH, {
      timeout: REQUEST_TIMEOUT_MS,
      ...mockOptions(),
    })
    return parseOrThrow(response.data, 'read')
  } catch (error) {
    throw toNoiseRequestError(error, 'read')
  }
}

/** Sets the level; resolves to the state the server reports afterwards. */
export async function putNoiseLevel(level: NoiseLevel): Promise<NoiseStateDto> {
  try {
    const response = await api.put<unknown>(
      NOISE_PATH,
      { level },
      { timeout: REQUEST_TIMEOUT_MS, ...mockOptions() },
    )
    return parseOrThrow(response.data, 'write')
  } catch (error) {
    throw toNoiseRequestError(error, 'write')
  }
}

/**
 * Listens for the live white-noise state. `onState` gets every valid `NoiseStateChanged` frame
 * (a malformed one is dropped); `onResync` is called on each hub (re)connect so the caller can
 * re-read what it may have missed. Returns an unsubscribe that detaches both.
 *
 * Live: attaches to the shared hub connection and makes sure it is started (idempotent; a start
 * failure is swallowed, the next reconnect resyncs). Mock: the mock store's push.
 */
export function subscribeNoiseState(
  onState: (state: NoiseStateDto) => void,
  onResync: () => void,
  connection: RealtimeConnection = realtimeConnection,
): () => void {
  if (USE_MOCK_DATA) return subscribeMockNoiseState(onState)

  const unsubscribePush = connection.subscribe(NOISE_STATE_CHANGED_EVENT, payload => {
    const state = parseNoiseState(payload)
    if (state !== undefined) onState(state)
  })
  const unsubscribeState = connection.onStateChange(state => {
    if (state === HubConnectionState.Connected) onResync()
  })
  void connection.start().catch(() => {
    // Hub unreachable: the GET still seeded the knob; a later reconnect resyncs.
  })
  return () => {
    unsubscribePush()
    unsubscribeState()
  }
}
