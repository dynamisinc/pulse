/**
 * core/auth/tokenStore.ts
 * ---------------------------------------------------------------------------
 * The token store the shared axios client (`core/services/api.ts`) reads to
 * attach `Authorization: Bearer <token>` and writes to after a successful
 * login/silent-refresh (COR-012; feature: login, story 01 — "Frontend session
 * & token wiring", split from `identity-auth-roles/03`'s deferred "frozen-seam
 * flip" AC — see docs/features/login/01-frontend-session-token-wiring.md).
 * Story easy-login/07 (EL-10) made the backing store a per-call choice.
 *
 * TWO BACKING STORES, CHOSEN BY THE CALLER AT SIGN-IN (`setTokens(pair, options)`):
 *   - `sessionStorage` (the DEFAULT, and what every staff sign-in uses):
 *     cleared when the tab closes and never shared cross-tab, so a
 *     persistent-XSS blast radius is as small as it can be (NFR-004). It still
 *     SURVIVES an in-exercise page reload, which a pure in-memory store would
 *     not. Staff tokens are the higher-privilege ones, so staff NEVER opt in
 *     to the other store (a call-site test on `StaffSignInPage` pins that).
 *   - `localStorage` (`{ persist: true }` — PARTICIPANT sign-in only): a
 *     participant on a phone must stay signed in for the whole exercise day,
 *     through a closed tab, a discarded iOS tab and a locked screen. The cost
 *     is a wider XSS blast radius for those (lower-privilege, exercise-scoped,
 *     day-limited) tokens, accepted in EL-10 and covered by the existing
 *     sanitizer/CSP posture. A shared store also means several tabs can wake
 *     on the same stale access token together — `core/services/api.ts` closes
 *     that refresh race (Web Lock + re-read), this module only supplies the
 *     storage primitives it needs (`isPersistentSession`, `getTokenGeneration`).
 *
 * AT MOST ONE STORE HOLDS A SESSION. `setTokens` writes the target store and
 * REMOVES the other store's copy, so a staff sign-in after a participant one
 * (or vice versa) can never leave a stale pair behind. `clearTokens` clears
 * BOTH, so `logout()` / `endSession()` leave nothing in either. Reads check
 * `sessionStorage` first (it wins if both somehow hold a value), then
 * `localStorage`.
 *
 * The access token and refresh token are stored under two SEPARATE keys
 * (`pulse.auth.token`, `pulse.auth.refreshToken`; never serialized together as
 * one JSON blob), so a partial read can never hand back a half-written pair.
 *
 * STORAGE THAT THROWS (Safari private mode, quota, blocked by policy — even
 * touching `window.localStorage` can throw): no function here ever throws.
 * Each store has an in-memory copy used instead, for the page's life, so the
 * app keeps working until a reload (the session simply does not survive it).
 * The memory copy is keyed by store, so "which store does this session live
 * in" stays answerable. It is always empty while storage works.
 *
 * `getAccessToken()` / `getRefreshToken()` return `null` (never throw) when
 * absent — this module has no opinion on whether a caller SHOULD have a
 * token; that is the shared axios client's / `sessionResolver`'s concern.
 *
 * NEVER log a raw token value from this module or any caller, and never put one
 * in an error message or a URL (mirrors the `[session]` / `[exerciseContext]`
 * console-signal precedent, which never includes secret material either).
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

/** Where `setTokens` keeps the pair. */
export interface SetTokensOptions {
  /**
   * `true` -> `localStorage` (survives a closed tab; PARTICIPANT sign-in only).
   * `false` / omitted -> `sessionStorage` (dies with the tab; every staff
   * sign-in, and every caller that predates this option).
   */
  readonly persist?: boolean
}

/** The two backing stores. Order matters for reads: `session` first, so it wins. */
type Area = 'session' | 'persistent'
const READ_ORDER: readonly Area[] = ['session', 'persistent']

/**
 * In-memory fallback, per store, used (and preferred over the real store) only
 * after a storage call failed. Empty whenever storage works.
 */
const memory: Record<Area, Map<string, string>> = {
  session: new Map(),
  persistent: new Map(),
}

/**
 * Bumped by every `setTokens` / `clearTokens`. Lets the silent-refresh path
 * detect that THIS tab signed out or in while its refresh call was in flight
 * (and so must not write the rotated pair over what the user did).
 */
