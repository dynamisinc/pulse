/**
 * features/staffPasswordReset/services/passwordResetService.ts
 * ---------------------------------------------------------------------------
 * Data seam for the staff set-password page (identity-auth-roles story 21, #576).
 *
 *   POST /auth/password/reset  { token, newPassword }   (shared axios base is `/api`)
 *     204 -> RESET token redeemed: password set
 *     200 { next: "sign-in" | "awaiting-assignment", orgSlug, email } -> INVITE token redeemed
 *     400 { error: "invalid-token" } -> link invalid/expired/used (do NOT retry the token)
 *     400 { error: "<policy-code>" } -> the password failed policy
 *     429 -> rate limited
 *
 * No mock/live split: like staff sign-in, the auth endpoints are live from day one.
 * CONTENT SECURITY: neither the token nor the password is logged or put in an error message.
 * World: STAFF, pre-auth. No UI here.
 */

import axios, { type AxiosRequestConfig } from 'axios'
import { api, type PulseRequestFlags } from '@/core/services/api'

const RESET_ENDPOINT = '/auth/password/reset'

/** Server code meaning the link itself is no good. */
export const INVALID_TOKEN_CODE = 'invalid-token'

export interface PasswordResetRequest {
  readonly token: string
  readonly newPassword: string
}

/** Transport-agnostic failure: HTTP `status` (undefined = no response) + server `code`. */
export class PasswordResetError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, init: { status?: number; code?: string } = {}) {
    super(message)
    this.name = 'PasswordResetError'
    this.status = init.status
    this.code = init.code
  }
}

/** Reads `{ error: "<code>" }` off a 400 body, if present. */
function readErrorCode(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const code = (data as Record<string, unknown>).error
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

/** What an invite redemption tells the page to do next. */
export type InviteNext = 'sign-in' | 'awaiting-assignment'

/** Body of a 200 invite redemption. */
export interface InviteLanding {
  readonly next: InviteNext
  readonly orgSlug: string
  readonly email: string
}

/** Runtime guard for the invite landing body (no `any`). */
export function parseInviteLanding(data: unknown): InviteLanding | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const body = data as Record<string, unknown>
  if (body.next !== 'sign-in' && body.next !== 'awaiting-assignment') return undefined
  if (typeof body.orgSlug !== 'string' || body.orgSlug.length === 0) return undefined
  if (typeof body.email !== 'string' || body.email.length === 0) return undefined
  return { next: body.next, orgSlug: body.orgSlug, email: body.email }
}

/**
 * Sets the password. Resolves `undefined` on 204 (reset token) or the parsed invite landing on
 * 200 (invite token); throws `PasswordResetError` otherwise.
 */
export async function resetPassword(
  request: PasswordResetRequest,
): Promise<InviteLanding | undefined> {
  try {
    // Pre-auth: never attach a stored bearer to this call (and api.ts never refresh-retries it).
    const config: AxiosRequestConfig & PulseRequestFlags = { _pulseSkipAuthAttach: true }
    const response = await api.post<unknown>(
      RESET_ENDPOINT,
      { token: request.token, newPassword: request.newPassword },
      config,
    )
    return parseInviteLanding(response?.data)
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new PasswordResetError('Password reset failed.', {
        status: error.response?.status,
        code: readErrorCode(error.response?.data),
      })
    }
    throw new PasswordResetError('Password reset failed.')
  }
}
