/**
 * features/exerciseLifecycleAdmin/services/orgExercisesService.ts
 * ---------------------------------------------------------------------------
 * The ORG-TIER exercise data seam (feature: exercise-lifecycle-admin, stories
 * 01 + 02 — COR-074 / COR-075). Consumes the backend contract built in
 * `Pulse.WebApi/Features/ExerciseLifecycleAdmin/`:
 *
 *   POST /api/org/exercises   { name, hostname? }
 *     201 -> { exercise: OrgExerciseDto, assignedRole }
 *     400 -> invalid (e.g. a missing/blank name)
 *     401 -> no authenticated staff session / no resolvable tenant
 *     403 -> a controller or evaluator session
 *     409 -> the proposed hostname is already taken (GLOBALLY, across customers)
 *
 *   GET /api/org/exercises
 *     200 -> OrgExerciseDto[]
 *     401 -> no authenticated staff session / no resolvable tenant
 *     403 -> a controller or evaluator session
 *
 * ## `/api/org/*`, and NO id in any route (COR-001 on the org axis)
 * Every other staff read in this app is `/api/staff/*` and is scoped to the ONE
 * server-resolved exercise. These two span the caller's whole CUSTOMER TENANT,
 * which is why they sit on their own prefix — and why NEITHER takes a route,
 * query or body parameter naming an exercise or an organization. There is no
 * `/api/org/exercises/{id}`, deliberately: no client-supplied identifier on the
 * org tier means no IDOR surface on the org axis at all. Do not add one here to
 * "save a round trip"; the backend asserts the absence structurally
 * (`TheOrgTierRoutes_TakeNoRouteParameters_...`).
 *
 * ## NFR-004 — the server is the sanitizer, and this module renders nothing
 * `name` is free text. It is sanitized ON INGEST server-side (markup STRIPPED,
 * not encoded) and the response echoes the stored value back, which is what the
 * surface renders — as TEXT, through React, never as HTML. There is no
 * client-side HTML sanitizer in this repo and this seam does not need one; what
 * it must never do is start rendering `name` through `dangerouslySetInnerHTML`.
 *
 * ## MOCK SEAM — and why the mock is STATEFUL
 * Mirrors `features/staff/services/staffAssignmentsService.ts`: every request
 * goes through the shared axios client (`@/core/services/api`) so method, URL,
 * base URL and headers match the live call exactly, and mock data is swapped at
 * EXACTLY ONE env-guarded flip point (`USE_MOCK_ORG_EXERCISES = USE_MOCK_DATA`,
 * `@/core/config/mockData`), never per call. A real deploy that omits the flag
 * fails closed (COR-001) rather than serving canned exercises.
 *
 * The canned data lives in a MUTABLE module store rather than a frozen array,
 * because the live behaviour this seam has to reproduce is "create, then the
 * list shows it". A read-only mock would make `POST` a silent no-op that still
 * returned 201 — the exact mock/live divergence class this repo keeps shipping
 * (a switcher landed this same wave whose mock silently did nothing). The mock
 * therefore also enforces the two failures the surface has to handle: a blank
 * name is a 400, and a duplicate hostname is a 409.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Timestamps here are
 * SERVER WALL-CLOCK administrative metadata on a staff surface, exempt from the
 * participant scenario-time rule (COR-053), and never shown in-fiction.
 */