let generation = 0

/** The real Web Storage object for a store, or `null` when even touching it throws. */
function storageFor(area: Area): Storage | null {
  try {
    return area === 'persistent' ? globalThis.localStorage : globalThis.sessionStorage
  } catch {
    return null
  }
}

function readItem(area: Area, key: string): string | null {
  const remembered = memory[area].get(key)
  if (remembered !== undefined) return remembered
  try {
    return storageFor(area)?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeItem(area: Area, key: string, value: string): void {
  try {
    const storage = storageFor(area)
    if (storage) {
      storage.setItem(key, value)
      memory[area].delete(key)
      return
    }
  } catch {
    // Quota exceeded / blocked: fall through to the in-memory copy.
  }
  memory[area].set(key, value)
  // The real store may still hold an OLDER value for this key, which must not
  // be readable once we are holding a newer one in memory (best effort).
  removeFromStorage(area, key)
}

function removeFromStorage(area: Area, key: string): void {
  try {
    storageFor(area)?.removeItem(key)
  } catch {
    // Nothing more to do: the memory copy (cleared by the caller) is what counts.
  }
}

function removeItem(area: Area, key: string): void {
  memory[area].delete(key)
  removeFromStorage(area, key)
}

function readFirst(key: string): string | null {
  for (const area of READ_ORDER) {
    const value = readItem(area, key)
    if (value !== null) return value
  }
  return null
}

function holdsTokens(area: Area): boolean {
  return readItem(area, ACCESS_TOKEN_KEY) !== null || readItem(area, REFRESH_TOKEN_KEY) !== null
}

/** Returns the stored access token, or `null` when none is stored. */
export function getAccessToken(): string | null {
  return readFirst(ACCESS_TOKEN_KEY)
}

/** Returns the stored refresh token, or `null` when none is stored. */
export function getRefreshToken(): string | null {
  return readFirst(REFRESH_TOKEN_KEY)
}

/**
 * Persists a token pair from a login/silent-refresh response envelope.
 * `refreshToken` REPLACES any previously stored one when present (token
 * rotation); when ABSENT, any previously stored refresh token is cleared —
 * every call establishes the CURRENT session's tokens wholesale, so a stale
 * refresh token from a prior session can never linger (mirrors the "never a
 * stale/empty header" contract the axios interceptor relies on).
 *
 * `options.persist` picks the store (see the header): `true` writes
 * `localStorage`, anything else writes `sessionStorage`. Either way the OTHER
 * store's copy is removed, so the pair lives in exactly one place. The
 * signature is frozen (easy-login stories 08 and 09 code against it).
 */
export function setTokens({ token, refreshToken }: TokenPair, options?: SetTokensOptions): void {
  const target: Area = options?.persist === true ? 'persistent' : 'session'
  const other: Area = target === 'persistent' ? 'session' : 'persistent'

  generation++
  writeItem(target, ACCESS_TOKEN_KEY, token)
  if (refreshToken !== undefined) {
    writeItem(target, REFRESH_TOKEN_KEY, refreshToken)
  } else {
    removeItem(target, REFRESH_TOKEN_KEY)
  }
  removeItem(other, ACCESS_TOKEN_KEY)
  removeItem(other, REFRESH_TOKEN_KEY)
}

/** Clears the stored tokens from BOTH stores. Safe to call when nothing is stored. */
export function clearTokens(): void {
  generation++
  for (const area of READ_ORDER) {
    removeItem(area, ACCESS_TOKEN_KEY)
    removeItem(area, REFRESH_TOKEN_KEY)
  }
}

/**
 * `true` when the current pair lives in the persistent (`localStorage`) store,
 * `false` when it lives in `sessionStorage` or nothing is stored. The silent
 * refresh uses this to put the rotated pair back in the SAME store, so a
 * participant stays persistent and a staff user stays session-only without the
 * refresh path ever being told which one it is.
 */
export function isPersistentSession(): boolean {
  return !holdsTokens('session') && holdsTokens('persistent')
}

/**
 * A counter that changes whenever THIS page calls `setTokens` or `clearTokens`.
 * Opaque: compare for equality only. It does not (and cannot) see another
 * tab's writes; the cross-tab refresh race is handled in `core/services/api.ts`.
 */
export function getTokenGeneration(): number {
  return generation
}
