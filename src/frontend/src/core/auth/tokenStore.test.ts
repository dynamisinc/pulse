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
 *     none of the functions throw and the app works from an in-memory copy.
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
  getTokenGeneration,
} from './tokenStore'

const ACCESS_KEY = 'pulse.auth.token'
const REFRESH_KEY = 'pulse.auth.refreshToken'

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

  it('falls through to localStorage for a key sessionStorage does not hold', () => {
    sessionStorage.setItem(ACCESS_KEY, 'session-access')
    localStorage.setItem(REFRESH_KEY, 'local-refresh')

    expect(getAccessToken()).toBe('session-access')
    expect(getRefreshToken()).toBe('local-refresh')
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
