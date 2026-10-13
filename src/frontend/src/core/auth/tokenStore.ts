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
 *     storage primitives it needs (`rotateTokens`, `getSessionMarker`,
 *     `getTokenGeneration`).
 *
 * AT MOST ONE STORE HOLDS A SESSION. `setTokens` writes the target store and
 * REMOVES the other store's copy, so a staff sign-in after a participant one
 * (or vice versa) can never leave a stale pair behind. `clearTokens` clears
 * BOTH, so `logout()` / `endSession()` (an EXPLICIT sign-out) leave nothing in
 * either; an AUTOMATIC clear (the refresh path, after the server refused the
 * session) uses `clearActiveTokens` and touches only this page's own store, so a
 * staff tab's refusal can never wipe a participant's `localStorage` pair. A page's
 * session is whichever store holds tokens, `sessionStorage` first; BOTH keys
 * are always read from that ONE store, never one key from each, so a read can
 * never combine one user's access token (say a shared read-only session in
 * this tab) with another user's refresh token (a participant who signed in in
 * another tab and left theirs in `localStorage`).
 *
 * THE PAGE'S STORE IS STICKY (easy-login Gate-2 W-6). A page's session lives in ONE store,
 * and which one is RECORDED: at boot (whichever store held tokens when the page loaded)
 * and at every `setTokens`. After an AUTOMATIC clear of a `sessionStorage` session (the
 * server refused a staff tab's refresh token), `activeArea()` keeps answering `session`
 * (now empty) for that page until a new sign-in, instead of falling through to the
 * `localStorage` store. Without that, the refused staff tab would silently start reading
 * and presenting a PARTICIPANT's pair that another tab left in `localStorage`: a staff
 * page acting with a participant's bearer, and a page that believes it is signed in
 * after it was signed out. An explicit `clearTokens()` (sign-out) forgets the record,
 * so the next boot or sign-in decides afresh.
 *
 * THE RECORD SURVIVES A RELOAD (W2-1). The in-memory record alone is lost when the page
 * reloads, and a reload is exactly what `crossTabSessionSync` does when a participant
 * signs in or out in another tab, and what F5 does. So an automatic clear of a
 * `sessionStorage` session also writes a tiny, NON-secret record into `sessionStorage`
 * itself (`pulse.auth.sticky`): it survives F5, dies with the tab, and is removed by
 * `clearTokens()` and by the next `setTokens()`. At boot a page with no staff tokens but
 * that record is still a staff page, and `isSessionScoped()` says so, so another tab's
 * participant sign-in neither reloads it nor lets it boot as that participant. It is only
 * written at the moment of the clear, so a healthy staff session leaves `sessionStorage`
 * holding exactly the pair and its marker, as before.
 *
 * The access token and refresh token are stored under two SEPARATE keys
 * (`pulse.auth.token`, `pulse.auth.refreshToken`; never serialized together as
 * one JSON blob) so neither can corrupt the other's encoding.
 *
 * SESSION IDENTITY MARKER (`pulse.auth.session`). Beside every pair sits a
 * random, NON-secret id naming the sign-in that produced it. A SIGN-IN
 * (`setTokens`) writes a fresh one; a silent-refresh ROTATION (`rotateTokens`)
 * keeps it. Because `localStorage` is shared, "the marker changed" is exactly
 * "a different sign-in (or a sign-out) happened in some tab": `core/services/
 * api.ts` uses it to refuse to retry one user's request with another user's
 * freshly-stored token, and `core/auth/crossTabSessionSync` reloads the other
 * tabs so their UI matches the store.
 *
 * WRITE ORDER (a sign-in is several synchronous writes, and another tab can read
 * between them): `setTokens` first REMOVES the target store's old marker, then
 * writes the pair, then writes the new marker LAST. So a reader that lands
 * mid-sign-in sees the new pair under NO marker, and a request that was sent
 * under any earlier marker fails the identity check instead of being retried with
 * a half-written, different user's pair; and a tab woken by the new marker's
 * `storage` event finds a complete pair. `clearTokens` removes the pair first and
 * the marker last for the same reason.
 *
 * ONE BROWSER, ONE IDENTITY (S-1). The persisted session is per ORIGIN, not per
 * tab. Signing in as someone else in any tab replaces the pair every tab uses and
 * reloads the others (`core/auth/crossTabSessionSync`). That is the intended
 * behaviour for "two join links opened in one browser", but a second sign-in
 * started while another is still in progress (e.g. two join links tapped one
 * after the other) can interrupt the first when it reloads. Staff sessions
 * (`sessionStorage`) are private to their tab and are not part of this.
 *
 * `rotateTokens(expectedRefreshToken, pair)` is the refresh path's compare-and-
 * swap: it stores the rotated pair in the store that currently holds the
 * session, but ONLY if that store still holds the refresh token the caller
 * presented. If another tab signed out (or in as someone else) meanwhile it
 * writes nothing and says so, so a stale refresh response can never resurrect a
 * signed-out session or overwrite another user's.
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
/**
 * The session identity marker's key. Exported (it is a name, not a secret) so
 * `core/auth/crossTabSessionSync` can recognise the `storage` event for it.
 */
export const SESSION_MARKER_KEY = 'pulse.auth.session'

/**
 * The sticky-page record's key, in `sessionStorage` (see "THE RECORD SURVIVES A RELOAD").
 * Exported (a name, not a secret) so tests and tooling can recognise it.
 */
export const STICKY_SESSION_KEY = 'pulse.auth.sticky'

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

/** The two backing stores. Order matters: `session` first, so it wins. */
type Area = 'session' | 'persistent'
const AREAS: readonly Area[] = ['session', 'persistent']

/**
 * In-memory fallback, per store, used (and preferred over the real store) only
 * after a storage call failed. Empty whenever storage works.
 */
const memory: Record<Area, Map<string, string>> = {
  session: new Map(),
  persistent: new Map(),
}

/**
 * Bumped by every `setTokens` / `rotateTokens` / `clearTokens`. Lets the
 * silent-refresh path detect that THIS tab signed out or in while its refresh
 * call was in flight (and so must not write the rotated pair over what the
 * user did).
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

function holdsTokens(area: Area): boolean {
  return readItem(area, ACCESS_TOKEN_KEY) !== null || readItem(area, REFRESH_TOKEN_KEY) !== null
}

/**
 * The store THIS PAGE's session lives in, as recorded at boot and at every
 * `setTokens` (`null` = it had none and has not signed in). Sticky: see the module
 * header, "THE PAGE'S STORE IS STICKY". Only `session` is acted on, because that
 * is the one that can be emptied under a page while a DIFFERENT identity sits in
 * the other store (a staff tab beside a participant's `localStorage` pair).
 */
let pageArea: Area | null = initialPageArea()

function initialPageArea(): Area | null {
  if (holdsTokens('session')) return 'session'
  // A staff page whose session was refused and cleared, then reloaded (W2-1): still staff.
  if (readItem('session', STICKY_SESSION_KEY) === 'session') return 'session'
  return holdsTokens('persistent') ? 'persistent' : null
}

/**
 * The ONE store this page's session lives in: `sessionStorage` if it holds any
 * token, else `localStorage`, EXCEPT that a page recorded as a `sessionStorage`
 * session stays on it even once it is empty (W-6). Every read goes through this so
 * the access token, the refresh token and the marker always come from the same store.
 */
function activeArea(): Area {
  if (holdsTokens('session')) return 'session'
  return pageArea === 'session' ? 'session' : 'persistent'
}

/**
 * The identity marker THIS PAGE believes it is signed in as: what it booted with,
 * then whatever its own sign-ins and sign-outs made it. Another tab's sign-in or
 * sign-out reloads this page (so this never goes stale), but a bare
 * `localStorage.clear()` elsewhere is announced without saying whose marker it
 * took; this is how `crossTabSessionSync` tells "my marker disappeared" from "a
 * page with no session saw a wipe".
 */
let pageMarker: string | null = initialPageMarker()

function initialPageMarker(): string | null {
  const area = activeArea()
  return holdsTokens(area) ? readItem(area, SESSION_MARKER_KEY) : null
}

/** A fresh, unguessable-enough, NON-secret id for one sign-in. */
function newSessionMarker(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Returns the stored access token, or `null` when none is stored. */
export function getAccessToken(): string | null {
  return readItem(activeArea(), ACCESS_TOKEN_KEY)
}

/** Returns the stored refresh token, or `null` when none is stored. */
export function getRefreshToken(): string | null {
  return readItem(activeArea(), REFRESH_TOKEN_KEY)
}

/**
 * The identity marker of the sign-in the stored pair belongs to, or `null` when
 * no pair is stored (or it predates markers). Unchanged by a refresh rotation,
 * replaced by every sign-in, removed by a sign-out.
 */
export function getSessionMarker(): string | null {
  const area = activeArea()
  return holdsTokens(area) ? readItem(area, SESSION_MARKER_KEY) : null
}

/**
 * The identity marker this PAGE signed in as (see `pageMarker`), or `null` if it
 * has no persisted identity. Unlike `getSessionMarker` this does not look at the
 * store now, so it still names the marker after another tab wiped the store.
 */
export function getPageSessionMarker(): string | null {
  return pageMarker
}

function writePair(area: Area, { token, refreshToken }: TokenPair): void {
  writeItem(area, ACCESS_TOKEN_KEY, token)
  if (refreshToken !== undefined) {
    writeItem(area, REFRESH_TOKEN_KEY, refreshToken)
  } else {
    removeItem(area, REFRESH_TOKEN_KEY)
  }
}

/**
 * Persists a token pair from a SIGN-IN response envelope. `refreshToken`
 * REPLACES any previously stored one when present; when ABSENT, any previously
 * stored refresh token is cleared — every call establishes the CURRENT
 * session's tokens wholesale, so a stale refresh token from a prior session can
 * never linger (mirrors the "never a stale/empty header" contract the axios
 * interceptor relies on). Each call also stamps a NEW session identity marker.
 *
 * `options.persist` picks the store (see the header): `true` writes
 * `localStorage`, anything else writes `sessionStorage`. Either way the OTHER
 * store's copy is removed, so the pair lives in exactly one place. The
 * signature is frozen (easy-login stories 08 and 09 code against it). The
 * silent refresh does NOT use this: it calls `rotateTokens`.
 */
export function setTokens(pair: TokenPair, options?: SetTokensOptions): void {
  const target: Area = options?.persist === true ? 'persistent' : 'session'
  const other: Area = target === 'persistent' ? 'session' : 'persistent'

  generation++
  // This page's session now lives in `target`, whatever it was before (W-6). The sticky
  // record (W2-1) has done its job: the tokens themselves say where the session lives.
  pageArea = target
  removeItem('session', STICKY_SESSION_KEY)
  // Old marker out FIRST: between here and the new marker below, a reader sees
  // the new pair under no marker, so a request sent under the old identity
  // fails its identity check rather than adopting a half-written pair.
  removeItem(target, SESSION_MARKER_KEY)
  writePair(target, pair)
  removeItem(other, ACCESS_TOKEN_KEY)
  removeItem(other, REFRESH_TOKEN_KEY)
  removeItem(other, SESSION_MARKER_KEY)
  // Last, so a tab woken by the marker's `storage` event reads a complete pair.
  pageMarker = newSessionMarker()
  writeItem(target, SESSION_MARKER_KEY, pageMarker)
}

/**
 * Stores the pair a silent refresh just rotated, if and only if the store that
 * holds this page's session STILL holds `expectedRefreshToken` (the one the
 * refresh call presented). Keeps the session's store and identity marker.
 * Returns `false` and writes NOTHING otherwise: the user signed out, or in as
 * someone else, in some tab while the refresh was in flight, and the stale
 * result must not undo it. (This is as close to an atomic compare-and-swap as
 * Web Storage allows: there is no cross-tab atomic operation, so the check and
 * the write are two synchronous steps in this tab, a window of microseconds.)
 */
export function rotateTokens(expectedRefreshToken: string, pair: TokenPair): boolean {
  const area = activeArea()
  if (readItem(area, REFRESH_TOKEN_KEY) !== expectedRefreshToken) return false

  generation++
  writePair(area, pair)
  return true
}

function clearArea(area: Area): void {
  removeItem(area, ACCESS_TOKEN_KEY)
  removeItem(area, REFRESH_TOKEN_KEY)
  // Last, so a tab woken by the marker's `storage` event finds the pair gone.
  removeItem(area, SESSION_MARKER_KEY)
}

/**
 * EXPLICIT sign-out (`logout()`, `endSession()`): clears the tokens and the
 * identity marker from BOTH stores. Safe when nothing is stored.
 */
export function clearTokens(): void {
  generation++
  pageMarker = null
  // A sign-out leaves this page with no session, so nothing is sticky any more (W-6), in
  // memory or in this tab's sessionStorage (W2-1).
  pageArea = null
  removeItem('session', STICKY_SESSION_KEY)
  for (const area of AREAS) clearArea(area)
}

/**
 * AUTOMATIC clear (the silent refresh, after the server refused this page's
 * session): clears only the store that holds THIS page's session. A staff tab
 * (`sessionStorage`) whose refresh token is refused must never wipe the pair a
 * participant signed in with in another tab (`localStorage`), and (W-6) afterwards
 * must not READ it either: the page's store stays `sessionStorage`, now empty, until
 * a new sign-in. Safe when nothing is stored.
 */
export function clearActiveTokens(): void {
  generation++
  pageMarker = null
  const area = activeArea()
  if (area === 'session') {
    // This page's session lived in sessionStorage and was just refused. It stays a
    // sessionStorage page (W-6), and the record outlives a reload (W2-1), so neither a
    // cross-tab reload nor F5 can turn it into the participant whose pair sits next door.
    pageArea = 'session'
    writeItem('session', STICKY_SESSION_KEY, 'session')
  }
  // `pageArea` is otherwise KEPT: a participant page stays on its own store.
  clearArea(area)
}

/**
 * `true` when this page's session lives in the persistent (`localStorage`)
 * store, `false` when it lives in `sessionStorage` or nothing is stored.
 */
export function isPersistentSession(): boolean {
  return !holdsTokens('session') && holdsTokens('persistent')
}

/**
 * `true` when this page's session lives in `sessionStorage` (every staff
 * session), including one that was refused and cleared and is still sticky to that
 * store (W-6, W2-1). Such a page is private to its tab: another tab's sign-in or
 * sign-out in the shared `localStorage` says nothing about it, and
 * `crossTabSessionSync` must not reload it into that identity.
 */
export function isSessionScoped(): boolean {
  return holdsTokens('session') || pageArea === 'session'
}

/**
 * A counter that changes whenever THIS page calls `setTokens`, `rotateTokens` or
 * `clearTokens`. Opaque: compare for equality only. It does not (and cannot)
 * see another tab's writes; the cross-tab races are handled by `rotateTokens`'
 * compare-and-swap and the identity marker.
 */
export function getTokenGeneration(): number {
  return generation
}
