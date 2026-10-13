/**
 * features/controller/lifecycle/lifecycleService.ts
 * ---------------------------------------------------------------------------
 * The controller's EXERCISE LIFECYCLE calls (demo-polish C6, docs/features/demo-polish/
 * 23-preview-and-startex.md, #442; exercise-configuration/03 COR-032; NFR-001, COR-001,
 * XC-002). STAFF world -- a pure service module: no UI, no COBRA, no telemetry (the SERVER
 * records the one lifecycle-transition event; see `useExerciseLifecycle`).
 *
 * THE ENDPOINTS (`Pulse.WebApi/Features/ExerciseConfiguration/Lifecycle/LifecycleEndpoints.cs`;
 * both are relative to the shared axios client's `/api` base):
 *
 *   GET  /api/staff/exercise-lifecycle
 *        -> 200 { exerciseId, state, storedStatus, allowedTransitions: string[], behaviour: {...} }
 *   POST /api/staff/exercise-lifecycle/transition   body { to }
 *        -> 200 (the same body, for the NEW state)
 *
 *   - `state` is the CANONICAL COR-032 literal -- build | staged | live | paused | completed |
 *     archived -- even when the stored row still carries a legacy one (`storedStatus` is the raw
 *     value and is ignored here). `allowedTransitions` are the states reachable FROM `state`
 *     (empty for the terminal `archived`); the SERVER is the state machine, this client never
 *     re-derives which button to offer from `state` alone.
 *   - THE STATE MACHINE: build -> staged -> live -> {paused, completed}; paused -> {live,
 *     completed}; completed -> archived. Anything else (a self-transition, a backward move, a
 *     shortcut) is a 409.
 *   - NO CLIENT `exerciseId` (COR-001): neither route takes the exercise from a route value, a
 *     query or the body -- it is the server-resolved scope. The body is `{ to }` and nothing else;
 *     there is deliberately no "from" (the machine reads the stored state itself).
 *   - STATUS CONTRACT: 200 | 400 (`to` missing / not a COR-032 literal; body is a plain JSON
 *     string) | 401 (no staff session, or unresolved scope) | 403 (staff, but not assigned to the
 *     resolved exercise) | 404 (the scope has no exercise row) | 409 (the machine refuses; body is
 *     a plain JSON string such as `'live' -> 'live' is not an allowed lifecycle transition
 *     (allowed from 'live': paused, completed).`). In every non-200 case NOTHING was persisted --
 *     which is why a refusal can be shown as final, and why this module never retries.
 *   - BOUNDED: the shared axios instance has no default timeout, so both calls carry
 *     {@link REQUEST_TIMEOUT_MS}; a hung request must not leave "Ending..." on screen for ever.
 *
 * ERRORS. Every failure is a {@link LifecycleError} whose `message` is plain text for the
 * controller (rendered as TEXT, never HTML -- NFR-001/NFR-004): the server's own sentence for a
 * 400 / 409 when it is short, single-line and not markup, otherwise a fixed sentence for the
 * status. An HTML error page or a stack trace is never shown.
 *
 * WHAT THIS UI ASKS FOR. Only `live` (Start exercise) and `completed` (End exercise):
 * {@link LifecycleTarget}. Pause / resume is the world-steering tier control, not this; build ->
 * staged and completed -> archived belong to exercise administration.
 */

import axios from 'axios'
import { api } from '@/core/services/api'

/** The COR-032 lifecycle vocabulary, canonical form (what the endpoints speak). */
export type LifecycleState = 'build' | 'staged' | 'live' | 'paused' | 'completed' | 'archived'

/** All six, in lifecycle order. */
export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  'build',
  'staged',
  'live',
  'paused',
  'completed',
  'archived',
]

/** The two transitions this console requests: StartEx and EndEx. */
export type LifecycleTarget = Extract<LifecycleState, 'live' | 'completed'>

/** True when `value` is one of the six canonical lifecycle literals. */
export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(value)
}

/** What the console needs of the lifecycle response: the state and what may happen next. */
export interface ExerciseLifecycle {
  readonly state: LifecycleState
  /** The states reachable from `state`, in the server's order. Unknown entries are dropped. */
  readonly allowedTransitions: readonly LifecycleState[]
}