import axios, {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { CreateExerciseInput, CreateExerciseResult, OrgExercise } from '../types'

/** The org-scoped exercise collection, relative to the shared client's `/api` base URL. */
const ORG_EXERCISES_ENDPOINT = '/org/exercises'

const HTTP_BAD_REQUEST = 400
const HTTP_CONFLICT = 409
const HTTP_CREATED = 201

/** Wire shape of one exercise row (`OrgExerciseDto`, verbatim field names). */
interface OrgExerciseBody {
  readonly exerciseId: string
  readonly name: string
  readonly status: string
  readonly hostname?: string | null
  readonly createdAt?: string | null
}

/** Wire shape of the creation response (`CreateExerciseResponseDto`). */
interface CreateExerciseResponseBody {
  readonly exercise: OrgExerciseBody
  readonly assignedRole: string
}

/**
 * A transport-agnostic error this seam throws so the surface can render
 * status-aware feedback without coupling itself to axios internals. Mirrors
 * `StaffAssignmentError` (`features/staff`) and `AccountImportError`
 * (`features/planner`).
 *
 * `status` is the HTTP status when the server responded, or `undefined` when
 * the request never reached one (network failure). `serverMessage` is the
 * server's own reason string when it sent one.
 */
export interface OrgExerciseErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class OrgExerciseError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: OrgExerciseErrorInit = {}) {
    super(message)
    this.name = 'OrgExerciseError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/**
 * True when this failure is the RECOVERABLE hostname collision (COR-008): the
 * caller proposed a host another exercise already holds. Named rather than
 * compared inline at the call site so the form's recovery path and this seam's
 * contract cannot drift apart.
 */
export function isHostnameTakenError(error: unknown): boolean {
  return error instanceof OrgExerciseError && error.status === HTTP_CONFLICT
}

// ---------------------------------------------------------------------------
// The mock backend (dev/test only — see USE_MOCK_ORG_EXERCISES)
// ---------------------------------------------------------------------------

/**
 * The seed portfolio. `ex-mock-0001` deliberately matches
 * `core/exerciseContext/exerciseContextResolver.ts`'s `MOCK_EXERCISE_CONTEXT`
 * and `staffAssignmentsService`'s canned assignments, so the exercise a mock
 * session is bound to is a REAL row in this list rather than an orphan.
 *
 * DEMO CONFIG, not product copy. Deleted with the flip point.
 */
const SEED_MOCK_EXERCISES: readonly OrgExerciseBody[] = [
  {
    exerciseId: 'ex-mock-0001',
    name: 'Coastal Surge (Mock Exercise)',
    status: 'live',
    hostname: 'coastal-surge',
    createdAt: '2026-05-11T13:20:00.000Z',
  },
  {
    exerciseId: 'ex-mock-0002',
    name: 'Ridgeline Wildfire TTX',
    status: 'staged',
    hostname: 'ridgeline-wildfire',
    createdAt: '2026-06-02T09:05:00.000Z',
  },
  {
    exerciseId: 'ex-mock-0003',
    name: 'Harbor Freeze Tabletop',
    status: 'build',
    hostname: 'harbor-freeze',
    createdAt: '2026-07-19T16:45:00.000Z',
  },
]

/** The mock's mutable store — see the module header for why it is not frozen. */
let mockExercises: OrgExerciseBody[] = [...SEED_MOCK_EXERCISES]

/** Monotonic suffix for server-allocated mock ids/hostnames. */
let mockSequence = SEED_MOCK_EXERCISES.length

/**
 * Restores the mock store to its seed state. DEV/TEST ONLY — nothing in a
 * shipped surface calls this; it exists so a test that exercises the create →
 * list round trip does not leak a row into the next test. Same posture as
 * `core/telemetry`'s `resetTelemetryBuffer`.
 */
export function resetOrgExerciseMocks(): void {
  mockExercises = [...SEED_MOCK_EXERCISES]
  mockSequence = SEED_MOCK_EXERCISES.length
}

/** Mirrors the server's `ExerciseHostName` normalizer closely enough to collide the same way. */
function normalizeHostname(value: string): string {
  return value.trim().toLowerCase()
}

/** Mirrors the server's slug + suffix allocation for a caller who proposes no host. */
function allocateMockHostname(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `${slug.length > 0 ? slug : 'exercise'}-${mockSequence.toString(16).padStart(8, '0')}`
}

function mockError(
  status: number,
  statusText: string,
  message: string,
  config: InternalAxiosRequestConfig,
): AxiosError {
  return new AxiosError(
    message,
    undefined,
    config,
    undefined,
    { status, statusText, data: { message }, headers: {}, config },
  )
}

/** `GET /api/org/exercises` — the caller's organization's portfolio. */
const listMockAdapter: AxiosAdapter = config => Promise.resolve({
  data: [...mockExercises],
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * `POST /api/org/exercises` — reproduces the three outcomes the surface has to
 * handle: 400 (no name), 409 (hostname taken), 201 (created in `build`, with
 * the row actually appended so the subsequent list read reflects it).
 */
const createMockAdapter: AxiosAdapter = config => {
  let parsed: unknown
  try {
    parsed = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
  } catch {
    parsed = undefined
  }

  const body = (parsed ?? {}) as { name?: unknown, hostname?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const proposed = typeof body.hostname === 'string' ? normalizeHostname(body.hostname) : ''

  if (name.length === 0) {
    return Promise.reject(
      mockError(HTTP_BAD_REQUEST, 'Bad Request', 'name is required.', config),
    )
  }

  if (proposed.length > 0 && mockExercises.some(e => e.hostname === proposed)) {
    return Promise.reject(
      mockError(
        HTTP_CONFLICT,
        'Conflict',
        'That hostname is already in use by another exercise.',
        config,
      ),
    )
  }

  mockSequence += 1
  const created: OrgExerciseBody = {
    exerciseId: `ex-mock-${mockSequence.toString().padStart(4, '0')}`,
    // The live server STRIPS markup on ingest (NFR-004). The mock does the same
    // crude thing so a surface that renders the echoed name is exercised against
    // a server-shaped value, not the raw one it typed.
    name: name.replace(/<[^>]*>/g, '').trim(),
    // COR-032: a newly created exercise is ALWAYS `build`, never anything else.
    status: 'build',
    hostname: proposed.length > 0 ? proposed : allocateMockHostname(name),
    createdAt: new Date().toISOString(),
  }
  mockExercises = [...mockExercises, created]

  const response: CreateExerciseResponseBody = {
    exercise: created,
    // The live server copies the CREATOR's own role. The mock session used in
    // dev/UAT is a planner, so that is what it echoes.
    assignedRole: 'planner',
  }

  return Promise.resolve({
    data: response,
    status: HTTP_CREATED,
    statusText: 'Created',
    headers: {},
    config,
  })
}

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15): mock in dev/test,
 * real `/api/org/exercises` calls in a production build.
 */
const USE_MOCK_ORG_EXERCISES = USE_MOCK_DATA

// ---------------------------------------------------------------------------
// Wire validation
// ---------------------------------------------------------------------------

function isOrgExerciseBody(value: unknown): value is OrgExerciseBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.exerciseId === 'string' && body.exerciseId.length > 0
    && typeof body.name === 'string' && body.name.length > 0
    && typeof body.status === 'string' && body.status.length > 0
    && (body.hostname === undefined || body.hostname === null || typeof body.hostname === 'string')
    && (body.createdAt === undefined || body.createdAt === null
      || typeof body.createdAt === 'string')
  )
}

function isOrgExerciseListBody(value: unknown): value is OrgExerciseBody[] {
  return Array.isArray(value) && value.every(isOrgExerciseBody)
}

/**
 * Projects a validated wire row onto the surface's own type. `null` hostname /
 * createdAt become `undefined` (genuinely unknown, per the DTO's own contract)
 * — never a fabricated stand-in.
 *
 * `status` is carried through VERBATIM. See `types.ts` for why this boundary
 * does not narrow it: an unrecognised literal must reach the row that renders
 * it, so that ONE odd row reads as "unrecognised" instead of blanking the whole
 * organization's portfolio behind a fail-closed throw.
 */
function toOrgExercise(body: OrgExerciseBody): OrgExercise {
  return {
    exerciseId: body.exerciseId,
    name: body.name,
    status: body.status,
    ...(typeof body.hostname === 'string' && body.hostname.length > 0
      ? { hostname: body.hostname }
      : {}),
    ...(typeof body.createdAt === 'string' && body.createdAt.length > 0
      ? { createdAt: body.createdAt }
      : {}),
  }
}

/** Pulls a human-readable reason off a server error body (string or object). */
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title', 'error'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return undefined
}

