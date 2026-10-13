/**
 * core/auth/crossTabSessionSync.test.ts
 * ---------------------------------------------------------------------------
 * Coverage for the cross-tab identity listener (easy-login story 07, M-2): a tab
 * reloads when ANOTHER tab changes the session identity marker (a new sign-in or
 * a sign-out), but not on a same-sign-in refresh rotation, not for a staff
 * (`sessionStorage`) session, and not for unrelated keys.
 *
 * The listener is installed on a stand-in `EventTarget` with a spy for `reload`,
 * so no real navigation happens. (A real `localStorage` write in the SAME window
 * never fires a `storage` event, which is also what makes it a faithful model of
 * "only OTHER tabs hear it".) The tab's own session is set up through the real
 * token store, because the listener consults it to ignore staff sessions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installCrossTabSessionSync } from './crossTabSessionSync'
import { setTokens, rotateTokens, clearTokens, SESSION_MARKER_KEY } from './tokenStore'

const target = new EventTarget()
let uninstall: () => void = () => undefined
const reload = vi.fn()

function storageEvent(init: StorageEventInit): void {
  target.dispatchEvent(new StorageEvent('storage', init))
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  reload.mockReset()
  uninstall = installCrossTabSessionSync(target, reload)
})

afterEach(() => {
  uninstall()
  clearTokens()
  sessionStorage.clear()
  localStorage.clear()
})

describe('installCrossTabSessionSync — a participant tab (localStorage)', () => {
  beforeEach(() => {
    setTokens({ token: 'mine', refreshToken: 'mine-refresh' }, { persist: true })
  })

  it('reloads when another tab signs in as someone else (the marker changes)', () => {
    storageEvent({ key: SESSION_MARKER_KEY, oldValue: 'marker-1', newValue: 'marker-2' })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads when another tab signs out (the marker is removed)', () => {
    storageEvent({ key: SESSION_MARKER_KEY, oldValue: 'marker-1', newValue: null })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads when another tab signs in after having been signed out (the marker appears)', () => {
    storageEvent({ key: SESSION_MARKER_KEY, oldValue: null, newValue: 'marker-1' })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads when another tab wipes localStorage (key null)', () => {
    storageEvent({ key: null })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload on a same-sign-in rotation: only the token keys change', () => {
    storageEvent({ key: 'pulse.auth.token', oldValue: 'a1', newValue: 'a2' })
    storageEvent({ key: 'pulse.auth.refreshToken', oldValue: 'r1', newValue: 'r2' })

    expect(reload).not.toHaveBeenCalled()
  })

  it('does NOT reload for a marker event whose value did not change', () => {
    storageEvent({ key: SESSION_MARKER_KEY, oldValue: 'marker-1', newValue: 'marker-1' })

    expect(reload).not.toHaveBeenCalled()
  })

  it('does NOT reload for unrelated keys', () => {
    storageEvent({ key: 'pulse.something.else', oldValue: 'a', newValue: 'b' })

    expect(reload).not.toHaveBeenCalled()
  })

  it('a real refresh rotation leaves the marker alone, so there is nothing to announce', () => {
    const before = localStorage.getItem(SESSION_MARKER_KEY)

    rotateTokens('mine-refresh', { token: 'mine-2', refreshToken: 'mine-refresh-2' })

    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBe(before)
  })

  it('a real sign-in changes the marker, and a real sign-out removes it', () => {
    const before = localStorage.getItem(SESSION_MARKER_KEY)

    setTokens({ token: 'other', refreshToken: 'other-refresh' }, { persist: true })
    const after = localStorage.getItem(SESSION_MARKER_KEY)
    expect(after).toBeTruthy()
    expect(after).not.toBe(before)

    clearTokens()
    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBeNull()
  })
})

describe('installCrossTabSessionSync — a tab with no session of its own', () => {
  it('reloads when another tab signs in (so e.g. a login page follows the store)', () => {
    storageEvent({ key: SESSION_MARKER_KEY, oldValue: null, newValue: 'marker-1' })

    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('installCrossTabSessionSync — a staff tab (sessionStorage) is unaffected', () => {
  beforeEach(() => {
    setTokens({ token: 'staff', refreshToken: 'staff-refresh' }) // session-only
  })

  it.each([
    ['a participant signing in elsewhere', { key: SESSION_MARKER_KEY, oldValue: 'm1', newValue: 'm2' }],
    ['a participant signing out elsewhere', { key: SESSION_MARKER_KEY, oldValue: 'm1', newValue: null }],
    ['localStorage being wiped', { key: null }],
  ])('does not reload on %s', (_label, init) => {
    storageEvent(init)

    expect(reload).not.toHaveBeenCalled()
  })
})

describe('installCrossTabSessionSync — lifecycle', () => {
  it('stops listening once uninstalled', () => {
    uninstall()

    storageEvent({ key: SESSION_MARKER_KEY, oldValue: 'm1', newValue: 'm2' })

    expect(reload).not.toHaveBeenCalled()
  })

  it('is a harmless no-op where there is no window to listen on', () => {
    const noop = installCrossTabSessionSync(null, reload)

    expect(() => noop()).not.toThrow()
  })
})
