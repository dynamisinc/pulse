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
 * WHAT THIS UI ASKS FOR. `staged` (planner's Stage exercise, exercise-build-golive story 04),
 * `live` (Start exercise) and `completed` (End exercise): {@link LifecycleTarget}. Pause / resume
 * is the world-steering tier control, not this; completed -> archived belongs to exercise
 * administration.
 *
 * THE READINESS-BLOCKING 409 (story 04). Staging is refused when blocking readiness items are
 * open: 409 `{ error: 'readiness-blocking', message, blocking: ReadinessItem[] }`. It becomes a
 * {@link LifecycleError} with `kind: 'readiness-blocking'` and the validated `blocking` items.
 * A body that is not exactly that shape falls back to the generic 409 handling (fail closed).
 * Stage is planner-only and StartEx controller-only (403 otherwise); StartEx is NOT gated.
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import {
  isReadinessItem,
  type ReadinessItem,
} from '@/features/planner/services/readinessService'

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

/**
 * The transitions the client requests: Stage (planner, readiness-gated -- exercise-build-golive
 * story 04), StartEx and EndEx (controller).
 */
export type LifecycleTarget = Extract<LifecycleState, 'staged' | 'live' | 'completed'>

/** True when `value` is one of the six canonical lifecycle literals. */
export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(value)
}

/** What the console needs of the lifecycle response: the state and what may happen next. */
export interface ExerciseLifecycle {
  /**
   * The exercise the SERVER resolved this answer for (the body's `exerciseId` echo), when it sent
   * one. It is never an input -- the console cannot choose an exercise (COR-001) -- but it lets the
   * console notice that the server's exercise is not the one it is showing: a second tab whose
   * session switched the active exercise. See {@link sameExercise}. Absent from mock data.
   */
  readonly exerciseId?: string
  readonly state: LifecycleState
  /** The states reachable from `state`, in the server's order. Unknown entries are dropped. */
  readonly allowedTransitions: readonly LifecycleState[]
}

/**
 * Whether the exercise a lifecycle answer was resolved for is the one the console is showing.
 * `undefined` (no echo -- mock data, an older server) matches: there is nothing to contradict.
 * Compared case-insensitively on trimmed text so a GUID's casing can never HIDE the control.
 */
export function sameExercise(answerFor: string | undefined, shown: string): boolean {
  if (answerFor === undefined) return true
  return answerFor.trim().toLowerCase() === shown.trim().toLowerCase()
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
  /**
   * `'readiness-blocking'` when the server refused a STAGE because blocking readiness items are
   * open (409 `{ error: 'readiness-blocking', message, blocking }`); `undefined` for every other
   * failure. When set, {@link blocking} is the validated, non-empty list of those items.
   */
  readonly kind: 'readiness-blocking' | undefined
  readonly blocking: readonly ReadinessItem[] | undefined

  constructor(
    message: string,
    status?: number,
    blocking?: readonly ReadinessItem[],
  ) {
    super(message)
    this.name = 'LifecycleError'
    this.status = status
    this.kind = blocking === undefined ? undefined : 'readiness-blocking'
    this.blocking = blocking
  }
}

/** Fixed sentence when the server's refusal carries no usable message of its own. */
const READINESS_BLOCKING_FALLBACK =
  'The exercise cannot be staged yet: blocking readiness items are still open.'

/**
 * Parses the readiness-blocking 409 body. FAILS CLOSED: anything that is not exactly
 * `{ error: 'readiness-blocking', blocking: ReadinessItem[1..] }` returns `undefined`, and the
 * caller falls back to the generic 409 handling. Returns the error to throw otherwise.
 */
function parseReadinessBlocking(data: unknown): LifecycleError | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const body = data as Record<string, unknown>
  if (body.error !== 'readiness-blocking') return undefined
  if (!Array.isArray(body.blocking) || body.blocking.length === 0) return undefined
  // Every listed item must be a valid item AND open: the body means "these items are blocking".
  if (!body.blocking.every(item => isReadinessItem(item) && item.status === 'open')) return undefined
  const message = showableServerMessage(body.message) ?? READINESS_BLOCKING_FALLBACK
  return new LifecycleError(message, 409, body.blocking)
}

/**
 * Parses and validates the wire body. FAILS CLOSED: a missing / unknown `state` rejects (the
 * console then says the state is unavailable rather than guessing one), and an unknown entry in
 * `allowedTransitions` is dropped, so a target this build does not know is never offered.
 */
export function parseLifecycle(data: unknown): ExerciseLifecycle {
  const body = data as
    | { exerciseId?: unknown; state?: unknown; allowedTransitions?: unknown }
    | null
    | undefined
  if (!isLifecycleState(body?.state)) {
    throw new LifecycleError('The server returned an exercise state this console does not recognise.')
  }
  const allowed = Array.isArray(body.allowedTransitions)
    ? body.allowedTransitions.filter(isLifecycleState)
    : []
  const exerciseId = typeof body.exerciseId === 'string' && body.exerciseId.length > 0
    ? body.exerciseId
    : undefined
  return exerciseId === undefined
    ? { state: body.state, allowedTransitions: allowed }
    : { exerciseId, state: body.state, allowedTransitions: allowed }
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
      // The server admits any STAFF assigned to the exercise (not only controllers) until #481
      // narrows the transition route; do not promise more than it enforces.
      return 'Only staff assigned to this exercise can change its state.'
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
    // A STAGE refused for open blocking readiness items is a typed variant with its item list.
    if (status === 409) {
      const blocked = parseReadinessBlocking(error.response?.data)
      if (blocked !== undefined) return blocked
    }
    // Only a 400 / 409 carries a sentence meant for a person (the machine's own refusal).
    const reason = status === 400 || status === 409
      ? showableServerMessage(error.response?.data)
      : undefined
    return new LifecycleError(reason ?? messageForStatus(status), status)
  }
  return new LifecycleError('The exercise state could not be read or changed. Try again.')
}

/**
 * Whether a FAILED transition leaves this console unsure what state the exercise is in, so it
 * must ask the server again instead of trusting what it last drew:
 *   - `409` -- the machine refused because the state had already moved (another controller got
 *     there first): the console's view was stale;
 *   - no status at all (a network failure or timeout), `408` and any `5xx` -- the request may
 *     well have been APPLIED and only its answer lost (a proxy cut the response, the server
 *     committed and then failed), so "it failed" is a guess, not a fact.
 * Every other status (400 / 401 / 403 / 404 / 429 ...) is a definitive refusal: the server
 * recorded nothing, so the console's view still stands. (`LifecycleError.status` is
 * `undefined` for a failure with no response.)
 */
export function stateMayHaveChanged(status: number | undefined): boolean {
  return status === undefined || status === 409 || status === 408 || status >= 500
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
