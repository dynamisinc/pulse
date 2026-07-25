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
import { api } from '../services/api'
import { USE_MOCK_DATA } from '../config/mockData'

/**
 * Exercise lifecycle status, as surfaced on a single bound scope (no list).
 *
 * THE TRANSITIONAL SUPERSET (exercise-configuration story 01a — COR-032
 * Option B, Tier-2 sign-off given). Two vocabularies are valid at once, on
 * purpose:
 *
 * - the COR-032 six — `build | staged | live | paused | completed | archived`
 *   (note `completed`, NOT `complete`), which the backend now stores and
 *   serves on `ExerciseScope.status`;
 * - the legacy four — `scheduled | active | complete | archived` — a
 *   placeholder that predates COR-032 and stays valid through the transition.
 *
 * Why both: UAT is a SPLIT DEPLOYMENT (Azure SWA frontend + App Service
 * backend) whose halves deploy independently, and `isExerciseStatus` FAILS
 * CLOSED on an unknown value — the provider then resolves nothing and the
 * participant shell renders nothing. A backend-ahead deploy of a narrow guard
 * is therefore a BLANK PARTICIPANT WORLD, not a type error. Accepting the
 * superset means no deploy order can strand the client.
 *
 * Retiring the legacy four is a documented follow-up, taken once no deployed
 * client and no database row carries them — do not "clean them up" here.
 */
export type ExerciseStatus =
  // COR-032 (the current vocabulary)
  | 'build'
  | 'staged'
  | 'live'
  | 'paused'
  | 'completed'
  | 'archived'
  // Legacy (pre-COR-032) — still accepted through the transition
  | 'scheduled'
  | 'active'
  | 'complete'

/**
 * All valid exercise statuses — the transitional superset described on
 * `ExerciseStatus`. The runtime guard checks membership here so it matches the
 * wire contract: this seam is a live endpoint, so an out-of-enum `status` must
 * fail closed, not be cast blindly to `ExerciseStatus`.
 */
export const EXERCISE_STATUSES: readonly ExerciseStatus[] = [
  'build',
  'staged',
  'live',
  'paused',
  'completed',
  'archived',
  'scheduled',
  'active',
  'complete',
]

/**
 * Fail-closed runtime guard for a wire `status`. Anything outside
 * `EXERCISE_STATUSES` — a coined variant, a capitalised spelling, a non-string
 * — is rejected, which is what makes an unresolved scope a closed door rather
 * than a blindly-cast lie.
 */
export function isExerciseStatus(value: unknown): value is ExerciseStatus {
  return typeof value === 'string' && (EXERCISE_STATUSES as readonly string[]).includes(value)
}

/**
 * The single-exercise scope every participant-facing module resolves against.
 *
 * PRECEDENT — `exerciseId` here is a DISPLAY / TELEMETRY-STAMPING field, NOT a
 * query-scoping mechanism. Query isolation is enforced SERVER-SIDE (COR-001,
 * story 01's central query filter; story 04's host/session resolution). A
 * participant request must never carry a client-supplied `exerciseId` param —
 * that is exactly the cross-exercise-leak vector COR-001 forbids. Read
 * `exerciseId` to stamp a telemetry envelope or label a surface; never to scope
 * a fetch.
 *
 * `status` is lifecycle metadata, NOT a render-safety signal: a resolved scope
 * does not by itself mean "safe to show live participant content". Gating an
 * archived/scheduled/complete exercise out of a live render is story 04 (route
 * guard) + story 06 (archived separation), not this seam.
 */
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
 * The one fixed exercise this Wave-0 mock resolves to (dev/test only — see
 * `USE_MOCK_EXERCISE_CONTEXT`). When the real `/exercise-context` endpoint
 * lands, this constant + `mockAdapter` are deleted and the flip point flips;
 * the response shape is exactly what that endpoint should return.
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

/**
 * The SINGLE mock/live flip point. Mock in dev/test; a production build hits the
 * real `/exercise-context` endpoint (and, until the backend lands, fails closed
 * — the provider renders nothing rather than serving a stale canned exercise).
 * PRECEDENT: mock data is switched in exactly ONE env-guarded place, never
 * per-call, so a forgotten `adapter:` can't silently fail *open* to mock data
 * in production.
 */
const USE_MOCK_EXERCISE_CONTEXT = USE_MOCK_DATA

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
  const response = await api.get<ExerciseContextResponseBody>(
    '/exercise-context',
    USE_MOCK_EXERCISE_CONTEXT ? { adapter: mockAdapter } : undefined,
  )

  if (!isValidResponseBody(response.data)) {
    throw new Error(
      'resolveExerciseContext: mock resolution returned an empty or malformed scope',
    )
  }

  const { exerciseId, exerciseName, timeZone, status } = response.data
  return { exerciseId, exerciseName, timeZone, status }
}
