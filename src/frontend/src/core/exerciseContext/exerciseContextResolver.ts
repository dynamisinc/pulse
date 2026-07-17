/**
 * core/exerciseContextResolver.ts
 * ---------------------------------------------------------------------------
 * Wave-0 mock resolver for the single exercise scope a Pulse session belongs
 * to (COR-001, COR-004; see
 * docs/features/exercise-isolation/10-exercise-context-provider-mock.md).
 *
 * `resolveExerciseContext()` is the seam `ExerciseContextProvider`
 * (`./exerciseContext.tsx`) calls on mount. It is deliberately routed through
 * the shared axios client (`core/services/api.ts`) rather than returning a
 * bare constant: the request shape (method, URL, base URL, headers) matches
 * what a real `/exercise-context` endpoint will look like once story 04
 * (host/auth-resolved extension) and the backend land, so swapping the mock
 * adapter below for a live network call requires no change to this
 * function's signature, the provider, or any consumer.
 *
 * This module resolves exactly ONE fixed exercise. There is no list, no
 * picker, and no admin/simulation-status surface here (COR-004, XC-002).
 *
 * World: platform/foundation. Pure `core/` module - no UI, no COBRA.
 * Deliberately self-contained: does not import the scenario-time clock
 * (`core/clock/`) or the telemetry emitter (`core/telemetry/`).
 */

import type { AxiosAdapter } from 'axios'
import { api } from './services/api'

/** Exercise lifecycle status, as surfaced on a single bound scope (no list). */
export type ExerciseStatus = 'scheduled' | 'active' | 'complete' | 'archived'

/**
 * All valid exercise statuses. The runtime guard checks membership here so it
 * matches the wire contract — this seam swaps to a live endpoint with no
 * consumer change, so an out-of-enum `status` must fail closed, not be cast
 * blindly to `ExerciseStatus`.
 */
const EXERCISE_STATUSES: readonly ExerciseStatus[] = [
  'scheduled',
  'active',
  'complete',
  'archived',
]

function isExerciseStatus(value: unknown): value is ExerciseStatus {
  return typeof value === 'string' && (EXERCISE_STATUSES as readonly string[]).includes(value)
}

/** The single-exercise scope every participant-facing module resolves against. */
export interface ExerciseScope {
  readonly exerciseId: string
  readonly exerciseName: string
  readonly timeZone: string
  readonly status: ExerciseStatus
}

/** Wire shape of the (future) `/exercise-context` response body. */
interface ExerciseContextResponseBody {
  readonly exerciseId: string
  readonly exerciseName: string
  readonly timeZone: string
  readonly status: ExerciseStatus
}

/**
 * The one fixed exercise this Wave-0 mock resolves to. When the real
 * `/exercise-context` endpoint lands, delete `mockAdapter` below (and this
 * constant) and let the `api.get` call hit the network - the response shape
 * is exactly what that endpoint should return.
 */
const MOCK_EXERCISE_CONTEXT: ExerciseContextResponseBody = {
  exerciseId: 'ex-mock-0001',
  exerciseName: 'Coastal Surge (Mock Exercise)',
  timeZone: 'America/New_York',
  status: 'active',
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_EXERCISE_CONTEXT,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

function isValidResponseBody(
  body: ExerciseContextResponseBody | null | undefined,
): body is ExerciseContextResponseBody {
  return (
    !!body &&
    typeof body.exerciseId === 'string' && body.exerciseId.length > 0 &&
    typeof body.exerciseName === 'string' && body.exerciseName.length > 0 &&
    typeof body.timeZone === 'string' && body.timeZone.length > 0 &&
    isExerciseStatus(body.status)
  )
}

/**
 * Resolves the current session's single exercise scope.
 *
 * Always routed through the shared axios client. Throws on any request
 * failure or malformed/empty response so the caller (the provider) can fail
 * closed rather than ever falling back to a default or aggregate scope
 * (COR-001, XC-001).
 */
export async function resolveExerciseContext(): Promise<ExerciseScope> {
  const response = await api.get<ExerciseContextResponseBody>('/exercise-context', {
    adapter: mockAdapter,
  })

  if (!isValidResponseBody(response.data)) {
    throw new Error(
      'resolveExerciseContext: mock resolution returned an empty or malformed scope',
    )
  }

  const { exerciseId, exerciseName, timeZone, status } = response.data
  return { exerciseId, exerciseName, timeZone, status }
}
