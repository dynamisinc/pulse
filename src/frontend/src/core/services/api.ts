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
 *     request once on success, with the rotated token attached. Only a
 *     REFUSAL ends the session: when `/auth/refresh` itself answers 401 or 403
 *     (the server says the refresh token is unknown, spent, revoked or past
 *     its window; `SessionEndpoints` answers 401 for all of those) the token store
 *     this page's session lives in is cleared (never the other one: a staff tab
 *     must not wipe a participant's `localStorage` pair, and an explicit
 *     `logout()` is what clears both) and the original 401 propagates, with no
 *     retry loop. A refusal is only acted on if the session is still OURS: if
 *     another tab signed in as someone else meanwhile, their pair is left alone.
 *     A refresh that gets NO ANSWER, or an answer that is not a refusal (no
 *     response at all, a network error, the 20 s timeout, a 5xx, a 429, a 2xx
 *     with no tokens in it) does NOT sign anyone out, staff or participant:
 *     the stored pair is kept, the original request is rejected with its own
 *     error so the caller sees an ordinary failure, and the NEXT 401 simply
 *     tries the refresh again. (Easy-login 07, amended: with day-long
 *     participant sessions, one dropped request on a phone must never log
 *     someone out of the exercise.) `/auth/refresh`, `/auth/logout`,
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
 *   - stores the rotated pair in the SAME store the current pair lives in and
 *     under the SAME session identity marker (`rotateTokens()`), with no option
 *     passed by any caller;
 *   - runs under a Web Lock (`navigator.locks`), so two tabs that 401 together
 *     make ONE refresh call: the second waits, finds the stored access token
 *     is no longer the one its request was rejected with, and ADOPTS the pair
 *     the first tab already rotated instead of presenting a spent refresh
 *     token (which the server would refuse, and which used to sign BOTH tabs
 *     out via a blanket clear). A waiter gives up on the lock after 45 s (a
 *     tab that was suspended while holding it, say iOS) and carries on without
 *     it, via the path below;
 *   - where the Locks API is absent (jsdom, very old browsers) it still adopts
 *     if it can, and a refresh the server REFUSES re-reads the stored refresh
 *     token before giving up: if another tab changed it since this attempt
 *     began (and it is still the same sign-in), it retries ONCE with the new
 *     value instead of clearing;
 *   - NEVER ADOPTS ANOTHER USER'S PAIR. `localStorage` is shared, so another tab
 *     may have signed in as someone else. Each request remembers the session
 *     identity marker that was current when it was sent; if the stored marker
 *     has since changed, the request is rejected with its own error: it is not
 *     retried with the new user's token, and the new user's pair is neither
 *     refreshed nor cleared. (`core/auth/crossTabSessionSync`, installed below,
 *     reloads the tab so its UI follows the store.);
 *   - NEVER UNDOES A SIGN-OUT. `logout()` in tab B clears the stores while tab A's
 *     refresh is on the wire, and it carries the PRE-rotation access token, which
 *     the server has just replaced, so the server-side logout misses. When A's
 *     response arrives `rotateTokens()` finds the refresh token it presented is
 *     no longer stored and writes NOTHING; A then best-effort revokes the session
 *     the server just issued (`POST /auth/logout` with the NEW access token,
 *     errors ignored) and the original request is rejected with its own error.
 *     That protection does not depend on the Web Lock (a sign-out never takes it);
 *   - a refresh this tab's own sign-in/sign-out overtakes (`getTokenGeneration()`)
 *     is never retried or cleared on, so it can't wipe a fresh sign-in;
 *   - gives the refresh call (that call only, never the shared instance) a 20 s
 *     timeout. A holder therefore keeps the lock for about 2 x 20 s at the very
 *     most (a refresh and its one re-read retry) and a waiter gives up on it after
 *     45 s, so the real bound on one request's refresh is about 45 s of waiting
 *     plus 2 x 20 s of its own calls, not "a hung request blocks everyone". A
 *     timeout counts as "no answer" (above): nothing is cleared;
 *   - after a NO-ANSWER refresh, waits out a cool-down (the response's
 *     `Retry-After` seconds, else 15 s, never more than 120 s) before the next
 *     401 may call the refresh again; during it a 401 is rejected with its own
 *     error. Without it a down server would be hit by a refresh per 401, per tab,
 *     per poll. It is timed on `performance.now()` (a monotonic clock a changed wall
 *     clock cannot skip), not `Date.now()`. A new sign-in or sign-out in this tab
 *     ends the cool-down.
 *
 * KNOWN TRADE-OFF WITHOUT THE LOCKS API. Two tabs then refresh concurrently with
 * the same refresh token. The server accepts one and refuses the other, and the
 * refused tab re-reads and retries. If the refused tab's answer lands BEFORE the
 * winner has stored its pair, the refused tab sees the token unchanged and
 * clears; the winner's `rotateTokens()` then finds nothing stored, writes
 * nothing and revokes its new session. Both tabs end up signed out. That is a
 * window of milliseconds in browsers old enough to lack Web Locks (all current
 * Chrome, Firefox and Safari have them), and it was chosen deliberately over the
 * alternative, letting a stale refresh response resurrect a session another tab
 * just signed out of (which also left the server-side session live all day).
 * Failing closed here costs one re-sign-in; failing open costs a sign-out that
 * does not stick. Web Storage offers no cross-tab atomic compare-and-swap, so
 * even `rotateTokens()`' check and write are two synchronous steps (microseconds).
 *
 * DELIBERATELY depends on `core/auth/tokenStore` (a dependency-free leaf) and
 * `core/auth/crossTabSessionSync` (a leaf that imports only `tokenStore`) ONLY —
 * never on `core/auth/sessionResolver` or `session.tsx`, so
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
  getSessionMarker,
  rotateTokens,
  clearActiveTokens,
  getTokenGeneration,
} from '../auth/tokenStore'
import { installCrossTabSessionSync } from '../auth/crossTabSessionSync'

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
  /**
   * The session identity marker that was current when the request-interceptor
   * attached the stored access token. A 401 is only ever retried with a token
   * of the SAME sign-in (see this module's header).
   */
  _pulseSessionMarker?: string | null
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

