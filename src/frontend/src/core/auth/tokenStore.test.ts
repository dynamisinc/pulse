/**
 * core/auth/tokenStore.test.ts
 * ---------------------------------------------------------------------------
 * Coverage for the two-store token store (COR-012; feature: login, story 01,
 * extended by easy-login story 07 / EL-10):
 *   - set/get/clear round-trips (the original sessionStorage contract, which
 *     every existing caller still gets by passing no options);
 *   - `{ persist: true }` -> `localStorage`, otherwise `sessionStorage`, with
 *     the OTHER store's copy removed in both directions, the two-key layout
 *     kept, and a pair with no refresh token clearing a stale one;
 *   - reads from either store (sessionStorage wins), `null` and never a throw
 *     when neither has one; `clearTokens()` clears BOTH;
 *   - storage that throws (Safari private mode, quota, blocked by policy):
 *     none of the functions throw and the app works from an in-memory copy;
 *   - M-3: both keys are read from ONE store, never one key from each;
 *   - N-2: a sign-in removes the old marker BEFORE writing the new pair, so a
 *     reader landing mid-sign-in sees the new pair under no marker;
 *   - S-3: `clearActiveTokens` (the automatic clear) touches only the store the
 *     session lives in, `clearTokens` (explicit sign-out) clears both;
 *   - M-2: a sign-in stamps a fresh session identity marker, a refresh rotation
 *     keeps it, a sign-out removes it; `rotateTokens` is a compare-and-swap on
 *     the refresh token (CR-001).
 *
 * `sessionStorage` / `localStorage` are real (jsdom provides them). The
 * throwing-storage cases stub `Storage.prototype` (scoped per test, restored
 * by `vi.restoreAllMocks()`); `clearTokens()` in `afterEach` also empties the
 * module's in-memory fallback so no case leaks into the next.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  isPersistentSession,
  isSessionScoped,
  clearActiveTokens,
  getPageSessionMarker,
  getTokenGeneration,
  getSessionMarker,
  rotateTokens,
  SESSION_MARKER_KEY,
  STICKY_SESSION_KEY,
} from './tokenStore'

const ACCESS_KEY = 'pulse.auth.token'
const REFRESH_KEY = 'pulse.auth.refreshToken'

/**
 * After an AUTOMATIC clear of a staff (sessionStorage) session, no token, refresh token or
 * identity marker is left there. The sticky-page record (W2-1) may remain, on purpose: it is
 * what keeps the refused tab a staff tab across a reload. (An explicit sign-out leaves
 * sessionStorage completely empty, and those cases still assert `.length` is 0.)
 */
function expectNoSessionTokens(): void {
  expect(Object.keys(sessionStorage).filter(key => key !== 'pulse.auth.sticky')).toEqual([])
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Also empties the module's in-memory fallback (a no-op while storage works).
  clearTokens()
  sessionStorage.clear()
  localStorage.clear()
})

describe('tokenStore', () => {
  it('returns null for both tokens when nothing is stored', () => {
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('round-trips a token pair', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })

    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
  })

  it('stores an access token with no refresh token, and clears any previously stored one', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    setTokens({ token: 'access-2' })

    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBeNull()
  })

  it('rotation: a later setTokens call replaces both prior values', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    setTokens({ token: 'access-2', refreshToken: 'refresh-2' })

    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBe('refresh-2')
  })

  it('clearTokens removes both, and a cleared store returns no token', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })

    clearTokens()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('clearTokens is safe to call when nothing is stored', () => {
    expect(() => clearTokens()).not.toThrow()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})

