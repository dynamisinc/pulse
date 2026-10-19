/**
 * features/planner/services/readinessService.ts
 * ---------------------------------------------------------------------------
 * The go-live READINESS data seam for the staff-console planner surface
 * (feature: exercise-build-golive, story 03 - "Go-live readiness dashboard";
 * COR-042; ADMIN-IDENTITY-MODEL section 5.3). Consumes:
 *
 *   GET /api/staff/readiness -> 200 ReadinessDto
 *
 *   { ready, lifecycleState, blocking: ReadinessItem[], warnings: ReadinessItem[] }
 *   ReadinessItem = { id, label, status: 'ok' | 'open' | 'notChecked', detail: string | null }
 *
 *   401 no staff session; 403 role not allowed (planner / controller / evaluator
 *   may read; participant, view-only and org-scope sessions are refused).
 *
 * THE UI IS DRIVEN BY THE PAYLOAD, NOT A HARDCODED LIST. The server owns which
 * checks exist and in what order; an id this client has never heard of must still
 * render (its label comes from the server). `id` is only a stable key, used by
 * the panel to look up an optional "fix it" link.
 *
 * `notChecked` is DISTINCT from `ok` and `open`: the server cannot evaluate the
 * item yet (its backing feature has not landed). It never blocks, and it must
 * never be shown as done.
 *
 * `ready` is the SERVER's verdict (no blocking item is `open`). The panel shows
 * "ready" only when the server says so AND no blocking item is `open`, so a
 * disagreement between the two always reads as not ready.
 *
 * THE EXERCISE IS NEVER A PARAMETER (COR-001 / XC-001). Scope is the staff
 * session's, resolved server-side.
 *
 * FAIL CLOSED. A body that is not exactly this shape (unknown status, a non-array
 * list, a missing field) is rejected rather than rendered, because a malformed
 * body that rendered as "ready" would green-light a stage that is not ready.
 *
 * MOCK SEAM (mirrors `exerciseSettingsService.ts`): every request goes through
 * the shared axios client; canned data is swapped at EXACTLY ONE env-guarded flip
 * point (`USE_MOCK_READINESS = USE_MOCK_DATA`).
 *
 * World: STAFF. Pure data module - no UI. Exempt from COR-053 (nothing renders
 * in-fiction).
 */

