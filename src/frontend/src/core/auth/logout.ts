/**
 * core/auth/logout.ts
 * ---------------------------------------------------------------------------
 * The shared `logout()` helper (COR-012; feature: login, story 01 — "Frontend
 * session & token wiring"). Story 04 wires this into a logout control in both
 * worlds (participant header + `StaffHeader`); no UI lives here.
 *
 * `POST /api/auth/logout` is idempotent and always returns 204 (it never
 * reveals whether the presented token was valid — see
 * `identity-auth-roles/03-sessions.md`), so this helper NEVER surfaces a
 * failure to its caller: the browser is logged out locally regardless of the
 * network call's outcome.
 *
 * The CURRENT access token is captured and attached explicitly (rather than
 * relying on the shared axios client's request interceptor, which reads the
 * token store at request-send time) BEFORE the store is cleared — otherwise
 * the interceptor would see nothing to attach and the backend could not
 * invalidate the right session server-side (a stolen reference must not be
 * replayable). Tokens are cleared immediately after capturing them, ahead of
 * awaiting the network call (acceptable per the story AC — the tokens must
 * not survive the call either way, and clearing early means a slow/failed
 * logout request can never leave a stale token attached to this tab's next
 * request).
 *
 * World: platform/foundation. No UI, no COBRA. Never logs a raw token value.
 */
import { api } from '../services/api'
import { getAccessToken, clearTokens } from './tokenStore'

/**
 * Logs out the current session: captures the current access token, clears
 * the local token store immediately, then best-effort notifies the backend
 * (attaching the captured token explicitly) so the session is invalidated
 * server-side too. Never throws — a failed/absent network call still leaves
 * the browser logged out locally (both tokens are already cleared above).
 */
export async function logout(): Promise<void> {
  const token = getAccessToken()
  clearTokens()

  try {
    await api.post(
      '/auth/logout',
      undefined,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    )
  } catch {
    // Logout always succeeds client-side — the backend's own 204 is
    // idempotent and a network failure here must never block the caller
    // from treating the browser as logged out.
  }
}
