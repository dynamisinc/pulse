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
 *     failure (401 or a network error) clears BOTH token stores and the
 *     original 401 propagates — no retry loop. `/auth/refresh`, `/auth/logout`,
 *     the three login endpoints and the two participant easy-login endpoints
 *     (`/auth/join`, `/auth/word`) are excluded from ever TRIGGERING this
 *     path, so a failing refresh can't recursively retrigger itself, a logout
 *     401 can never spin up a refresh (explicit, not left emergent), and a
 *     rejected credential, link or word is never misread as an expired
 *     session. Concurrent 401s coalesce onto a single in-flight refresh call
 *     (never more than one outstanding `POST /auth/refresh` per tab).
 *
 * TOKEN STORE AND TABS (easy-login story 07, EL-10). A participant's tokens
 * live in `localStorage` (shared by every tab), a staff user's in
 * `sessionStorage`; see `core/auth/tokenStore`. The silent refresh therefore:
 *   - stores the rotated pair in the SAME store the current pair lives in
 *     (`isPersistentSession()`), with no option passed by any caller;
 *   - runs under a Web Lock (`navigator.locks`), so two tabs that 401 together
 *     make ONE refresh call: the second waits, finds the stored access token
 *     is no longer the one its request was rejected with, and ADOPTS the pair
 *     the first tab already rotated instead of presenting a spent refresh
 *     token (which the server would refuse, and which used to sign BOTH tabs
 *     out via `clearTokens()`);
 *   - where the Locks API is absent (jsdom, very old browsers) it still adopts
 *     if it can, and a refresh that FAILS re-reads the stored refresh token
 *     before giving up: if another tab changed it since this attempt began,
 *     it retries ONCE with the new value instead of clearing;
 *   - never writes over, or clears, a sign-in/sign-out this tab performed while
 *     its refresh call was in flight (`getTokenGeneration()`).
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
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  isPersistentSession,
  getTokenGeneration,
} from '../auth/tokenStore'

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
 * must never spin up a refresh either), the three login endpoints (a
 * bad-credentials 401 there is not an expired session — see the three login
 * endpoints' shared envelope, docs/features/login/implementation.md's reuse
 * map) and the two easy-login participant sign-ins, `/auth/join` (personal
 * link) and `/auth/word` (sign-in name + day word): a rejected link or word
 * is a failed sign-in, never an expired session, and must not be retried.
 */
const NO_REFRESH_RETRY_PATHS = new Set([
  '/auth/refresh',
  '/auth/logout',
  '/auth/login',
  '/auth/staff/login',
  '/auth/shared',
  '/auth/join',
  '/auth/word',
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

/** The Web Lock every tab's refresh runs under (one holder at a time, origin-wide). */
const REFRESH_LOCK_NAME = 'pulse.auth.refresh'

/**
 * Runs `work` under the origin-wide refresh Web Lock, so tabs sharing
 * `localStorage` refresh ONE AT A TIME. Feature-detects `navigator.locks`
 * (absent in jsdom and older browsers) and degrades to running `work`
 * directly; also degrades if the lock request itself is refused before
 * `work` started (e.g. an opaque origin). `work` must not throw (the refresh
 * attempts below catch everything); if it somehow does after starting, that
 * error propagates untouched rather than being run a second time.
 */
async function runUnderRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  const locks: LockManager | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks || typeof locks.request !== 'function') {
    return work()
  }
  let started = false
  try {
    return (await locks.request(REFRESH_LOCK_NAME, () => {
      started = true
      return work()
    })) as T
  } catch (error) {
    if (started) throw error
    return work()
  }
}

/** The outcome of one `POST /auth/refresh` attempt. */
type RotationResult =
  | { readonly kind: 'rotated'; readonly token: string }
  /** Refused, network error, or a malformed response: fail closed. */
  | { readonly kind: 'failed' }
  /** This tab signed in or out while the call was in flight; its result is stale. */
  | { readonly kind: 'superseded' }

/**
 * One `POST /auth/refresh` with `refreshToken`. On success stores the rotated
 * pair in the SAME store the current pair lives in (never chosen by a caller).
 * Never throws and never clears anything: the caller decides what a failure
 * means.
 */
async function rotate(refreshToken: string): Promise<RotationResult> {
  const persist = isPersistentSession()
  const generation = getTokenGeneration()
  let rotated: RefreshResponseBody | null
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
    rotated = response.data
  } catch {
    rotated = null
  }

  // Signed out (or in as someone else) in THIS tab while the call was in
  // flight: writing the rotated pair would resurrect the old session, and
  // clearing on a failure would wipe the new one. Leave the store alone.
  if (getTokenGeneration() !== generation) return { kind: 'superseded' }

  const token = rotated?.token
  const rotatedRefreshToken = rotated?.refreshToken
  if (!token || !rotatedRefreshToken) return { kind: 'failed' }
  setTokens({ token, refreshToken: rotatedRefreshToken }, { persist })
  return { kind: 'rotated', token }
}

/**
 * Performs the silent refresh (always called under the refresh lock where the
 * Locks API exists). `rejectedToken` is the access token the 401'd request was
 * SENT with.
 *
 *  1. ADOPT: if the stored access token is no longer `rejectedToken`, another
 *     tab (or an earlier refresh in this one) already rotated the pair; hand
 *     back the stored token without calling the server.
 *  2. Otherwise `POST /auth/refresh` with the stored refresh token and store
 *     the rotated pair in the same store (see `rotate`).
 *  3. On a failure, re-read the stored refresh token. If it CHANGED since the
 *     attempt began (another tab rotated it without our noticing: the no-Locks
 *     path), retry ONCE with the new value instead of clearing.
 *  4. Any remaining failure (no refresh token, a refused/failed call, a
 *     malformed response) clears BOTH stores and returns `null` — fail-closed.
 *     No network call is made at all when there is no refresh token to present.
 */
async function performSilentRefresh(rejectedToken: string | null): Promise<string | null> {
  const current = getAccessToken()
  if (current !== null && current !== rejectedToken) {
    return current
  }

  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearTokens()
    return null
  }

  const first = await rotate(refreshToken)
  if (first.kind === 'rotated') return first.token
  if (first.kind === 'superseded') return null

  const latest = getRefreshToken()
  if (latest !== null && latest !== refreshToken) {
    const second = await rotate(latest)
    if (second.kind === 'rotated') return second.token
    if (second.kind === 'superseded') return null
  }

  clearTokens()
  return null
}

/** Coalesces concurrent 401s onto a single in-flight `performSilentRefresh()` call. */
function silentRefresh(rejectedToken: string | null): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = runUnderRefreshLock(() => performSilentRefresh(rejectedToken))
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

/** The bearer token a request was SENT with, or `null` if it carried none. */
function sentBearerToken(config: InternalAxiosRequestConfig): string | null {
  const header: unknown = config.headers.get('Authorization')
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null
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

    return silentRefresh(sentBearerToken(config)).then(newToken => {
      if (!newToken) {
        return Promise.reject(error)
      }
      config.headers.set('Authorization', `Bearer ${newToken}`)
      return api.request(config)
    })
  },
)

export default api
