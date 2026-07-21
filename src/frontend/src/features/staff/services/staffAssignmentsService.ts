/**
 * features/staff/services/staffAssignmentsService.ts
 * ---------------------------------------------------------------------------
 * The staff cross-exercise assignment data seam (feature: exercise-isolation,
 * story 05 — staff cross-exercise switcher; COR-005). Consumes the FROZEN
 * backend contract built in identity-auth-roles/05:
 *
 *   GET /api/staff/assignments
 *     200 -> StaffAssignmentDto[]  ({ exerciseId, exerciseName, role })
 *     401 -> no authenticated staff session
 *
 *   POST /api/staff/active-exercise  { exerciseId }
 *     200 -> StaffAssignmentDto     (the newly-active assignment)
 *     400 -> malformed/unknown exerciseId
 *     401 -> no authenticated staff session
 *     403 -> the caller is not assigned to that exercise
 *
 * (see `src/Pulse.WebApi/Features/Identity/Staff/StaffAssignmentDto.cs` +
 * `StaffAuthEndpoints.cs` + `StaffAssignmentService.cs`.)
 *
 * MOCK SEAM (mirrors `core/auth/sessionResolver.ts` /
 * `core/exerciseContext/exerciseContextResolver.ts` /
 * `features/planner/services/accountImportService.ts`): every request routes
 * through the shared axios client (`@/core/services/api`) so the request
 * shape (method, URL, base URL, headers, and — once wired — the staff
 * Authorization header) matches the live endpoints exactly. Mock data is
 * swapped at EXACTLY ONE env-guarded flip point
 * (`USE_MOCK_STAFF_ASSIGNMENTS = USE_MOCK_DATA`), never per-call, so the
 * switcher renders + is testable with no backend while a real deploy that
 * omits the flag fails closed (COR-001) rather than serving canned
 * assignments.
 *
 * The canned assignments deliberately reuse the same `exerciseId`/
 * `exerciseName` ('ex-mock-0001' / 'Coastal Surge (Mock Exercise)') as
 * `core/exerciseContext/exerciseContextResolver.ts`'s `MOCK_EXERCISE_CONTEXT`,
 * so in mock/dev mode the switcher's "currently active" match against
 * `useExerciseContext()` resolves to a REAL row in this list rather than an
 * orphaned id.
 *
 * AUTH: this module never reads or attaches a token itself — same precedent
 * as `accountImportService.ts`. The staff bearer token is a concern of the
 * shared client's auth layer; routing through `api` means that header flows
 * automatically once it exists, with no change here.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Exempt from the
 * participant scenario-time rule (COR-053): assignments carry no
 * participant-visible timestamps.
 */

import axios, { AxiosError, type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { isExerciseRole } from '@/core/auth'
import type { StaffAssignment } from '../types'

/** The two endpoints this seam consumes, relative to the shared client's `/api` base URL. */
const ASSIGNMENTS_ENDPOINT = '/staff/assignments'
const ACTIVE_EXERCISE_ENDPOINT = '/staff/active-exercise'

/** Wire shape of one assignment (`StaffAssignmentDto`, verbatim field names). */
interface StaffAssignmentBody {
  readonly exerciseId: string
  readonly exerciseName: string
  readonly role: string
}

/**
 * A transport-agnostic error the assignment seam throws so the switcher can
 * render clear, status-aware feedback WITHOUT coupling itself to axios
 * internals. `status` is the HTTP status when the server responded
 * (401/403/400/…), or `undefined` when the request never reached a response
 * (network failure). `serverMessage` is the server's own reason string, when
 * present. Mirrors `AccountImportError` (`features/planner`).
 */
export interface StaffAssignmentErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class StaffAssignmentError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: StaffAssignmentErrorInit = {}) {
    super(message)
    this.name = 'StaffAssignmentError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/**
 * A representative, multi-exercise canned assignment list (dev/test only —
 * see `USE_MOCK_STAFF_ASSIGNMENTS`) so the switcher renders end-to-end with no
 * backend. `ex-mock-0001` deliberately matches
 * `exerciseContextResolver.ts`'s `MOCK_EXERCISE_CONTEXT`, so the mock
 * "currently active" exercise resolves to a real row here. This is DEMO
 * CONFIG, not product copy. Deleted once the mock/live flip point is removed.
 */
const MOCK_ASSIGNMENTS: readonly StaffAssignmentBody[] = [
  { exerciseId: 'ex-mock-0001', exerciseName: 'Coastal Surge (Mock Exercise)', role: 'controller' },
  { exerciseId: 'ex-mock-0002', exerciseName: 'Ridgeline Wildfire TTX', role: 'evaluator' },
  { exerciseId: 'ex-mock-0003', exerciseName: 'Harbor Freeze Tabletop', role: 'planner' },
]

/**
 * Short-circuits the network with the canned assignment list while still
 * exercising the shared axios client's request pipeline exactly as a live
 * call would.
 */
const assignmentsMockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_ASSIGNMENTS,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/** Pulls the `exerciseId` a `POST /active-exercise` call carries, for the mock switch adapter. */
function parseRequestedExerciseId(data: unknown): string | undefined {
  try {
    const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data
    const exerciseId = (parsed as { exerciseId?: unknown } | null)?.exerciseId
    return typeof exerciseId === 'string' ? exerciseId : undefined
  } catch {
    return undefined
  }
}

/**
 * Mirrors the real endpoint's own-assignment validation
 * (`StaffAssignmentService.SetActiveExerciseAsync`): echoes back the matching
 * canned assignment, or rejects with a 403-shaped error for an `exerciseId`
 * outside the mock list. The switcher only ever offers `exerciseId`s already
 * present in the list it rendered, so the rejection path is a defensive
 * fixture-mismatch guard, not a normal user path.
 */
const activeExerciseMockAdapter: AxiosAdapter = config => {
  const requestedExerciseId = parseRequestedExerciseId(config.data)
  const match = MOCK_ASSIGNMENTS.find(a => a.exerciseId === requestedExerciseId)

  if (!match) {
    return Promise.reject(
      new AxiosError(
        "exerciseId is not one of the caller's assignments",
        undefined,
        config,
        undefined,
        { status: 403, statusText: 'Forbidden', data: undefined, headers: {}, config },
      ),
    )
  }

  return Promise.resolve({ data: match, status: 200, statusText: 'OK', headers: {}, config })
}

/**
 * The SINGLE mock/live flip point (mirrors the resolver precedents): mock in
 * dev/test, real `/staff/assignments` + `/staff/active-exercise` calls in a
 * production build (fails closed until the backend + flag are set).
 */
const USE_MOCK_STAFF_ASSIGNMENTS = USE_MOCK_DATA

function isAssignmentBody(value: unknown): value is StaffAssignmentBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.exerciseId === 'string' && body.exerciseId.length > 0 &&
    typeof body.exerciseName === 'string' && body.exerciseName.length > 0 &&
    typeof body.role === 'string' && body.role.length > 0
  )
}