/** `GET`/`POST` path, relative to the shared axios client's `/api` base. */
const LIFECYCLE_PATH = '/staff/exercise-lifecycle'
const TRANSITION_PATH = '/staff/exercise-lifecycle/transition'

/** Bounds a hung request (the shared axios instance has no default timeout). */
export const REQUEST_TIMEOUT_MS = 10_000

/** A failed lifecycle read or transition. `message` is plain text meant to be shown as-is. */
export class LifecycleError extends Error {
  /** The HTTP status, when the server answered (absent for a network failure or a mock error). */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LifecycleError'
    this.status = status
  }
}

/**
 * Parses and validates the wire body. FAILS CLOSED: a missing / unknown `state` rejects (the
 * console then says the state is unavailable rather than guessing one), and an unknown entry in
 * `allowedTransitions` is dropped, so a target this build does not know is never offered.
 */
export function parseLifecycle(data: unknown): ExerciseLifecycle {
  const body = data as { state?: unknown; allowedTransitions?: unknown } | null | undefined
  if (!isLifecycleState(body?.state)) {
    throw new LifecycleError('The server returned an exercise state this console does not recognise.')
  }
  const allowed = Array.isArray(body.allowedTransitions)
    ? body.allowedTransitions.filter(isLifecycleState)
    : []
  return { state: body.state, allowedTransitions: allowed }
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/** Longest server sentence shown (the machine's own 409 is under 200 characters). */
const MAX_SERVER_MESSAGE_LENGTH = 300

/** True for text that looks like markup (an HTML error page from a proxy or front door). */
function looksLikeMarkup(text: string): boolean {
  return /<\s*[a-z!/?]/i.test(text)
}

/** The server's own words, when safe and useful to show: a short, one-line, non-markup string. */
function showableServerMessage(data: unknown): string | undefined {
  if (typeof data !== 'string') return undefined
  const text = data.trim()
  if (text.length === 0 || text.length > MAX_SERVER_MESSAGE_LENGTH) return undefined
  if (/[\r\n]/.test(text) || looksLikeMarkup(text)) return undefined
  return text
}

/** The fixed sentence for a status the server answered without a usable message. */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'The server did not accept that change to the exercise state.'
    case 401:
      return 'Your console session has expired or has no exercise. Sign in again.'
    case 403:
      return 'Only a controller assigned to this exercise can change its state.'
    case 404:
      return 'This exercise no longer exists.'
    case 409:
      return 'The exercise is not in a state that allows that change. Its state was refreshed.'
    case 408:
    case 429:
    case 502:
    case 503:
    case 504:
      return 'The server is busy right now. Try again in a moment.'
    default:
      return `The exercise state was not changed (the server answered ${status}).`
  }
}

/** Narrows any thrown transport failure to a {@link LifecycleError}. */
export function toLifecycleError(error: unknown): LifecycleError {
  if (error instanceof LifecycleError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === undefined) {
      return new LifecycleError(
        'The server could not be reached. Check the connection and try again.',
      )
    }
    // Only a 400 / 409 carries a sentence meant for a person (the machine's own refusal).
    const reason = status === 400 || status === 409
      ? showableServerMessage(error.response?.data)
      : undefined
    return new LifecycleError(reason ?? messageForStatus(status), status)
  }
  return new LifecycleError('The exercise state could not be read or changed. Try again.')
}

// -----------------------------------------------------------------------------
// The calls
// -----------------------------------------------------------------------------

/** Reads the resolved exercise's lifecycle state and the transitions allowed from it. */
export async function fetchLifecycle(): Promise<ExerciseLifecycle> {
  try {
    const response = await api.get<unknown>(LIFECYCLE_PATH, { timeout: REQUEST_TIMEOUT_MS })
    return parseLifecycle(response.data)
  } catch (error) {
    throw toLifecycleError(error)
  }
}

/**
 * Asks the server to move the resolved exercise to `to`. Resolves with the lifecycle of the NEW
 * state (the endpoint's 200 body); rejects with a {@link LifecycleError} -- and nothing was
 * persisted -- on every other outcome.
 */
export async function postTransition(to: LifecycleTarget): Promise<ExerciseLifecycle> {
  try {
    const response = await api.post<unknown>(
      TRANSITION_PATH,
      { to },
      { timeout: REQUEST_TIMEOUT_MS },
    )
    return parseLifecycle(response.data)
  } catch (error) {
    throw toLifecycleError(error)
  }
}
