/**
 * features/planner/services/practiceModeService.ts
 * ---------------------------------------------------------------------------
 * The COR-033 practice/sandbox data seam for the staff-console planner surface
 * (feature: exercise-configuration, story 04 — "Practice/sandbox flag"; issue
 * #41 / story #70). Consumes the backend contract shipped by
 * `src/Pulse.WebApi/Features/ExerciseConfiguration/PracticeMode/`
 * (`PracticeModeEndpoints.cs` + `PracticeModeDtos.cs`):
 *
 *   GET  /api/staff/practice-mode   -> 200 PracticeModeDto
 *   PUT  /api/staff/practice-mode   -> 200 PracticeModeDto (re-projected)
 *
 *   400 `isPracticeMode` missing — NOTHING persisted. The body is a bare JSON
 *       *string* (one message).
 *   401 no staff session / no server-resolved exercise scope (empty body).
 *   403 staff session not assigned to the resolved exercise (empty body).
 *   404 the resolved scope has no exercise row (empty body).
 *
 * WHAT THE FLAG MEANS. A practice/sandbox exercise is a REHEARSAL — a load test,
 * a controller dry-run — whose data is excluded from evaluation exports so it
 * cannot pollute the AAR (COR-033). It changes NOTHING else: channels, engine
 * and telemetry all behave exactly as in real conduct, because a rehearsal that
 * behaves differently is not a rehearsal. `evaluationEligible` is the server's
 * OWN answer, read from the single `IEvaluationEligibility` seam a future
 * evaluation export (E10) will filter on — this module never re-derives
 * "practice means excluded" client-side, so the console and the export can never
 * disagree.
 *
 * STAFF WORLD ONLY (XC-002). Practice state appears on no participant surface;
 * the participant-facing read model on the server structurally omits the flag.
 * Nothing here is ever imported by a participant surface.
 *
 * THE EXERCISE IS NEVER A PARAMETER (COR-001 / XC-001 / XC-002). There is no
 * route value, no query string and no body field naming an exercise: the target
 * is the scope the SERVER resolved for the staff session. `exerciseId` on the
 * response is an ECHO of that scope, for display/query-keying only.
 *
 * MOCK SEAM (mirrors `exerciseSettingsService.ts` / `accountImportService.ts`):
 * every request routes through the shared axios client (`@/core/services/api`)
 * so the request shape (method, URL, base URL, and the staff `Authorization`
 * header the client's auth layer attaches) matches the live endpoint exactly.
 * Mock data is swapped at EXACTLY ONE env-guarded flip point
 * (`USE_MOCK_PRACTICE_MODE = USE_MOCK_DATA`), never per call, so a real deploy
 * that omits the flag fails closed (COR-001) rather than serving canned state.
 *
 * CLIENT-CONTRACT TYPES LIVE HERE, NOT IN `features/planner/types.ts`, per
 * `docs/features/exercise-configuration/implementation.md` -> "Integration
 * seams": that module belongs to the account-import contract and is edited by a
 * concurrent wave. The feature barrel re-exports from here.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Exempt from the
 * participant scenario-time rule (COR-053): nothing here renders in-fiction.
 */

