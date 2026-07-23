/**
 * features/login/services/staffSignInService.ts
 * ---------------------------------------------------------------------------
 * The staff sign-in data seam (feature: login, story 03 — "Staff sign-in";
 * GitHub #306). Consumes the FROZEN backend contract:
 *
 *   POST /auth/staff/login  { username, secret, exerciseId }
 *     200 -> success envelope { token, refreshToken?, session: {...} }
 *            (same envelope shape as every login endpoint)
 *     401 -> rejected credentials
 *     403 -> authenticated but NOT assigned to this exercise
 *            (`StaffLoginOutcome.NotAssigned`) — a DISTINCT, actionable
 *            failure from 401; `status` lets the page tell them apart
 *     400 -> invalid body (shouldn't happen once all three fields are sent)
 *
 * MOCK SEAM: deliberately NONE. Staff login is a live endpoint from day one
 * (per the story brief) — this module always routes through the real shared
 * axios client (`@/core/services/api`) with no mock/live flip point, unlike
 * `staffAssignmentsService.ts` / `exerciseContextResolver.ts`.
 *
 * ERROR SHAPE: mirrors `StaffAssignmentError`
 * (`features/staff/services/staffAssignmentsService.ts`) — a transport-
 * agnostic `StaffSignInError` carrying the HTTP `status` (when the server
 * responded) so the page can render DISTINCT copy for 401 vs 403 without
 * coupling itself to axios internals. `status` is `undefined` for a request
 * that never reached a response (network failure).
 *
 * CONTENT SECURITY (NFR-004/NFR-009): the `secret` field is never logged by
 * this module (or echoed into any thrown error message) — only the resolved
 * HTTP status and the server's own reason string (if any) are captured. No
 * token is ever logged either.
 *
 * AUTH: this module never reads or attaches a token itself (there is none yet
 * — this IS the call that mints one). Storing the returned token pair is the
 * caller's (`StaffSignInPage`) responsibility via `@/core/auth`'s `setTokens`.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Exempt from the
 * participant scenario-time rule (COR-053): this seam carries no
 * participant-visible timestamps.
 */

import axios from 'axios'
import { api } from '@/core/services/api'

/** The single endpoint this seam consumes, relative to the shared client's `/api` base URL. */
const STAFF_LOGIN_ENDPOINT = '/auth/staff/login'

/** The credentials this seam sends. `exerciseId` is HOST-resolved, never user-entered. */
export interface StaffSignInCredentials {
  readonly username: string
  readonly secret: string
  readonly exerciseId: string
}

/**
 * Wire shape of a successful `POST /auth/staff/login` response (200) — the
 * same success envelope every login endpoint returns. The page only needs
 * `token`/`refreshToken`; `session` is passed through untyped (`unknown`)
 * since this story does not consume it.
 */
export interface StaffLoginEnvelope {
  readonly token: string
  readonly refreshToken?: string
  readonly session: unknown
}

/**
 * A transport-agnostic error this seam throws so the page can render clear,
 * status-aware feedback without coupling itself to axios internals. `status`
 * is the HTTP status when the server responded (401/403/400/…), or
 * `undefined` when the request never reached a response (network failure).
 * Mirrors `StaffAssignmentError` (`features/staff/services`).
 */
export interface StaffSignInErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class StaffSignInError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: StaffSignInErrorInit = {}) {
    super(message)
    this.name = 'StaffSignInError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/** Runtime guard: a valid envelope has a non-empty `token` and a `session` field. */
function isStaffLoginEnvelope(value: unknown): value is StaffLoginEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.token === 'string' && body.token.length > 0 &&
    'session' in body &&
    (body.refreshToken === undefined || typeof body.refreshToken === 'string')
  )
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

/** Translates any thrown transport failure into a `StaffSignInError`. Never echoes `secret`. */
function toStaffSignInError(error: unknown, fallbackMessage: string): StaffSignInError {
  if (error instanceof StaffSignInError) {
    return error
  }
  if (axios.isAxiosError(error)) {
    return new StaffSignInError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new StaffSignInError(error.message, { cause: error })
  }
  return new StaffSignInError(fallbackMessage, { cause: error })
}

/**
 * Signs a staff member in for the given (host-resolved) exercise. Throws
 * `StaffSignInError` on any transport failure (401/403/400/network) or a
 * malformed/empty response body — fail closed, never a partial success.
 * `credentials.secret` is sent in the request body only; never logged.
 */
export async function staffSignIn(
  credentials: StaffSignInCredentials,
): Promise<StaffLoginEnvelope> {
  let data: unknown
  try {
    const response = await api.post<StaffLoginEnvelope>(STAFF_LOGIN_ENDPOINT, credentials)
    data = response.data
  } catch (error) {
    throw toStaffSignInError(error, 'Could not reach the sign-in service.')
  }

  if (!isStaffLoginEnvelope(data)) {
    throw new StaffSignInError('staffSignIn: response was empty or malformed.')
  }

  return data
}
