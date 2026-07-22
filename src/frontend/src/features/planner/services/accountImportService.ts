/**
 * features/planner/services/accountImportService.ts
 * ---------------------------------------------------------------------------
 * The bulk account-import data seam for the staff-console planner surface
 * (feature: identity-auth-roles, story 02 — named participant accounts;
 * COR-011). Consumes the FROZEN backend contract:
 *
 *   POST /api/staff/accounts/import
 *     multipart/form-data, ONE file part named `file` (.csv, <= 1 MB),
 *     staff bearer token in Authorization.
 *   200 -> AccountImportResultDto { totalRows, createdCount, failedCount,
 *          rows: [{ rowNumber, username, status, message? }] }
 *   400 -> malformed / oversized / empty / wrong type
 *   401 -> no staff session
 *
 * (see `src/Pulse.WebApi/Features/Identity/Accounts/AccountEndpoints.cs` +
 * `AccountDtos.cs`).
 *
 * MOCK SEAM (mirrors `core/auth/sessionResolver.ts` /
 * `core/exerciseContext/exerciseContextResolver.ts` /
 * `features/participant-shell/brandTokens.ts`): every request routes through
 * the shared axios client (`@/core/services/api`) so the request shape (method,
 * URL, base URL, headers, and — once wired — the staff Authorization header)
 * matches the live endpoint exactly. Mock data is swapped at EXACTLY ONE
 * env-guarded flip point (`USE_MOCK_ACCOUNT_IMPORT = USE_MOCK_DATA`), never
 * per-call, so the panel renders + is testable with no backend while a real
 * participant-facing deploy that omits the flag fails closed (COR-001) rather
 * than serving canned results.
 *
 * AUTH: this module never reads or attaches a token itself. The staff bearer
 * token is a concern of the shared client's auth layer (wired by the staff
 * identity/session story) — routing through `api` means that header flows
 * automatically once it exists, with no change here.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Exempt from the
 * participant scenario-time rule (COR-053): the import result carries no
 * timestamps and nothing here renders in-fiction.
 */

import axios, { type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type {
  AccountImportResult,
  AccountImportRowResult,
  AccountImportRowStatus,
} from '../types'

/** The import endpoint, relative to the shared client's `/api` base URL. */
const IMPORT_ENDPOINT = '/staff/accounts/import'

/** The multipart file-part name the backend contract expects (frozen: `file`). */
export const IMPORT_FILE_PART = 'file'

/** Max accepted import size in bytes — mirrors the backend `MaxImportFileBytes` (1 MB). */
export const MAX_IMPORT_FILE_BYTES = 1024 * 1024

/** `accept` attribute for the file picker (CSV only). */
export const IMPORT_FILE_ACCEPT = '.csv,text/csv'

/** The two valid per-row statuses, for the runtime guard. */
const ROW_STATUSES: readonly AccountImportRowStatus[] = ['created', 'failed']

/** Wire shape of one row in the `/import` response body. */
interface AccountImportRowResultBody {
  readonly rowNumber: number
  readonly username: string
  readonly status: AccountImportRowStatus
  readonly message?: string
}

/** Wire shape of the `/import` response body. */
interface AccountImportResultBody {
  readonly totalRows: number
  readonly createdCount: number
  readonly failedCount: number
  readonly rows: readonly AccountImportRowResultBody[]
}

/**
 * A transport-agnostic error the import path throws so the panel can render
 * clear, status-aware feedback WITHOUT coupling the component to axios
 * internals. `status` is the HTTP status when the server responded (401/400/…),
 * or `undefined` when the request never reached a response (network failure).
 * `serverMessage` is the server's own reason string, when present.
 */
export interface AccountImportErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class AccountImportError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: AccountImportErrorInit = {}) {
    super(message)
    this.name = 'AccountImportError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/**
 * A representative canned result (a mix of created + failed rows, incl. the
 * canonical duplicate-handle failure) so the panel renders end-to-end with no
 * backend. This is DEMO CONFIG, not product copy — same status as the
 * mockups' placeholder strings. Deleted when the live endpoint lands.
 */
const MOCK_IMPORT_RESULT: AccountImportResultBody = {
  totalRows: 3,
  createdCount: 2,
  failedCount: 1,
  rows: [
    { rowNumber: 1, username: 'a.rivera', status: 'created' },
    { rowNumber: 2, username: 'l.okonkwo', status: 'created' },
    {
      rowNumber: 3,
      username: 'a.rivera',
      status: 'failed',
      message: 'duplicate username a.rivera (already provisioned on row 1)',
    },
  ],
}

/**
 * Short-circuits the network with the canned result while still exercising the
 * shared axios client's request pipeline exactly as a live call would. Ignores
 * the uploaded payload (canned data, per the mock-seam precedent).
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_IMPORT_RESULT,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (mirrors the resolver precedents): mock in
 * dev/test, a real `POST /api/staff/accounts/import` in a production build
 * (fails closed until the backend + flag are set).
 */
const USE_MOCK_ACCOUNT_IMPORT = USE_MOCK_DATA

function isRowStatus(value: unknown): value is AccountImportRowStatus {
  return typeof value === 'string' && (ROW_STATUSES as readonly string[]).includes(value)
}

function isRowBody(value: unknown): value is AccountImportRowResultBody {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.rowNumber === 'number' &&
    typeof row.username === 'string' &&
    isRowStatus(row.status) &&
    (row.message === undefined || typeof row.message === 'string')
  )
}

