/**
 * core/auth/tokenStore.ts
 * ---------------------------------------------------------------------------
 * The token store the shared axios client (`core/services/api.ts`) reads to
 * attach `Authorization: Bearer <token>` and writes to after a successful
 * login/silent-refresh (COR-012; feature: login, story 01 — "Frontend session
 * & token wiring", split from `identity-auth-roles/03`'s deferred "frozen-seam
 * flip" AC — see docs/features/login/01-frontend-session-token-wiring.md).
 *
 * BACKED BY `sessionStorage` — deliberately NOT `localStorage` and NOT a pure
 * in-memory (module-variable) store. This is a considered trade-off, not an
 * oversight:
 *   - `sessionStorage` is cleared when the tab closes and is never shared
 *     cross-tab, so a persistent-XSS blast radius is materially smaller than
 *     `localStorage` (NFR-004).
 *   - It still SURVIVES an in-exercise page reload — a pure in-memory store
 *     would force a full re-login on every reload, unacceptable across a
 *     multi-hour exercise.
 *
 * The access token and refresh token are stored under two SEPARATE keys
 * (never serialized together as one JSON blob), so a partial read can never
 * hand back a half-written pair.
 *
 * `getAccessToken()` / `getRefreshToken()` return `null` (never throw) when
 * absent — this module has no opinion on whether a caller SHOULD have a
 * token; that is the shared axios client's / `sessionResolver`'s concern.
 *
 * NEVER log a raw token value from this module or any caller (mirrors the
 * `[session]` / `[exerciseContext]` console-signal precedent, which never
 * includes secret material either).
 *
 * World: platform/foundation. Pure `core/` module — no UI, no COBRA, no
 * participant skin. Zero imports (a dependency-free leaf), so the shared
 * axios client can depend on it without creating a `core/services <->
 * core/auth` import cycle (see `core/services/api.ts`'s own header).
 */

const ACCESS_TOKEN_KEY = 'pulse.auth.token'
const REFRESH_TOKEN_KEY = 'pulse.auth.refreshToken'

/** The token pair persisted from a login/refresh response envelope. */
export interface TokenPair {
  /** The opaque access token presented as `Authorization: Bearer <token>`. */
  readonly token: string
  /**
   * The opaque refresh token, when the issued session has one (a shared
   * read-only session may have none — see the three login endpoints' shared
   * envelope). Omitted (not present), never an empty string.
   */
  readonly refreshToken?: string
}

/** Returns the stored access token, or `null` when none is stored. */
export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY)
}

/** Returns the stored refresh token, or `null` when none is stored. */
export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY)
}

/**
 * Persists a token pair from a login/silent-refresh response envelope.
 * `refreshToken` REPLACES any previously stored one when present (token
 * rotation); when ABSENT, any previously stored refresh token is cleared —
 * every call establishes the CURRENT session's tokens wholesale, so a stale
 * refresh token from a prior session can never linger (mirrors the "never a
 * stale/empty header" contract the axios interceptor relies on).
 */
export function setTokens({ token, refreshToken }: TokenPair): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token)
  if (refreshToken !== undefined) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  }
}

/** Clears both stored tokens. Safe to call when nothing is stored. */
export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_TOKEN_KEY)
}