describe('tokenStore — which store the pair is written to', () => {
  it('persist: true writes localStorage under the two namespaced keys and leaves sessionStorage empty', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

    expect(localStorage.getItem(ACCESS_KEY)).toBe('access-1')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-1')
    expect(sessionStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
  })

  it.each([
    ['no options', undefined],
    ['an empty options object', {}],
    ['persist: false', { persist: false }],
  ])('%s writes sessionStorage only (today\'s behaviour)', (_label, options) => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, options)

    expect(sessionStorage.getItem(ACCESS_KEY)).toBe('access-1')
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-1')
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it('switching to persist: true removes the copy in sessionStorage', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })

    setTokens({ token: 'part-access', refreshToken: 'part-refresh' }, { persist: true })

    expect(sessionStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(localStorage.getItem(ACCESS_KEY)).toBe('part-access')
    expect(getAccessToken()).toBe('part-access')
    expect(getRefreshToken()).toBe('part-refresh')
  })

  it('switching to persist: false (or no options) removes the copy in localStorage', () => {
    setTokens({ token: 'part-access', refreshToken: 'part-refresh' }, { persist: true })

    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' }, { persist: false })

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(sessionStorage.getItem(ACCESS_KEY)).toBe('staff-access')
    expect(getAccessToken()).toBe('staff-access')
    expect(getRefreshToken()).toBe('staff-refresh')
  })

  it('a persisted pair with no refresh token clears a stale refresh token in localStorage', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

    setTokens({ token: 'access-2' }, { persist: true })

    expect(localStorage.getItem(ACCESS_KEY)).toBe('access-2')
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('rotating a persisted pair replaces both values in localStorage', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    setTokens({ token: 'access-2', refreshToken: 'refresh-2' }, { persist: true })

    expect(localStorage.getItem(ACCESS_KEY)).toBe('access-2')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-2')
  })
})