function isAssignmentListBody(value: unknown): value is StaffAssignmentBody[] {
  return Array.isArray(value) && value.every(isAssignmentBody)
}

/**
 * Builds a typed `StaffAssignment` from a validated wire body. Runtime guard
 * so this seam swaps to a live endpoint with no consumer change: an
 * out-of-vocabulary `role` fails closed (throws) rather than being cast
 * blindly into `ExerciseRole` (same precedent as
 * `exerciseContextResolver.ts`'s `isExerciseStatus`).
 */
function toAssignment(body: StaffAssignmentBody): StaffAssignment {
  if (!isExerciseRole(body.role)) {
    throw new StaffAssignmentError(
      `staffAssignmentsService: unknown role "${body.role}" for exercise ${body.exerciseId}`,
    )
  }
  return { exerciseId: body.exerciseId, exerciseName: body.exerciseName, role: body.role }
}

/** Pulls a human-readable reason off a server error body (string or object). */
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return undefined
}

/** Translates any thrown transport failure into a `StaffAssignmentError`. */
function toStaffAssignmentError(error: unknown, fallbackMessage: string): StaffAssignmentError {
  if (error instanceof StaffAssignmentError) {
    return error
  }
  if (axios.isAxiosError(error)) {
    return new StaffAssignmentError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new StaffAssignmentError(error.message, { cause: error })
  }
  return new StaffAssignmentError(fallbackMessage, { cause: error })
}

/**
 * Lists the authenticated staff user's OWN assignments across every exercise
 * they hold a role on (COR-005 — the one deliberate cross-exercise,
 * staff-only, own-only read). Throws `StaffAssignmentError` on a transport
 * failure (401/network) or a malformed response body (fail closed — never a
 * default/partial list).
 */
export async function getStaffAssignments(): Promise<StaffAssignment[]> {
  let data: unknown
  try {
    const response = await api.get<StaffAssignmentBody[]>(
      ASSIGNMENTS_ENDPOINT,
      USE_MOCK_STAFF_ASSIGNMENTS ? { adapter: assignmentsMockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toStaffAssignmentError(error, 'Could not load your exercise assignments.')
  }

  if (!isAssignmentListBody(data)) {
    throw new StaffAssignmentError(
      'getStaffAssignments: response was empty or malformed.',
    )
  }

  return data.map(toAssignment)
}

/**
 * Switches the caller's active exercise to `exerciseId`. Validated
 * SERVER-SIDE against the caller's own `StaffAssignment` set — an exercise
 * the caller does not hold a role on is rejected (403). This seam never
 * grants access; it only selects among assignments the caller already has,
 * and thereby drives the staff arm of the `ExerciseContext.CurrentExerciseId`
 * scope seam for the caller's subsequent requests. Throws
 * `StaffAssignmentError` on failure (fail closed — never a silent no-op).
 */
export async function setActiveExercise(exerciseId: string): Promise<StaffAssignment> {
  let data: unknown
  try {
    const response = await api.post<StaffAssignmentBody>(
      ACTIVE_EXERCISE_ENDPOINT,
      { exerciseId },
      USE_MOCK_STAFF_ASSIGNMENTS ? { adapter: activeExerciseMockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toStaffAssignmentError(error, 'Could not switch your active exercise.')
  }

  if (!isAssignmentBody(data)) {
    throw new StaffAssignmentError(
      'setActiveExercise: response was empty or malformed.',
    )
  }

  return toAssignment(data)
}
