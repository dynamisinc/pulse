/**
 * features/login/services/participantSignInService.ts
 * ---------------------------------------------------------------------------
 * The participant sign-in data seam (feature: login, story 02 — "Participant
 * sign-in"; GitHub #305). Consumes the FROZEN backend contract built in story
 * 01 / identity-auth-roles:
 *
 *   POST /auth/login   { username, password }  — named account
 *   POST /auth/shared  { password }            — shared exercise code
 *
 * BOTH return the SAME success envelope: `{ token, refreshToken?, session? }`.
 * A bad credential/code responds 401 on either endpoint. See
 * `@/core/services/api.ts`'s own header for why these two paths (plus
 * `/auth/staff/login`) are excluded from the shared client's silent-refresh
 * retry — a bad-credentials 401 here is never mistaken for an expired
 * session.
 *
 * NO MOCK ADAPTER (deliberately, unlike `exerciseContextResolver.ts` /
 * `sessionResolver.ts` / `staffAssignmentsService.ts`): signing in is
 * inherently a live call to a real backend — there is no meaningful "mock
 * login" to render a page against, and a canned success would defeat the
 * purpose of a credentials gate. Every call here always routes through the
 * shared axios client with no `adapter:` escape hatch.
 *
 * ERROR TRANSLATION mirrors `staffAssignmentsService.ts`'s
 * `StaffAssignmentError` precedent: `ParticipantSignInError` carries a
 * transport-agnostic `status`/`serverMessage` so the page can render clear
 * feedback without coupling itself to axios internals.
 * `isUnauthorizedSignInError()` is the ONE seam the page uses to detect "bad
 * credentials/code" (status 401) — the page never inspects `serverMessage`
 * for that decision, so a server that happens to distinguish "no such
 * handle" from "wrong password" in its own logs can never leak that
 * distinction into the participant-facing copy (NFR-009, anti-enumeration).
 *
 * NEVER logs a username, password, or token — this module has no console
 * output at all, matching `tokenStore.ts` / `core/services/api.ts`'s own
 * precedent.
 *
 * World: participant. Pure data/service module — no UI, no COBRA, no
 * participant skin. Exempt from the scenario-time rule (COR-053): this seam
 * carries no participant-visible timestamps.
 */

import axios from 'axios'
import { api } from '@/core/services/api'

const LOGIN_ENDPOINT = '/auth/login'
const SHARED_ENDPOINT = '/auth/shared'

/** Named-account credentials for `POST /auth/login`. */
export interface NamedSignInCredentials {
  readonly username: string
  readonly password: string
}

/** The shared exercise code for `POST /auth/shared` (a single password field). */
export interface SharedSignInCredentials {
  readonly password: string
}

/**
 * The shared success envelope BOTH endpoints return. The page only needs
 * `token` + `refreshToken` (passed straight to `setTokens()`); `session` is
 * carried through untyped since neither this seam nor the page reads it.
 */
export interface LoginEnvelope {
  readonly token: string
  readonly refreshToken?: string
  readonly session?: unknown
}

/**
 * A transport-agnostic error this seam throws so the page can render clear
 * feedback WITHOUT coupling itself to axios internals. `status` is the HTTP
 * status when the server responded (401/…), or `undefined` when the request
 * never reached a response (network failure). Mirrors `StaffAssignmentError`
 * (`features/staff/services/staffAssignmentsService.ts`).
 */
export interface ParticipantSignInErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class ParticipantSignInError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: ParticipantSignInErrorInit = {}) {
    super(message)
    this.name = 'ParticipantSignInError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/**
 * True when `error` is a `ParticipantSignInError` for a 401 (bad
 * handle/password or bad shared code) — the ONE signal the page uses to show
 * the generic anti-enumeration message (NFR-009). Anything else (network
 * failure, 5xx, malformed response) is a different, non-enumeration failure
 * the page renders with its own generic "try again" copy.
 */
export function isUnauthorizedSignInError(error: unknown): boolean {
  return error instanceof ParticipantSignInError && error.status === 401
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

/** Translates any thrown transport failure into a `ParticipantSignInError`. */
function toSignInError(error: unknown, fallbackMessage: string): ParticipantSignInError {
  if (error instanceof ParticipantSignInError) {
    return error
  }
  if (axios.isAxiosError(error)) {
    return new ParticipantSignInError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new ParticipantSignInError(error.message, { cause: error })
  }
  return new ParticipantSignInError(fallbackMessage, { cause: error })
}

/**
 * Runtime guard so this seam stays defensive against a malformed/empty
 * response body: an out-of-shape envelope fails closed (throws) rather than
 * handing the page a `token` that doesn't exist. `refreshToken`/`session` are
 * optional — a shared read-only session may omit `refreshToken` entirely.
 */
function isLoginEnvelope(value: unknown): value is LoginEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.token === 'string' && body.token.length > 0 &&
    (body.refreshToken === undefined || typeof body.refreshToken === 'string')
  )
}

/**
 * Signs in with a named account: `POST /auth/login`. Throws
 * `ParticipantSignInError` on failure (bad credentials, network failure, or a
 * malformed response) — fail closed, never a default/partial envelope.
 */
export async function signInWithPassword(
  credentials: NamedSignInCredentials,
): Promise<LoginEnvelope> {
  let data: unknown
  try {
    const response = await api.post<LoginEnvelope>(LOGIN_ENDPOINT, credentials)
    data = response.data
  } catch (error) {
    throw toSignInError(error, 'Could not sign in. Please try again.')
  }

  if (!isLoginEnvelope(data)) {
    throw new ParticipantSignInError('signInWithPassword: response was empty or malformed.')
  }

  return data
}

/**
 * Signs in with the shared exercise code: `POST /auth/shared`. Throws
 * `ParticipantSignInError` on failure (bad code, network failure, or a
 * malformed response) — fail closed, never a default/partial envelope.
 */
export async function signInWithSharedCode(
  credentials: SharedSignInCredentials,
): Promise<LoginEnvelope> {
  let data: unknown
  try {
    const response = await api.post<LoginEnvelope>(SHARED_ENDPOINT, credentials)
    data = response.data
  } catch (error) {
    throw toSignInError(error, 'Could not sign in. Please try again.')
  }

  if (!isLoginEnvelope(data)) {
    throw new ParticipantSignInError('signInWithSharedCode: response was empty or malformed.')
  }

  return data
}