describe('tokenStore — reading and clearing across both stores', () => {
  it('reads a pair that sits only in localStorage', () => {
    localStorage.setItem(ACCESS_KEY, 'local-access')
    localStorage.setItem(REFRESH_KEY, 'local-refresh')

    expect(getAccessToken()).toBe('local-access')
    expect(getRefreshToken()).toBe('local-refresh')
  })

  it('reads a pair that sits only in sessionStorage', () => {
    sessionStorage.setItem(ACCESS_KEY, 'session-access')
    sessionStorage.setItem(REFRESH_KEY, 'session-refresh')

    expect(getAccessToken()).toBe('session-access')
    expect(getRefreshToken()).toBe('session-refresh')
  })

  it('a sessionStorage value wins if both stores somehow hold one', () => {
    sessionStorage.setItem(ACCESS_KEY, 'session-access')
    sessionStorage.setItem(REFRESH_KEY, 'session-refresh')
    localStorage.setItem(ACCESS_KEY, 'local-access')
    localStorage.setItem(REFRESH_KEY, 'local-refresh')

    expect(getAccessToken()).toBe('session-access')
    expect(getRefreshToken()).toBe('session-refresh')
  })

  it('reads BOTH keys from the one store that holds the session (never a key from each)', () => {
    sessionStorage.setItem(ACCESS_KEY, 'session-access')
    localStorage.setItem(REFRESH_KEY, 'local-refresh')

    expect(getAccessToken()).toBe('session-access')
    // sessionStorage holds this page's session, so the refresh token is ITS refresh
    // token (none), not the one a different user left in localStorage.
    expect(getRefreshToken()).toBeNull()
  })

  it('a shared read-only tab plus a persisted participant in another tab never mix', () => {
    // The shared-code (read-only) session: an access token, no refresh token, in
    // THIS tab's sessionStorage. A participant signs in in another tab: pair + marker
    // in the shared localStorage.
    setTokens({ token: 'shared-readonly-access' })
    localStorage.setItem(ACCESS_KEY, 'participant-access')
    localStorage.setItem(REFRESH_KEY, 'participant-refresh')
    localStorage.setItem(SESSION_MARKER_KEY, 'participant-marker')

    expect(getAccessToken()).toBe('shared-readonly-access')
    expect(getRefreshToken()).toBeNull()
    expect(isPersistentSession()).toBe(false)
    expect(isSessionScoped()).toBe(true)
  })

  it('a tab with no session of its own follows localStorage as a whole', () => {
    localStorage.setItem(ACCESS_KEY, 'participant-access')
    localStorage.setItem(REFRESH_KEY, 'participant-refresh')

    expect(getAccessToken()).toBe('participant-access')
    expect(getRefreshToken()).toBe('participant-refresh')
  })

  it('returns null (never throws) when neither store holds a token', () => {
    expect(() => getAccessToken()).not.toThrow()
    expect(() => getRefreshToken()).not.toThrow()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('clearTokens clears BOTH stores, whichever (or both) held the pair', () => {
    sessionStorage.setItem(ACCESS_KEY, 'session-access')
    sessionStorage.setItem(REFRESH_KEY, 'session-refresh')
    localStorage.setItem(ACCESS_KEY, 'local-access')
    localStorage.setItem(REFRESH_KEY, 'local-refresh')

    clearTokens()

    expect(sessionStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('clearTokens after a persisted sign-in leaves nothing in localStorage', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

    clearTokens()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('never touches keys outside pulse.auth.* in either store', () => {
    localStorage.setItem('pulse.something.else', 'keep')
    sessionStorage.setItem('unrelated', 'keep')
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })

    clearTokens()

    expect(localStorage.getItem('pulse.something.else')).toBe('keep')
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
  })
})

describe('tokenStore — isPersistentSession / getTokenGeneration', () => {
  it('isPersistentSession is true only while the pair lives in localStorage', () => {
    expect(isPersistentSession()).toBe(false)

    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    expect(isPersistentSession()).toBe(true)

    setTokens({ token: 'a', refreshToken: 'r' })
    expect(isPersistentSession()).toBe(false)

    setTokens({ token: 'a' }, { persist: true })
    expect(isPersistentSession()).toBe(true)

    clearTokens()
    expect(isPersistentSession()).toBe(false)
  })

  it('getTokenGeneration changes on every setTokens and clearTokens, and only then', () => {
    const start = getTokenGeneration()

    expect(getAccessToken()).toBeNull()
    expect(getTokenGeneration()).toBe(start)

    setTokens({ token: 'a' })
    const afterSet = getTokenGeneration()
    expect(afterSet).not.toBe(start)

    clearTokens()
    expect(getTokenGeneration()).not.toBe(afterSet)
  })
})

describe('tokenStore — session identity marker (M-2)', () => {
  it('a sign-in writes a marker beside the pair, in the same store', () => {
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBeTruthy()
    expect(sessionStorage.getItem(SESSION_MARKER_KEY)).toBeNull()

    setTokens({ token: 'a', refreshToken: 'r' })
    expect(sessionStorage.getItem(SESSION_MARKER_KEY)).toBeTruthy()
    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBeNull()
  })

  it('every sign-in gets a NEW marker, even for an identical pair', () => {
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    const first = getSessionMarker()
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    const second = getSessionMarker()

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('the marker is not a token: it is never equal to one and is read through getSessionMarker', () => {
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })

    expect(getSessionMarker()).toBe(localStorage.getItem(SESSION_MARKER_KEY))
    expect(getSessionMarker()).not.toBe('a')
    expect(getSessionMarker()).not.toBe('r')
  })

  it('clearTokens removes the marker from both stores, and no pair means no marker', () => {
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    sessionStorage.setItem(SESSION_MARKER_KEY, 'stray')

    clearTokens()

    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBeNull()
    expect(sessionStorage.getItem(SESSION_MARKER_KEY)).toBeNull()
    expect(getSessionMarker()).toBeNull()
    // A dangling marker with no pair is not an identity.
    localStorage.setItem(SESSION_MARKER_KEY, 'dangling')
    expect(getSessionMarker()).toBeNull()
  })

  it('a pair that predates markers has none (null), and still works', () => {
    localStorage.setItem(ACCESS_KEY, 'legacy-access')
    localStorage.setItem(REFRESH_KEY, 'legacy-refresh')

    expect(getSessionMarker()).toBeNull()
    expect(getAccessToken()).toBe('legacy-access')
  })

  it('the marker is written LAST on sign-in and removed LAST on sign-out', () => {
    // Another tab woken by the marker's storage event must find a complete pair
    // (sign-in) or no pair at all (sign-out).
    const order: string[] = []
    const realSet = Storage.prototype.setItem
    const realRemove = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (this === window.localStorage) order.push(`set ${k}`)
      return realSet.call(this, k, v)
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, k: string) {
      if (this === window.localStorage) order.push(`remove ${k}`)
      return realRemove.call(this, k)
    })

    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    expect(order.at(-1)).toBe(`set ${SESSION_MARKER_KEY}`)

    order.length = 0
    clearTokens()
    const localRemovals = order.filter(entry => entry.startsWith('remove'))
    expect(localRemovals.at(-1)).toBe(`remove ${SESSION_MARKER_KEY}`)
  })
})

describe('tokenStore — a sign-in is not half-visible to other tabs (N-2)', () => {
  it('between the writes a reader sees the new pair under NO marker, never under the old one', () => {
    setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })
    const oldMarker = getSessionMarker()
    expect(oldMarker).toBeTruthy()

    // Another tab reads the store at the moment each token is written.
    const readSeenMidWrite: Array<{ key: string; marker: string | null }> = []
    const realSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      realSet.call(this, key, value)
      if (this === window.localStorage && key !== SESSION_MARKER_KEY) {
        readSeenMidWrite.push({ key, marker: getSessionMarker() })
      }
    })

    setTokens({ token: 'y-access', refreshToken: 'y-refresh' }, { persist: true })

    // After each pair write the marker was already gone: Y's tokens never sit under X's marker.
    expect(readSeenMidWrite.map(entry => entry.key)).toEqual([ACCESS_KEY, REFRESH_KEY])
    expect(readSeenMidWrite.map(entry => entry.marker)).toEqual([null, null])
    // And once complete there is a NEW marker.
    expect(getSessionMarker()).toBeTruthy()
    expect(getSessionMarker()).not.toBe(oldMarker)
  })

  it('the same holds when the sign-in targets sessionStorage', () => {
    setTokens({ token: 'x-access', refreshToken: 'x-refresh' })
    const seen: Array<string | null> = []
    const realSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      realSet.call(this, key, value)
      if (this === window.sessionStorage && key === ACCESS_KEY) seen.push(getSessionMarker())
    })

    setTokens({ token: 'y-access', refreshToken: 'y-refresh' })

    expect(seen).toEqual([null])
  })
})