/**
 * Runtime guard so this seam swaps to a live endpoint with no consumer change:
 * an out-of-shape response fails closed (a thrown `AccountImportError`) rather
 * than being cast blindly into `AccountImportResult`.
 */
function isResultBody(value: unknown): value is AccountImportResultBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.totalRows === 'number' &&
    typeof body.createdCount === 'number' &&
    typeof body.failedCount === 'number' &&
    Array.isArray(body.rows) &&
    body.rows.every(isRowBody)
  )
}

/** Builds a fresh, typed result literal from a validated wire body. */
function toResult(body: AccountImportResultBody): AccountImportResult {
  const rows: AccountImportRowResult[] = body.rows.map(row => ({
    rowNumber: row.rowNumber,
    username: row.username,
    status: row.status,
    ...(row.message !== undefined ? { message: row.message } : {}),
  }))
  return {
    totalRows: body.totalRows,
    createdCount: body.createdCount,
    failedCount: body.failedCount,
    rows,
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
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return undefined
}

/** Translates any thrown transport failure into an `AccountImportError`. */
function toImportError(error: unknown): AccountImportError {
  if (axios.isAxiosError(error)) {
    return new AccountImportError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new AccountImportError(error.message, { cause: error })
  }
  return new AccountImportError('The import failed for an unknown reason.', { cause: error })
}

/**
 * Uploads a CSV file to the staff bulk-import endpoint and returns the per-row
 * result summary.
 *
 * The file is sent as `multipart/form-data` with the single `file` part the
 * backend requires. The content type is set explicitly so the shared client's
 * `application/json` default cannot make axios serialize the FormData to JSON;
 * in a real browser axios then hands the boundary to the platform, and on the
 * mock path the adapter short-circuits before any of it matters.
 *
 * Throws `AccountImportError` on a transport failure (401/400/network) or a
 * malformed response body (fail-closed) — the panel renders status-aware
 * feedback from it.
 */
export async function importAccounts(file: File): Promise<AccountImportResult> {
  const formData = new FormData()
  formData.append(IMPORT_FILE_PART, file)

  let data: unknown
  try {
    const response = await api.post<AccountImportResultBody>(IMPORT_ENDPOINT, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...(USE_MOCK_ACCOUNT_IMPORT ? { adapter: mockAdapter } : {}),
    })
    data = response.data
  } catch (error) {
    throw toImportError(error)
  }

  if (!isResultBody(data)) {
    throw new AccountImportError('The import response was empty or malformed.')
  }

  return toResult(data)
}