import axios, { type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'

/** The staff practice-mode route, relative to the shared client's `/api` base URL. */
const PRACTICE_MODE_ENDPOINT = '/staff/practice-mode'

// ---------------------------------------------------------------------------
// Client contract types (kept local to this module — see the header)
// ---------------------------------------------------------------------------

/**
 * `GET`/`PUT /api/staff/practice-mode` response body.
 *
 * `evaluationEligible` is the SERVER's verdict from its single evaluation-
 * eligibility seam, not a client-side inference from `isPracticeMode`. Render
 * it; never compute it.
 */
export interface PracticeModeState {
  /** Echo of the SERVER-resolved scope. Never an input. */
  readonly exerciseId: string
  /** Whether this exercise is a practice/sandbox run. `false` until a planner flags it. */
  readonly isPracticeMode: boolean
  /** Whether this exercise's data is eligible for an evaluation export (the server's own read). */
  readonly evaluationEligible: boolean
}

/**
 * `PUT /api/staff/practice-mode` request body.
 *
 * `isPracticeMode` is REQUIRED: the server rejects an absent value with a 400
 * rather than treating it as "off", because flagging a run — or un-flagging one
 * — is an explicit decision either way.
 */
export interface PracticeModeUpdate {
  readonly isPracticeMode: boolean
}

// ---------------------------------------------------------------------------
// Transport-agnostic error
// ---------------------------------------------------------------------------

/** Construction options for {@link PracticeModeError}. */
export interface PracticeModeErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

/**
 * A transport-agnostic failure this seam throws so the panel renders
 * status-aware feedback WITHOUT coupling to axios internals. `status` is the
 * HTTP status when the server responded (400/401/403/404), or `undefined` when
 * the request never reached a response (network failure).
 */
export class PracticeModeError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: PracticeModeErrorInit = {}) {
    super(message)
    this.name = 'PracticeModeError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime guard — fail closed on an out-of-shape body rather than casting
// blindly. A malformed body must never render as "not a practice exercise":
// that is the reading that would let a rehearsal be mistaken for real conduct.
// ---------------------------------------------------------------------------

function isPracticeModeBody(value: unknown): value is PracticeModeState {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.exerciseId === 'string' &&
    typeof body.isPracticeMode === 'boolean' &&
    typeof body.evaluationEligible === 'boolean'
  )
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/**
 * Pulls the server's reason off an error body. This endpoint's 400 body is a
 * **bare JSON string** (`Results.BadRequest("…")`), so the string branch is the
 * live one; the object branch covers a ProblemDetails-shaped body from a proxy.
 */
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

/** Translates any thrown transport failure into a `PracticeModeError`. */
function toPracticeModeError(error: unknown): PracticeModeError {
  if (axios.isAxiosError(error)) {
    return new PracticeModeError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new PracticeModeError(error.message, { cause: error })
  }
  return new PracticeModeError('The practice-mode request failed for an unknown reason.', {
    cause: error,
  })
}

// ---------------------------------------------------------------------------
// Mock seam (DEMO CONFIG — deleted when every environment has the backend).
// ---------------------------------------------------------------------------

/**
 * The canned state the mock serves. Mutable module state on purpose — the mock
 * PUT replaces it, so the dev/UAT demo shows a real round trip (flag, reload,
 * the flag persists for the tab's lifetime) rather than a write that evaporates.
 *
 * It starts UNFLAGGED, which is the shipped default: an exercise nobody has
 * flagged is real conduct.
 */
let mockState: PracticeModeState = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  isPracticeMode: false,
  evaluationEligible: true,
}

/**
 * Projects a mock write onto the response shape the server returns — including
 * deriving `evaluationEligible` the way the SERVER's seam does, so the mock can
 * never teach the UI a different rule than production.
 */
function applyMockUpdate(update: PracticeModeUpdate): PracticeModeState {
  mockState = {
    exerciseId: mockState.exerciseId,
    isPracticeMode: update.isPracticeMode,
    evaluationEligible: !update.isPracticeMode,
  }
  return mockState
}

/**
 * Short-circuits the network with the canned state while still exercising the
 * shared axios client's request pipeline exactly as a live call would.
 */
const mockAdapter: AxiosAdapter = config => {
  const method = (config.method ?? 'get').toLowerCase()
  // Axios has already run `transformRequest` by the time an adapter sees the
  // config, so a PUT body arrives as the serialized JSON string.
  const body: unknown = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
  const data =
    method === 'put' && typeof body === 'object' && body !== null
      ? applyMockUpdate(body as PracticeModeUpdate)
      : mockState
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

/** The SINGLE mock/live flip point (mirrors `exerciseSettingsService.ts`). */
const USE_MOCK_PRACTICE_MODE = USE_MOCK_DATA

// ---------------------------------------------------------------------------
// Public seam
// ---------------------------------------------------------------------------

/**
 * Reads the practice/sandbox state of the exercise the SERVER resolved for this
 * staff session. Takes no arguments by design — there is no exercise parameter
 * anywhere in this surface (COR-001).
 *
 * Throws `PracticeModeError` on a transport failure (401/403/404/network) or a
 * malformed response body.
 */
export async function getPracticeMode(): Promise<PracticeModeState> {
  let data: unknown
  try {
    const response = await api.get<unknown>(
      PRACTICE_MODE_ENDPOINT,
      USE_MOCK_PRACTICE_MODE ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toPracticeModeError(error)
  }

  if (!isPracticeModeBody(data)) {
    throw new PracticeModeError('The practice-mode response was empty or malformed.')
  }
  return data
}

/**
 * Sets or clears the resolved exercise's practice/sandbox flag and returns the
 * server's freshly re-projected state.
 *
 * Callers must render from the RETURNED value, not from their local checkbox
 * state: `evaluationEligible` comes from the server's eligibility seam, which is
 * the only authority on what an evaluation export will do.
 *
 * Throws `PracticeModeError` on 400 (nothing was persisted), 401/403/404, a
 * network failure, or a malformed response body.
 */
export async function setPracticeMode(update: PracticeModeUpdate): Promise<PracticeModeState> {
  let data: unknown
  try {
    const response = await api.put<unknown>(
      PRACTICE_MODE_ENDPOINT,
      update,
      USE_MOCK_PRACTICE_MODE ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toPracticeModeError(error)
  }

  if (!isPracticeModeBody(data)) {
    throw new PracticeModeError('The practice-mode response was empty or malformed.')
  }
  return data
}
