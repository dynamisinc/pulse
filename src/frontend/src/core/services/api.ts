/**
 * core/services/api.ts
 * ---------------------------------------------------------------------------
 * Shared axios instance for the Pulse backend API.
 *
 * Base URL comes from VITE_API_URL. When unset, requests are relative to the
 * current origin (useful for a dev proxy) — see .env.example.
 *
 * Wires the token-attach + one-shot silent-refresh seam every request in the
 * app goes through TRANSPARENTLY (COR-012; feature: login, story 01 —
 * "Frontend session & token wiring", split from `identity-auth-roles/03`'s
 * deferred "frozen-seam flip" AC — see
 * docs/features/login/01-frontend-session-token-wiring.md):
 *
 *   - REQUEST interceptor: attaches `Authorization: Bearer <token>` from
 *     `core/auth/tokenStore` when a token is stored AND the caller hasn't
 *     already supplied its own `Authorization` header (`core/auth/logout.ts`
 *     deliberately does, to attach the token it captured before clearing the
 *     store — see its own header). No stored token -> no header is ever set
 *     (never a stale/empty one). `performSilentRefresh()`'s own refresh call
 *     opts OUT of this attach entirely (`_pulseSkipAuthAttach`, below) — the
 *     backend reads the refresh token from the request BODY, so presenting
 *     the (possibly expired) access token on that call is both pointless and
 *     unnecessary token-exposure surface.
 *   - RESPONSE interceptor: on a 401, with a stored refresh token, attempts
 *     EXACTLY ONE silent `POST /auth/refresh` and retries the ORIGINAL
 *     request once on success, with the rotated token attached. A refresh
 *     failure (401 or a network error) clears both tokens and the original
 *     401 propagates — no retry loop. `/auth/refresh`, `/auth/logout`, and
 *     the three login endpoints are excluded from ever TRIGGERING this path,
 *     so a failing refresh can't recursively retrigger itself, a logout 401
 *     can never spin up a refresh (explicit, not left emergent), and a
 *     bad-credentials login 401 is never misread as an expired session.
 *     Concurrent 401s coalesce onto a single in-flight refresh call (never
 *     more than one outstanding `POST /auth/refresh` at a time).
 *
 * DELIBERATELY depends on `core/auth/tokenStore` ONLY — a dependency-free
 * leaf module — never on `core/auth/sessionResolver` or `session.tsx`, so
 * `core/services -> core/auth` stays a ONE-WAY edge (no import cycle) and
 * this module stays framework-agnostic: no `react-router` import here — this
 * module is imported by `core/exerciseContext`, `core/auth`, and every
 * feature; a router dependency here would be a layering violation.
 *
 * No token is ever logged (console or otherwise) by this module.
 */
import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../auth/tokenStore'

/**
 * Internal per-request flags this module attaches to a config object. Not
 * part of the public axios config surface — a documented escape hatch this
 * file alone reads and writes.
 */
interface PulseRequestFlags {
  /**
   * Tells the REQUEST interceptor to skip attaching the stored access token
   * for this one call, even though the caller didn't supply its own
   * `Authorization` header. Used by `performSilentRefresh()`'s own
   * `POST /auth/refresh` call — see this module's header.
   */
  _pulseSkipAuthAttach?: boolean
  /**
   * Marks a request that has already gone through one refresh-retry cycle
   * (response interceptor).
   */
  _pulseRefreshRetried?: boolean
}

/**
 * Shared axios instance for the Pulse backend API.
 *
 * Base URL comes from VITE_API_URL. When unset, requests are relative to the
 * current origin (useful for a dev proxy) — see .env.example.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// ---------------------------------------------------------------------------
// Request interceptor — attach the stored access token.
// ---------------------------------------------------------------------------

api.interceptors.request.use(config => {
  const flags = config as InternalAxiosRequestConfig & PulseRequestFlags
  if (!flags._pulseSkipAuthAttach && !config.headers.has('Authorization')) {
    const token = getAccessToken()
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`)
    }
  }
  return config
})

// ---------------------------------------------------------------------------
// Response interceptor — one-shot silent refresh on 401.
// ---------------------------------------------------------------------------

/**
 * Endpoints that must NEVER trigger the silent-refresh retry: the refresh
 * endpoint itself (so a failing refresh can't recursively retrigger a
 * refresh), the logout endpoint (explicit rather than emergent — a 401 there
 * must never spin up a refresh either), and the three login endpoints (a
 * bad-credentials 401 there is not an expired session — see the three login
 * endpoints' shared envelope, docs/features/login/implementation.md's reuse
 * map).
 */
const NO_REFRESH_RETRY_PATHS = new Set([
  '/auth/refresh',
  '/auth/logout',
  '/auth/login',
  '/auth/staff/login',
  '/auth/shared',
])

function isExcludedFromRefresh(url: string | undefined): boolean {
  return url !== undefined && NO_REFRESH_RETRY_PATHS.has(url)
}

/** The wire shape this module reads off a `POST /auth/refresh` response. */
interface RefreshResponseBody {
  readonly token?: string
  readonly refreshToken?: string
}

/** A single in-flight refresh call, COALESCED across concurrent 401s. */
let refreshInFlight: Promise<string | null> | null = null

/**
 * Performs the silent refresh: `POST /auth/refresh` with the stored refresh
 * token. Stores the rotated tokens and returns the new access token on
 * success; clears both tokens and returns `null` on any failure (no stored
 * refresh token, a request failure, or a malformed response) — fail-closed,
 * and never attempts the network call at all when there is no refresh token
 * to present.
 */
async function performSilentRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearTokens()
    return null
  }

  try {
    // `_pulseSkipAuthAttach`: the backend reads the refresh token from the
    // BODY, never the Authorization header — presenting the (possibly
    // expired) access token here is pointless and unnecessary exposure.
    const refreshRequestConfig: AxiosRequestConfig & PulseRequestFlags = {
      _pulseSkipAuthAttach: true,
    }
    const response = await api.post<RefreshResponseBody>(
      '/auth/refresh',
      { refreshToken },
      refreshRequestConfig,
    )
    const { token, refreshToken: rotatedRefreshToken } = response.data
    if (!token || !rotatedRefreshToken) {
      clearTokens()
      return null
    }
    setTokens({ token, refreshToken: rotatedRefreshToken })
    return token
  } catch {
    clearTokens()
    return null
  }
}

/** Coalesces concurrent 401s onto a single in-flight `performSilentRefresh()` call. */
function silentRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performSilentRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

api.interceptors.response.use(
  response => response,
  (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error)
    }

    const config = error.config as (InternalAxiosRequestConfig & PulseRequestFlags) | undefined
    if (!config || config._pulseRefreshRetried || isExcludedFromRefresh(config.url)) {
      return Promise.reject(error)
    }
    config._pulseRefreshRetried = true

    return silentRefresh().then(newToken => {
      if (!newToken) {
        return Promise.reject(error)
      }
      config.headers.set('Authorization', `Bearer ${newToken}`)
      return api.request(config)
    })
  },
)

export default api