/** Translates any thrown transport failure into an `OrgExerciseError`. */
function toOrgExerciseError(error: unknown, fallbackMessage: string): OrgExerciseError {
  if (error instanceof OrgExerciseError) {
    return error
  }
  if (axios.isAxiosError(error)) {
    return new OrgExerciseError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new OrgExerciseError(error.message, { cause: error })
  }
  return new OrgExerciseError(fallbackMessage, { cause: error })
}

// ---------------------------------------------------------------------------
// The two calls
// ---------------------------------------------------------------------------

/**
 * Lists the exercises the caller's ORGANIZATION owns (COR-075) — a strictly
 * different read from `GET /api/staff/assignments`, which is own-only and feeds
 * the exercise switcher. An org-admin administers runs they hold no assignment
 * on, so folding the two would either leak unassigned exercises into the
 * switcher or hide the organization's own runs from its administrator.
 *
 * Throws `OrgExerciseError` on a transport failure (401/403/network) or a
 * malformed body — fail closed, never a partial or defaulted list.
 */
export async function getOrgExercises(): Promise<OrgExercise[]> {
  let data: unknown
  try {
    const response = await api.get<OrgExerciseBody[]>(
      ORG_EXERCISES_ENDPOINT,
      USE_MOCK_ORG_EXERCISES ? { adapter: listMockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toOrgExerciseError(error, 'Could not load your organization’s exercises.')
  }

  if (!isOrgExerciseListBody(data)) {
    throw new OrgExerciseError('getOrgExercises: response was empty or malformed.')
  }

  return data.map(toOrgExercise)
}

/**
 * Creates one exercise under the caller's own organization (COR-074). The new
 * exercise is always in `build` status with a `StaffAssignment` minted for the
 * creator — both server-decided; this seam asserts neither.
 *
 * A blank `hostname` is OMITTED from the body rather than sent as `""`, so the
 * server takes its "allocate one for me" path instead of failing validation on
 * an empty proposal.
 *
 * Throws `OrgExerciseError`; use {@link isHostnameTakenError} to recognise the
 * recoverable 409 the form re-renders as a field error.
 */
export async function createOrgExercise(
  input: CreateExerciseInput,
): Promise<CreateExerciseResult> {
  const hostname = input.hostname?.trim() ?? ''
  const requestBody = {
    name: input.name.trim(),
    ...(hostname.length > 0 ? { hostname } : {}),
  }

  let data: unknown
  try {
    const response = await api.post<CreateExerciseResponseBody>(
      ORG_EXERCISES_ENDPOINT,
      requestBody,
      USE_MOCK_ORG_EXERCISES ? { adapter: createMockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toOrgExerciseError(error, 'Could not create the exercise.')
  }

  if (typeof data !== 'object' || data === null) {
    throw new OrgExerciseError('createOrgExercise: response was empty or malformed.')
  }

  const body = data as Record<string, unknown>
  if (!isOrgExerciseBody(body.exercise) || typeof body.assignedRole !== 'string') {
    throw new OrgExerciseError('createOrgExercise: response was empty or malformed.')
  }

  return {
    exercise: toOrgExercise(body.exercise),
    assignedRole: body.assignedRole,
  }
}