// Another tab signing in as someone else, or signing out, reloads this one so its
// UI follows the shared token store (installed once per page; see its header).
installCrossTabSessionSync()

// ---------------------------------------------------------------------------
// Request interceptor — attach the stored access token.
// ---------------------------------------------------------------------------

api.interceptors.request.use(config => {
  const flags = config as InternalAxiosRequestConfig & PulseRequestFlags
  if (!flags._pulseSkipAuthAttach && !config.headers.has('Authorization')) {
    const token = getAccessToken()
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`)
      flags._pulseSessionMarker = getSessionMarker()
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

/**
 * A single in-flight refresh call, COALESCED across concurrent 401s. Tagged with
 * the session identity marker of the request that started it, so a request that
 * was sent under a DIFFERENT sign-in never borrows its result.
 */
let refreshInFlight: {
  readonly marker: string | null
  readonly promise: Promise<string | null>
} | null = null

/** The Web Lock every tab's refresh runs under (one holder at a time, origin-wide). */
const REFRESH_LOCK_NAME = 'pulse.auth.refresh'

/**
 * How long the `POST /auth/refresh` call may take before it is abandoned. Set on
 * THAT call only (never `api.defaults`): the refresh runs while holding the
 * origin-wide Web Lock, so a hung request would otherwise block every other
 * tab's refresh. An abandoned call is "no answer", which clears nothing.
 */
const REFRESH_TIMEOUT_MS = 20_000

/**
 * How long a tab waits for the refresh Web Lock before giving up on it. A holder
 * is bounded by the refresh timeout (about 2 x 20 s), but a tab suspended while
 * holding the lock (iOS) is not, so a waiter must not wait forever.
 */
const LOCK_WAIT_TIMEOUT_MS = 45_000

/** Cool-down after a no-answer refresh when the response named no `Retry-After`. */
const DEFAULT_REFRESH_COOLDOWN_SECONDS = 15
/** A `Retry-After` longer than this is capped: it must not park a day-long session. */
const MAX_REFRESH_COOLDOWN_SECONDS = 120

/**
 * Runs `work` under the origin-wide refresh Web Lock, so tabs sharing
 * `localStorage` refresh ONE AT A TIME. Feature-detects `navigator.locks`
 * (absent in jsdom and older browsers) and degrades to running `work`
 * directly. The wait for the lock is bounded (`AbortSignal.timeout`, where it
 * exists): on timeout, or if the lock request is refused before `work`
 * started (e.g. an opaque origin), `work` runs WITHOUT the lock, with the
 * re-read retry as its protection. `work` must not throw (the refresh attempts
 * below catch everything); if it somehow does after starting, that error
 * propagates untouched rather than being run a second time.
 */
async function runUnderRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  const locks: LockManager | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks || typeof locks.request !== 'function') {
    return work()
  }
  let started = false
  try {
    const options: LockOptions = {}
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      options.signal = AbortSignal.timeout(LOCK_WAIT_TIMEOUT_MS)
    }
    return (await locks.request(REFRESH_LOCK_NAME, options, () => {
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
  /** The server answered 401 or 403: the refresh token is no good (ends the session). */
  | { readonly kind: 'refused' }
  /**
   * No usable answer: no response, a network error, the timeout, a 5xx or 429,
   * an unexpected 400/404, or a 2xx without tokens. Says nothing about the
   * session, so nothing is cleared; the caller starts a cool-down instead.
   */
  | { readonly kind: 'unavailable'; readonly retryAfterSeconds?: number }
  /**
   * The result must not be used: this tab signed in or out while the call was in
   * flight, or (success only) another tab signed out or in. Nothing was written.
   */
  | { readonly kind: 'superseded' }

/** `true` when the server itself refused the refresh token (401 or 403). */
function isRefusal(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  const status = error.response?.status
  return status === 401 || status === 403
}

/** The `Retry-After` delay in whole seconds from an error response, if it named one. */
function retryAfterSecondsOf(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) return undefined
  const headers = error.response?.headers
  const raw: unknown = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : headers?.['retry-after']
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const seconds = typeof raw === 'number' ? raw : Number(raw.trim())
  return raw !== '' && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/**
 * A clock for the cool-down that the user (or an NTP step, or a suspended phone
 * waking up) cannot move: `performance.now()`, falling back to `Date.now()` only
 * where there is no `performance`. Read at call time, never cached.
 */
function monotonicNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

/** When (and for which sign-in state) a no-answer refresh told this tab to back off. */
let refreshCooldown: { readonly until: number; readonly generation: number } | null = null

function startRefreshCooldown(retryAfterSeconds: number | undefined): void {
  const seconds = Math.min(
    retryAfterSeconds ?? DEFAULT_REFRESH_COOLDOWN_SECONDS,
    MAX_REFRESH_COOLDOWN_SECONDS,
  )
  refreshCooldown = { until: monotonicNowMs() + seconds * 1000, generation: getTokenGeneration() }
}

/** `true` while a no-answer refresh's cool-down runs. A sign-in/out in this tab ends it. */
function isRefreshCoolingDown(): boolean {
  return refreshCooldown !== null &&
    refreshCooldown.generation === getTokenGeneration() &&
    monotonicNowMs() < refreshCooldown.until
}

/**
 * Ends a no-answer refresh's cool-down so the NEXT 401 may call the refresh again.
 * For a deliberate, user-initiated retry only (the session provider's "Try again" on
 * its "Reconnecting..." screen): the cool-down exists to stop AUTOMATIC per-401 refresh
 * calls hammering a server that is down, and a person pressing a button is not that.
 * Harmless when no cool-down is running.
 */
export function endRefreshCooldown(): void {
  refreshCooldown = null
}

/**
 * Best-effort: ends the server-side session a refresh just issued but this tab
 * must not keep (the user signed out, or someone else signed in, while the call
 * was in flight). Fire-and-forget, errors ignored. It presents the NEW access
 * token explicitly (the store no longer holds it), which is exactly the token a
 * logout from the other tab could not have known.
 */
function revokeIssuedSession(accessToken: string): void {
  void api
    .post('/auth/logout', undefined, { headers: { Authorization: `Bearer ${accessToken}` } })
    .catch(() => undefined)
}

/**
 * One `POST /auth/refresh` with `refreshToken`. On success stores the rotated
 * pair via `rotateTokens()`: the same store, the same identity marker, and only
 * if that store still holds `refreshToken`. Never throws and never clears
 * anything: the caller decides what a refusal means (and an `unavailable` result
 * means nothing at all).
 */
async function rotate(refreshToken: string): Promise<RotationResult> {
  const generation = getTokenGeneration()
  let body: RefreshResponseBody | null | undefined
  let refused = false
  let retryAfterSeconds: number | undefined
  try {
    // `_pulseSkipAuthAttach`: the backend reads the refresh token from the
    // BODY, never the Authorization header — presenting the (possibly
    // expired) access token here is pointless and unnecessary exposure.
    // `timeout`: this call only; see REFRESH_TIMEOUT_MS.
    const refreshRequestConfig: AxiosRequestConfig & PulseRequestFlags = {
      _pulseSkipAuthAttach: true,
      timeout: REFRESH_TIMEOUT_MS,
    }
    const response = await api.post<RefreshResponseBody>(
      '/auth/refresh',
      { refreshToken },
      refreshRequestConfig,
    )
    body = response.data
  } catch (error) {
    refused = isRefusal(error)
    retryAfterSeconds = retryAfterSecondsOf(error)
  }

  const token = body?.token
  const rotatedRefreshToken = body?.refreshToken
  if (!refused && token && rotatedRefreshToken) {
    // The server rotated: the refresh token we sent is spent and a NEW live
    // session pair exists. Keep it only if nobody signed out (or in as someone
    // else) in any tab meanwhile; otherwise write nothing and end that session,
    // because the sign-out's own logout carried the pre-rotation token and
    // missed it.
    if (rotateTokens(refreshToken, { token, refreshToken: rotatedRefreshToken })) {
      return { kind: 'rotated', token }
    }
    revokeIssuedSession(token)
    return { kind: 'superseded' }
  }

  // Signed out (or in as someone else) in THIS tab while the call was in
  // flight: clearing after a refusal would wipe the new sign-in. Leave it alone.
  if (getTokenGeneration() !== generation) return { kind: 'superseded' }

  return refused ? { kind: 'refused' } : { kind: 'unavailable', retryAfterSeconds }
}

/**
 * Performs the silent refresh (always called under the refresh lock where the
 * Locks API exists). `sentToken` / `sentMarker` are the access token the 401'd
 * request was SENT with and the session identity marker current at that moment.
 *
 *  0. IDENTITY: if the stored marker is no longer `sentMarker`, another sign-in
 *     (or a sign-out) replaced the session in some tab. This request belongs to
 *     the old one: reject it with its own error. Do not adopt, refresh or clear
 *     anything, because everything stored now belongs to someone else.
 *  1. ADOPT: if the stored access token is no longer `sentToken` (same sign-in),
 *     another tab (or an earlier refresh in this one) already rotated the pair;
 *     hand back the stored token without calling the server.
 *  2. COOL-DOWN: a recent no-answer refresh makes this 401 fail without a call.
 *  3. Otherwise `POST /auth/refresh` with the stored refresh token and store
 *     the rotated pair (see `rotate`).
 *  4. If the server REFUSED it (401/403), re-read the stored refresh token. If
 *     it CHANGED since the attempt began and it is still the same sign-in
 *     (another tab rotated it without our noticing: the no-Locks path), retry
 *     ONCE with the new value instead of clearing.
 *  5. A refusal that stands, and still concerns OUR session (the marker is
 *     unchanged), clears this page's own store and returns `null` (fail-closed),
 *     and so does having no refresh token to present at all (no network call is
 *     made then). Only the ACTIVE store is cleared: a staff tab's refusal never
 *     wipes a participant's `localStorage` pair. Explicit sign-out (`logout()`)
 *     is what clears both. Any OTHER failure (no answer, timeout, 5xx, ...) returns
 *     `null`, starts the cool-down and leaves the stored pair alone: the
 *     caller's original request is rejected with its own error and a later 401
 *     tries again.
 */
async function performSilentRefresh(
  sentToken: string | null,
  sentMarker: string | null,
): Promise<string | null> {
  if (getSessionMarker() !== sentMarker) return null

  const current = getAccessToken()
  if (current !== null && current !== sentToken) {
    return current
  }

  if (isRefreshCoolingDown()) return null

  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearActiveTokens()
    return null
  }

  const first = await rotate(refreshToken)
  if (first.kind === 'rotated') return first.token
  if (first.kind === 'superseded') return null
  if (first.kind === 'unavailable') {
    startRefreshCooldown(first.retryAfterSeconds)
    return null
  }

  const latest = getRefreshToken()
  if (latest !== null && latest !== refreshToken) {
    // Another tab changed the stored refresh token. Retry with it only if that
    // tab merely ROTATED our session; if it signed someone else in, the store
    // is theirs now and is none of this request's business.
    if (getSessionMarker() !== sentMarker) return null
    const second = await rotate(latest)
    if (second.kind === 'rotated') return second.token
    if (second.kind === 'unavailable') startRefreshCooldown(second.retryAfterSeconds)
    if (second.kind !== 'refused') return null
  }

  // The refusal is about OUR session. If another tab replaced it while the call
  // was out (signed in as someone else, even with a pair that has no refresh
  // token), what is stored now is theirs and is none of this refusal's business.
  if (getSessionMarker() !== sentMarker) return null
  clearActiveTokens()
  return null
}

/** Coalesces concurrent 401s of the same sign-in onto a single in-flight refresh call. */
function silentRefresh(
  sentToken: string | null,
  sentMarker: string | null,
): Promise<string | null> {
  if (refreshInFlight) {
    // A request sent under a different sign-in must not borrow this refresh's token.
    return refreshInFlight.marker === sentMarker ? refreshInFlight.promise : Promise.resolve(null)
  }
  const promise = runUnderRefreshLock(() => performSilentRefresh(sentToken, sentMarker))
    .finally(() => {
      refreshInFlight = null
    })
  refreshInFlight = { marker: sentMarker, promise }
  return promise
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

    return silentRefresh(sentBearerToken(config), config._pulseSessionMarker ?? null)
      .then(newToken => {
        if (!newToken) {
          // The original 401 surfaces here for two different reasons, and the token store is
          // what tells them apart: a REFUSED refresh has already cleared this page's store
          // (`performSilentRefresh`), a NO-ANSWER one (offline, timeout, 5xx, 429, or the
          // cool-down) kept the pair on purpose. `core/auth/session.tsx` reads the store: no
          // token -> /login; a pair still stored -> a "Reconnecting..." screen with a Try
          // again, so a dropped request at page load never bounces a signed-in participant
          // to sign in again (easy-login Gate-2 W-5, the former TODO EL-07/M-4).
          return Promise.reject(error)
        }
        config.headers.set('Authorization', `Bearer ${newToken}`)
        return api.request(config)
      })
  },
)

export default api
