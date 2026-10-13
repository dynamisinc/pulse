/**
 * core/auth/crossTabSessionSync.test.ts
 * ---------------------------------------------------------------------------
 * Coverage for the cross-tab identity listener (easy-login story 07, M-2): a tab
 * reloads when ANOTHER tab changes the session identity marker (a new sign-in or
 * a sign-out), but not on a same-sign-in refresh rotation, not for a staff
 * (`sessionStorage`) session, and not for unrelated keys.
 *
 * `localStorage` is the only source it acts on (`event.storageArea`), and a bare
 * `localStorage.clear()` elsewhere (key `null`) reloads a page only if that wipe
 * actually took THIS page's marker.
 *
 * The listener is installed on a stand-in `EventTarget` with a spy for `reload`,
 * so no real navigation happens. (A real `localStorage` write in the SAME window
 * never fires a `storage` event, which is also what makes it a faithful model of
 * "only OTHER tabs hear it".) The tab's own session is set up through the real
 * token store, because the listener consults it to ignore staff sessions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installCrossTabSessionSync } from './crossTabSessionSync'
import {
  setTokens,
  rotateTokens,
  clearTokens,
  clearActiveTokens,
  SESSION_MARKER_KEY,
} from './tokenStore'

const target = new EventTarget()
let uninstall: () => void = () => undefined
const reload = vi.fn()

/** A `storage` event as a browser raises it in OTHER tabs: from `localStorage` by default. */
function storageEvent(init: StorageEventInit): void {
  target.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, ...init }))
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

  it('reloads when another tab wipes localStorage and that took THIS page\'s marker (key null)', () => {
    localStorage.clear() // what the other tab did
    storageEvent({ key: null })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload on a wipe elsewhere that left this page\'s marker in place', () => {
    // A `clear()` event, but the store still holds our identity (e.g. it was rewritten).
    storageEvent({ key: null })

    expect(reload).not.toHaveBeenCalled()
  })

  it('does NOT reload for an event from sessionStorage, even for the marker key', () => {
    storageEvent({
      key: SESSION_MARKER_KEY,
      oldValue: 'marker-1',
      newValue: 'marker-2',
      storageArea: sessionStorage,
    })

    expect(reload).not.toHaveBeenCalled()
  })

  it('does NOT reload for an event that names no storage area', () => {
    storageEvent({
      key: SESSION_MARKER_KEY,
      oldValue: 'marker-1',
      newValue: 'marker-2',
      storageArea: null,
    })

    expect(reload).not.toHaveBeenCalled()
  })

  it('ignores the event (and does not throw) if localStorage cannot even be touched', () => {
    const event = new StorageEvent('storage', {
      key: SESSION_MARKER_KEY,
      oldValue: 'marker-1',
      newValue: 'marker-2',
      storageArea: localStorage,
    })
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(() => target.dispatchEvent(event)).not.toThrow()
    vi.restoreAllMocks()

    expect(reload).not.toHaveBeenCalled()
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

  it('does NOT reload on a localStorage wipe: it had no marker for the wipe to take', () => {
    storageEvent({ key: null })

    expect(reload).not.toHaveBeenCalled()
  })

  it('does NOT reload on a wipe after its own sign-out either (nothing of its left to lose)', () => {
    setTokens({ token: 'mine', refreshToken: 'mine-refresh' }, { persist: true })
    clearTokens() // this page signed out itself

    storageEvent({ key: null })

    expect(reload).not.toHaveBeenCalled()
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

describe('installCrossTabSessionSync — a REFUSED staff tab is still a staff tab (W2-1)', () => {
  beforeEach(() => {
    setTokens({ token: 'staff', refreshToken: 'staff-refresh' }) // session-only
    // The staff refresh token is refused: the automatic clear empties sessionStorage.
    clearActiveTokens()
  })

  it.each([
    ['a participant signing in elsewhere', { key: SESSION_MARKER_KEY, oldValue: null, newValue: 'm2' }],
    ['a participant replacing another sign-in', { key: SESSION_MARKER_KEY, oldValue: 'm1', newValue: 'm2' }],
    ['a participant signing out elsewhere', { key: SESSION_MARKER_KEY, oldValue: 'm1', newValue: null }],
    ['localStorage being wiped', { key: null }],
  ])('is NOT reloaded into the participant identity by %s', (_label, init) => {
    storageEvent(init)

    expect(reload).not.toHaveBeenCalled()
  })

  it('stays ignored after a reload too: the record is read back at boot', async () => {
    localStorage.setItem('pulse.auth.token', 'p-access')
    localStorage.setItem('pulse.auth.refreshToken', 'p-refresh')
    localStorage.setItem(SESSION_MARKER_KEY, 'participant-marker')

    vi.resetModules()
    const freshStore = await import('./tokenStore')
    const freshSync = await import('./crossTabSessionSync')
    const reloadAgain = vi.fn()
    const stop = freshSync.installCrossTabSessionSync(target, reloadAgain)
    try {
      storageEvent({ key: SESSION_MARKER_KEY, oldValue: 'participant-marker', newValue: 'm3' })
      storageEvent({ key: SESSION_MARKER_KEY, oldValue: 'm3', newValue: null })

      expect(reloadAgain).not.toHaveBeenCalled()
      expect(freshStore.getAccessToken()).toBeNull()
    } finally {
      stop()
    }
  })

  it('an explicit sign-out ends it: that page is an ordinary session-less page again', () => {
    clearTokens()

    storageEvent({ key: SESSION_MARKER_KEY, oldValue: null, newValue: 'marker-1' })

    expect(reload).toHaveBeenCalledTimes(1)
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