describe('tokenStore — automatic vs explicit clears (S-3)', () => {
  it('clearActiveTokens clears only the store holding this page\'s session (sessionStorage)', () => {
    setTokens({ token: 'staff', refreshToken: 'staff-refresh' })
    localStorage.setItem(ACCESS_KEY, 'p-access')
    localStorage.setItem(REFRESH_KEY, 'p-refresh')
    localStorage.setItem(SESSION_MARKER_KEY, 'p-marker')

    clearActiveTokens()

    expectNoSessionTokens()
    expect(localStorage.getItem(ACCESS_KEY)).toBe('p-access')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('p-refresh')
    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBe('p-marker')
  })

  it('clearActiveTokens on a participant page clears the localStorage pair and its marker', () => {
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })

    clearActiveTokens()

    expect(localStorage.length).toBe(0)
    expect(getAccessToken()).toBeNull()
    expect(getSessionMarker()).toBeNull()
  })

  it('clearTokens (explicit sign-out) still clears BOTH stores', () => {
    setTokens({ token: 'staff', refreshToken: 'staff-refresh' })
    localStorage.setItem(ACCESS_KEY, 'p-access')
    localStorage.setItem(SESSION_MARKER_KEY, 'p-marker')

    clearTokens()

    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('clearActiveTokens is safe when nothing is stored', () => {
    expect(() => clearActiveTokens()).not.toThrow()
  })
})