import axios, { type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'

/** The staff readiness route, relative to the shared client's `/api` base URL. */
const READINESS_ENDPOINT = '/staff/readiness'

// ---------------------------------------------------------------------------
// Client contract types
// ---------------------------------------------------------------------------

/** Per-item status. `notChecked` means "cannot be evaluated yet", not "fine". */
export type ReadinessStatus = 'ok' | 'open' | 'notChecked'

/** One checklist row. */
export interface ReadinessItem {
  /** Stable kebab key (e.g. `schedule-set`). Only used to look up a fix link. */
  readonly id: string
  /** Staff-facing label, from the server. */
  readonly label: string
  readonly status: ReadinessStatus
  /** Optional explanation of the status, from the server. */
  readonly detail: string | null
}

/** `GET /api/staff/readiness` response body. */
export interface ExerciseReadiness {
  /** The server's verdict: no blocking item is `open`. */
  readonly ready: boolean
  readonly lifecycleState: string
  /** Items that refuse a stage while `open`. */
  readonly blocking: readonly ReadinessItem[]
  /** Items shown but never blocking. */
  readonly warnings: readonly ReadinessItem[]
}

// ---------------------------------------------------------------------------
// Transport-agnostic error
// ---------------------------------------------------------------------------

/** Construction options for {@link ReadinessError}. */
export interface ReadinessErrorInit {
  readonly status?: number
  readonly cause?: unknown
}

/**
 * A transport-agnostic failure. `status` is the HTTP status when the server
 * responded (401/403), or `undefined` when no response arrived or the body was
 * malformed.
 */
export class ReadinessError extends Error {
  readonly status?: number

  constructor(message: string, init: ReadinessErrorInit = {}) {
    super(message)
    this.name = 'ReadinessError'
    this.status = init.status
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime guards (fail closed)
// ---------------------------------------------------------------------------

function isReadinessStatus(value: unknown): value is ReadinessStatus {
  return value === 'ok' || value === 'open' || value === 'notChecked'
}

/** Validates one checklist row (also used to parse the stage refusal's `blocking` list). */
export function isReadinessItem(value: unknown): value is ReadinessItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.label === 'string' &&
    isReadinessStatus(item.status) &&
    (item.detail === null || typeof item.detail === 'string')
  )
}

/**
 * Validates a response body against the contract. Exported for tests. `detail`
 * is required-and-nullable: an absent key is rejected, matching the contract.
 */
export function isExerciseReadiness(value: unknown): value is ExerciseReadiness {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.ready === 'boolean' &&
    typeof body.lifecycleState === 'string' &&
    Array.isArray(body.blocking) &&
    body.blocking.every(isReadinessItem) &&
    Array.isArray(body.warnings) &&
    body.warnings.every(isReadinessItem)
  )
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

function toReadinessError(error: unknown): ReadinessError {
  if (axios.isAxiosError(error)) {
    return new ReadinessError(error.message, { status: error.response?.status, cause: error })
  }
  if (error instanceof Error) {
    return new ReadinessError(error.message, { cause: error })
  }
  return new ReadinessError('The readiness request failed for an unknown reason.', {
    cause: error,
  })
}

// ---------------------------------------------------------------------------
// Mock seam (DEMO CONFIG - deleted when every environment has the backend)
// ---------------------------------------------------------------------------

/** A realistic mix: some done, some open, and the two not-yet-evaluable items. */
const MOCK_READINESS: ExerciseReadiness = {
  ready: false,
  lifecycleState: 'draft',
  blocking: [
    { id: 'controller-enrolled', label: 'At least one controller is enrolled', status: 'ok', detail: null },
    {
      id: 'participant-name',
      label: 'Participant-facing exercise name is set',
      status: 'notChecked',
      detail: 'Not checked yet - arrives with story 09',
    },
    {
      id: 'participant-access',
      label: 'Participants can get in',
      status: 'open',
      detail: 'No participant accounts and no view-only code.',
    },
    { id: 'personas-bound', label: 'Every participant account has a persona', status: 'ok', detail: null },
    {
      id: 'sign-in-methods',
      label: 'A participant sign-in method is on',
      status: 'notChecked',
      detail: 'Not checked yet - needs identity-auth-roles 22',
    },
    { id: 'schedule-set', label: 'Time zone and scenario start time are set', status: 'ok', detail: null },
    { id: 'chrome-valid', label: 'Compliance chrome and watermark are valid', status: 'ok', detail: null },
    { id: 'run-sheet-repair', label: 'No run-sheet item needs repair', status: 'ok', detail: null },
  ],
  warnings: [
    { id: 'run-sheet-items', label: 'Run sheet has items', status: 'open', detail: 'The run sheet is empty.' },
    { id: 'opening-feed', label: 'Opening feed has posts', status: 'open', detail: null },
    { id: 'noise-pool', label: 'Noise pool is not empty', status: 'ok', detail: null },
    { id: 'persona-avatars', label: 'Personas have avatars', status: 'ok', detail: null },
    { id: 'sign-in-issued', label: 'Sign-in issued to every participant', status: 'ok', detail: null },
    { id: 'evaluator-enrolled', label: 'An evaluator is enrolled', status: 'ok', detail: null },
    {
      id: 'lead-controller',
      label: 'A lead controller is set',
      status: 'open',
      detail: 'Swamped mode and autonomy raises are unavailable until a planner sets a lead.',
    },
  ],
}

const mockAdapter: AxiosAdapter = config =>
  Promise.resolve({
    data: MOCK_READINESS,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })

/** The SINGLE mock/live flip point (mirrors `exerciseSettingsService.ts`). */
const USE_MOCK_READINESS = USE_MOCK_DATA

// ---------------------------------------------------------------------------
// Public seam
// ---------------------------------------------------------------------------

/**
 * Reads the go-live readiness of the exercise the SERVER resolved for this staff
 * session. Takes no arguments by design (COR-001).
 *
 * Throws `ReadinessError` on a transport failure (401/403/network) or a body
 * that does not match the contract.
 */
export async function getReadiness(): Promise<ExerciseReadiness> {
  let data: unknown
  try {
    const response = await api.get<unknown>(
      READINESS_ENDPOINT,
      USE_MOCK_READINESS ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toReadinessError(error)
  }

  if (!isExerciseReadiness(data)) {
    throw new ReadinessError('The readiness response was empty or malformed.')
  }
  return data
}