describe('tokenStore — the marker this PAGE signed in as (S-2)', () => {
  it('follows the page\'s own sign-ins and sign-outs, not the store', () => {
    clearTokens()
    expect(getPageSessionMarker()).toBeNull()

    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    const mine = getPageSessionMarker()
    expect(mine).toBeTruthy()
    expect(mine).toBe(getSessionMarker())

    // Another tab wipes the store: the store has no marker, the page still remembers its own.
    localStorage.clear()
    expect(getSessionMarker()).toBeNull()
    expect(getPageSessionMarker()).toBe(mine)

    clearTokens()
    expect(getPageSessionMarker()).toBeNull()
  })

  it('a refresh rotation keeps it', () => {
    setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })
    const mine = getPageSessionMarker()

    rotateTokens('r', { token: 'a2', refreshToken: 'r2' })

    expect(getPageSessionMarker()).toBe(mine)
  })
})

describe('tokenStore — rotateTokens (refresh rotation, a compare-and-swap)', () => {
  it('stores the rotated pair in the SAME store, keeping the identity marker', () => {
    setTokens({ token: 'a1', refreshToken: 'r1' }, { persist: true })
    const marker = getSessionMarker()

    expect(rotateTokens('r1', { token: 'a2', refreshToken: 'r2' })).toBe(true)

    expect(localStorage.getItem(ACCESS_KEY)).toBe('a2')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('r2')
    expect(getSessionMarker()).toBe(marker)
    expect(sessionStorage.length).toBe(0)
  })

  it('a session-only (staff) pair rotates inside sessionStorage and never touches localStorage', () => {
    setTokens({ token: 'a1', refreshToken: 'r1' })
    const marker = getSessionMarker()

    expect(rotateTokens('r1', { token: 'a2', refreshToken: 'r2' })).toBe(true)

    expect(sessionStorage.getItem(ACCESS_KEY)).toBe('a2')
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('r2')
    expect(getSessionMarker()).toBe(marker)
    expect(localStorage.length).toBe(0)
  })

  it('writes NOTHING and returns false when the store no longer holds the refresh token sent', () => {
    setTokens({ token: 'a1', refreshToken: 'r1' }, { persist: true })
    // Another tab signed in as someone else.
    localStorage.setItem(ACCESS_KEY, 'other-access')
    localStorage.setItem(REFRESH_KEY, 'other-refresh')

    expect(rotateTokens('r1', { token: 'a2', refreshToken: 'r2' })).toBe(false)

    expect(localStorage.getItem(ACCESS_KEY)).toBe('other-access')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('other-refresh')
  })

  it('writes NOTHING after a sign-out (the store is empty): a stale refresh cannot resurrect it', () => {
    setTokens({ token: 'a1', refreshToken: 'r1' }, { persist: true })
    clearTokens()

    expect(rotateTokens('r1', { token: 'a2', refreshToken: 'r2' })).toBe(false)

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('a rotated pair with no refresh token drops the old one', () => {
    setTokens({ token: 'a1', refreshToken: 'r1' }, { persist: true })

    expect(rotateTokens('r1', { token: 'a2' })).toBe(true)

    expect(localStorage.getItem(ACCESS_KEY)).toBe('a2')
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it('bumps the generation only when it wrote', () => {
    setTokens({ token: 'a1', refreshToken: 'r1' }, { persist: true })
    const before = getTokenGeneration()

    rotateTokens('wrong', { token: 'a2', refreshToken: 'r2' })
    expect(getTokenGeneration()).toBe(before)

    rotateTokens('r1', { token: 'a2', refreshToken: 'r2' })
    expect(getTokenGeneration()).not.toBe(before)
  })
})

/** Makes the named Storage method throw for the named store(s) (default: both). */
function breakStorage(
  method: 'setItem' | 'getItem' | 'removeItem',
  only?: 'local' | 'session',
): void {
  const original = Storage.prototype[method] as (this: Storage, ...args: string[]) => unknown
  const guarded = function (this: Storage, ...args: string[]) {
    const isLocal = this === window.localStorage
    if (only === undefined || (only === 'local') === isLocal) {
      throw new DOMException('storage unavailable', 'QuotaExceededError')
    }
    return original.apply(this, args)
  }
  vi.spyOn(Storage.prototype, method).mockImplementation(guarded as never)
}

describe('tokenStore — storage that throws (memory fallback)', () => {
  it('setItem throwing (quota / private mode): nothing throws and the pair is held in memory', () => {
    breakStorage('setItem')

    expect(() => setTokens({ token: 'access-1', refreshToken: 'refresh-1' })).not.toThrow()

    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
  })

  it('persisted sign-in with localStorage refusing writes still works, and stays "persistent"', () => {
    breakStorage('setItem', 'local')

    expect(() =>
      setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true }),
    ).not.toThrow()

    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
    expect(isPersistentSession()).toBe(true)
    // The fallback is memory, not a silent downgrade into sessionStorage.
    expect(sessionStorage.getItem(ACCESS_KEY)).toBeNull()
  })

  it('a newer in-memory value is not shadowed by an older value the store still holds', () => {
    setTokens({ token: 'old-access', refreshToken: 'old-refresh' }, { persist: true })
    breakStorage('setItem', 'local')

    setTokens({ token: 'new-access', refreshToken: 'new-refresh' }, { persist: true })

    expect(getAccessToken()).toBe('new-access')
    expect(getRefreshToken()).toBe('new-refresh')
  })

  it('getItem throwing: reads return null and never throw', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    breakStorage('getItem')

    expect(() => getAccessToken()).not.toThrow()
    expect(() => getRefreshToken()).not.toThrow()
    expect(() => isPersistentSession()).not.toThrow()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('removeItem throwing: setTokens and clearTokens do not throw, and clear still forgets memory', () => {
    breakStorage('setItem')
    breakStorage('removeItem')

    expect(() => setTokens({ token: 'access-1', refreshToken: 'refresh-1' })).not.toThrow()
    expect(() => setTokens({ token: 'access-2' }, { persist: true })).not.toThrow()
    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBeNull()

    expect(() => clearTokens()).not.toThrow()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('the Storage objects themselves being inaccessible (blocked by policy) is survivable', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(getAccessToken()).toBeNull()
    expect(() => setTokens({ token: 'a', refreshToken: 'r' }, { persist: true })).not.toThrow()
    expect(getAccessToken()).toBe('a')
    expect(getRefreshToken()).toBe('r')
    expect(() => clearTokens()).not.toThrow()
    expect(getAccessToken()).toBeNull()
  })

  it('once storage works again, a normal write supersedes the in-memory copy', () => {
    breakStorage('setItem')
    setTokens({ token: 'in-memory', refreshToken: 'in-memory-refresh' })
    vi.restoreAllMocks()

    setTokens({ token: 'stored', refreshToken: 'stored-refresh' })

    expect(getAccessToken()).toBe('stored')
    expect(sessionStorage.getItem(ACCESS_KEY)).toBe('stored')
    clearTokens()
    expect(getAccessToken()).toBeNull()
  })
})

describe('W-6: the page\'s store is sticky (a refused staff tab never reads a participant pair)', () => {
  /** What a participant's sign-in in another tab leaves in the shared localStorage. */
  function participantPairInOtherTab(): void {
    localStorage.setItem(ACCESS_KEY, 'p-access')
    localStorage.setItem(REFRESH_KEY, 'p-refresh')
    localStorage.setItem(SESSION_MARKER_KEY, 'participant-marker')
  }

  it('after an automatic clear of a staff session, reads answer null, not the participant pair', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' }) // sessionStorage
    participantPairInOtherTab()
    expect(getAccessToken()).toBe('staff-access') // sanity: the staff pair wins while it exists

    clearActiveTokens()

    expectNoSessionTokens()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(getSessionMarker()).toBeNull()
    // The participant's pair is NOT touched: it is theirs, in another tab.
    expect(localStorage.getItem(ACCESS_KEY)).toBe('p-access')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('p-refresh')
  })

  it('stays null however many times it is read, and rotateTokens cannot adopt the other pair', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    clearActiveTokens()

    expect(getAccessToken()).toBeNull()
    expect(getAccessToken()).toBeNull()
    // A rotation presenting the participant's refresh token must not find it "stored".
    expect(rotateTokens('p-refresh', { token: 'x', refreshToken: 'y' })).toBe(false)
    expect(localStorage.getItem(ACCESS_KEY)).toBe('p-access')
  })

  it('also holds when the staff pair had no refresh token', () => {
    setTokens({ token: 'shared-readonly-access' })
    participantPairInOtherTab()

    clearActiveTokens()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('a new sign-in ends it: a staff sign-in reads its own pair, a participant one the other store', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    clearActiveTokens()

    setTokens({ token: 'staff-access-2', refreshToken: 'staff-refresh-2' })
    expect(getAccessToken()).toBe('staff-access-2')

    clearActiveTokens()
    expect(getAccessToken()).toBeNull()

    setTokens({ token: 'p-access-2', refreshToken: 'p-refresh-2' }, { persist: true })
    expect(getAccessToken()).toBe('p-access-2')
    expect(getRefreshToken()).toBe('p-refresh-2')
    expect(sessionStorage.length).toBe(0)
  })

  it('an explicit sign-out forgets it: the page then reads whatever the store holds', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    clearActiveTokens()
    clearTokens() // the page has no session now

    participantPairInOtherTab()

    expect(getAccessToken()).toBe('p-access')
  })

  it('a participant (localStorage) page whose session is cleared stays on its own store', () => {
    setTokens({ token: 'p-access', refreshToken: 'p-refresh' }, { persist: true })

    clearActiveTokens()

    expect(getAccessToken()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('records the store at BOOT: a page that loaded with a staff pair stays on sessionStorage', async () => {
    vi.resetModules()
    sessionStorage.setItem(ACCESS_KEY, 'staff-access')
    sessionStorage.setItem(REFRESH_KEY, 'staff-refresh')
    participantPairInOtherTab()
    const fresh = await import('./tokenStore')
    expect(fresh.getAccessToken()).toBe('staff-access')

    fresh.clearActiveTokens()

    expect(fresh.getAccessToken()).toBeNull()
    expect(localStorage.getItem(ACCESS_KEY)).toBe('p-access')
  })

  it('a page that booted with only a participant pair is a participant page', async () => {
    vi.resetModules()
    participantPairInOtherTab()
    const fresh = await import('./tokenStore')

    expect(fresh.getAccessToken()).toBe('p-access')
    fresh.clearActiveTokens()
    expect(fresh.getAccessToken()).toBeNull()
  })

  it('a page that booted with NO session reads another tab\'s sign-in (nothing to be sticky to)', async () => {
    vi.resetModules()
    const fresh = await import('./tokenStore')
    expect(fresh.getAccessToken()).toBeNull()

    participantPairInOtherTab()

    expect(fresh.getAccessToken()).toBe('p-access')
  })
})

describe('W2-1: the sticky record survives a reload (and a cross-tab reload)', () => {
  function participantPairInOtherTab(): void {
    localStorage.setItem(ACCESS_KEY, 'p-access')
    localStorage.setItem(REFRESH_KEY, 'p-refresh')
    localStorage.setItem(SESSION_MARKER_KEY, 'participant-marker')
  }

  it('a healthy staff session writes no record: sessionStorage holds the pair and its marker only', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })

    expect(sessionStorage.getItem(STICKY_SESSION_KEY)).toBeNull()
    expect(Object.keys(sessionStorage).sort())
      .toEqual([ACCESS_KEY, SESSION_MARKER_KEY, REFRESH_KEY].sort())
    expect(isSessionScoped()).toBe(true)
  })

  it('an automatic clear of a staff session leaves ONLY the record, and the page stays session-scoped', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()

    clearActiveTokens()

    expect(Object.keys(sessionStorage)).toEqual([STICKY_SESSION_KEY])
    expect(sessionStorage.getItem(STICKY_SESSION_KEY)).toBe('session')
    // Not a secret: no token, no identity.
    expect(sessionStorage.getItem(STICKY_SESSION_KEY)).not.toMatch(/staff|token/i)
    expect(isSessionScoped()).toBe(true)
    expect(isPersistentSession()).toBe(true) // the stores still say a participant pair exists
    expect(getAccessToken()).toBeNull()
  })

  it('an automatic clear of a PARTICIPANT session writes no record', () => {
    setTokens({ token: 'p-access', refreshToken: 'p-refresh' }, { persist: true })

    clearActiveTokens()

    expect(sessionStorage.length).toBe(0)
    expect(isSessionScoped()).toBe(false)
  })

  it('after a reload (F5) the page is still a staff page: null token, session-scoped', async () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    clearActiveTokens()

    vi.resetModules()
    const reloaded = await import('./tokenStore')

    expect(reloaded.getAccessToken()).toBeNull()
    expect(reloaded.getRefreshToken()).toBeNull()
    expect(reloaded.getSessionMarker()).toBeNull()
    expect(reloaded.isSessionScoped()).toBe(true)
    // The participant's pair is untouched, and is not rotated into by a stray refresh.
    expect(localStorage.getItem(ACCESS_KEY)).toBe('p-access')
    expect(reloaded.rotateTokens('p-refresh', { token: 'x', refreshToken: 'y' })).toBe(false)
  })

  it('without the record a reloaded page WOULD boot as the participant (the bug this prevents)', async () => {
    participantPairInOtherTab() // a bare tab: no staff tokens, no record

    vi.resetModules()
    const bare = await import('./tokenStore')

    expect(bare.getAccessToken()).toBe('p-access')
    expect(bare.isSessionScoped()).toBe(false)
  })

  it('a new staff sign-in removes the record (the tokens say where the session lives)', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    clearActiveTokens()
    expect(sessionStorage.getItem(STICKY_SESSION_KEY)).toBe('session')

    setTokens({ token: 'staff-2', refreshToken: 'staff-refresh-2' })

    expect(sessionStorage.getItem(STICKY_SESSION_KEY)).toBeNull()
    expect(isSessionScoped()).toBe(true)
  })

  it('a participant sign-in in this tab removes it and the page stops being session-scoped', async () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    clearActiveTokens()

    setTokens({ token: 'p-access', refreshToken: 'p-refresh' }, { persist: true })

    expect(sessionStorage.length).toBe(0)
    expect(isSessionScoped()).toBe(false)
    vi.resetModules()
    const reloaded = await import('./tokenStore')
    expect(reloaded.getAccessToken()).toBe('p-access')
  })

  it('an explicit sign-out removes it, so the next boot decides afresh', async () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    clearActiveTokens()

    clearTokens()

    expect(sessionStorage.length).toBe(0)
    expect(isSessionScoped()).toBe(false)
  })

  it('dies with the tab: it lives in sessionStorage, never localStorage', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    clearActiveTokens()

    expect(localStorage.getItem(STICKY_SESSION_KEY)).toBeNull()
  })

  it('is survivable when storage throws: no function throws and the page still goes sticky in memory', () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    breakStorage('setItem')

    expect(() => clearActiveTokens()).not.toThrow()

    expect(getAccessToken()).toBeNull()
    expect(isSessionScoped()).toBe(true)
  })
})
