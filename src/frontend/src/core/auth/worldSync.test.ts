/**
 * core/auth/worldSync.test.ts
 * ---------------------------------------------------------------------------
 * One world per origin, client half: a sign-in announces `{world, at}` on
 * BroadcastChannel('pulse-world') (storage-event fallback); tabs of the OTHER world sign out,
 * clear their own store only, and go to their sign-in page. BroadcastChannel is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearActiveTokens, clearTokens, getAccessToken, setTokens } from './tokenStore'
import {
  WORLD_CHANNEL_NAME,
  TAB_ID,
  WORLD_SIGNAL_KEY,
  announceWorldSignIn,
  parseWorldSignal,
} from './worldBroadcast'
import { WORLD_SIGN_IN_PATHS, installWorldSync, type WorldChannelLike } from './worldSync'

class FakeChannel implements WorldChannelLike {
  static instances: FakeChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  readonly posted: unknown[] = []
  readonly name: string
  constructor(name: string) {
    this.name = name
    FakeChannel.instances.push(this)
  }
  postMessage(data: unknown): void { this.posted.push(data) }
  close(): void { this.closed = true }
  deliver(data: unknown): void { this.onmessage?.({ data } as MessageEvent) }
}

beforeEach(() => {
  FakeChannel.instances = []
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  clearTokens()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearTokens()
  localStorage.clear()
})

function setup() {
  const postLogout = vi.fn(() => Promise.resolve())
  const navigate = vi.fn()
  const channel = new FakeChannel(WORLD_CHANNEL_NAME)
  const stop = installWorldSync({ createChannel: () => channel, postLogout, navigate })
  return { channel, postLogout, navigate, stop }
}

describe('announceWorldSignIn / setTokens', () => {
  it('posts {world, at} on the pulse-world channel: staff for a sessionStorage sign-in', () => {
    setTokens({ token: 'a', refreshToken: 'r' })
    const sent = FakeChannel.instances.at(-1)
    expect(sent?.name).toBe('pulse-world')
    expect(sent?.closed).toBe(true)
    expect(parseWorldSignal(sent?.posted[0])).toMatchObject({ world: 'staff' })
  })

  it('posts participant for a persistent sign-in', () => {
    setTokens({ token: 'a' }, { persist: true })
    expect(parseWorldSignal(FakeChannel.instances.at(-1)?.posted[0])).toMatchObject({
      world: 'participant',
    })
  })

  it('falls back to a localStorage write when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    announceWorldSignIn('participant')
    expect(parseWorldSignal(localStorage.getItem(WORLD_SIGNAL_KEY))).toMatchObject({
      world: 'participant',
    })
  })

  it('rejects malformed signals', () => {
    expect(parseWorldSignal({ world: 'admin', at: 'x' })).toBeNull()
    expect(parseWorldSignal('not json')).toBeNull()
    expect(parseWorldSignal(null)).toBeNull()
  })
})

describe('installWorldSync receiver', () => {
  it('a staff tab signs out and goes to the staff sign-in when a participant signs in', () => {
    setTokens({ token: 'staff-tok', refreshToken: 'staff-ref' })
    const { channel, postLogout, navigate } = setup()

    channel.deliver({ world: 'participant', at: new Date().toISOString() })

    expect(postLogout).toHaveBeenCalledWith('staff-tok')
    expect(getAccessToken()).toBeNull()
    expect(navigate).toHaveBeenCalledWith(WORLD_SIGN_IN_PATHS.staff)
  })

  it('a participant tab signs out and goes to /login when staff signs in elsewhere', () => {
    setTokens({ token: 'p-tok' }, { persist: true })
    const { channel, postLogout, navigate } = setup()

    channel.deliver({ world: 'staff', at: new Date().toISOString() })

    expect(postLogout).toHaveBeenCalledWith('p-tok')
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  it('a staff tab whose tokens were cleared (sticky-empty) ignores a participant sign-in (W-2)', () => {
    setTokens({ token: 'staff-tok', refreshToken: 'staff-ref' })
    clearActiveTokens()
    const { channel, postLogout, navigate } = setup()

    channel.deliver({ world: 'participant', at: new Date().toISOString() })

    expect(postLogout).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not call the logout poster when there is no access token (S-4), but still signs out', () => {
    localStorage.setItem('pulse.auth.refreshToken', 'only-refresh')
    const { channel, postLogout, navigate } = setup()

    channel.deliver({ world: 'staff', at: new Date().toISOString() })

    expect(postLogout).not.toHaveBeenCalled()
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBeNull()
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  it('clears only its own store: the signing-in tab pair in the other store survives', () => {
    setTokens({ token: 'staff-tok' })
    const { channel } = setup()
    // The participant tab (another tab) wrote its pair to localStorage.
    localStorage.setItem('pulse.auth.token', 'p-tok')

    channel.deliver({ world: 'participant', at: new Date().toISOString() })

    expect(localStorage.getItem('pulse.auth.token')).toBe('p-tok')
  })

  it('ignores a same-world signal, a tab with no session, and garbage', () => {
    setTokens({ token: 'staff-tok' })
    const { channel, postLogout, navigate } = setup()
    channel.deliver({ world: 'staff', at: new Date().toISOString() })
    channel.deliver({ nonsense: true })
    expect(postLogout).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()

    clearTokens()
    channel.deliver({ world: 'participant', at: new Date().toISOString() })
    expect(postLogout).not.toHaveBeenCalled()
  })

  it('still ends the session locally when the logout request fails', () => {
    setTokens({ token: 'staff-tok' })
    const postLogout = vi.fn(() => Promise.reject(new Error('offline')))
    const navigate = vi.fn()
    const channel = new FakeChannel(WORLD_CHANNEL_NAME)
    installWorldSync({ createChannel: () => channel, postLogout, navigate })

    channel.deliver({ world: 'participant', at: 'now' })

    expect(getAccessToken()).toBeNull()
    expect(navigate).toHaveBeenCalledWith('/staff/login')
  })

  it('ignores its own echo (same-context channels deliver to each other)', () => {
    setTokens({ token: 'staff-tok' })
    const { channel, postLogout } = setup()
    channel.deliver({ world: 'participant', at: 'now', source: TAB_ID })
    expect(postLogout).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('staff-tok')
  })

  it('uninstalling closes the channel', () => {
    const { channel, stop } = setup()
    stop()
    expect(channel.closed).toBe(true)
    expect(channel.onmessage).toBeNull()
  })

  it('listens for the storage-event fallback when there is no BroadcastChannel', () => {
    setTokens({ token: 'staff-tok' })
    const target = new EventTarget() as unknown as Window
    const postLogout = vi.fn(() => Promise.resolve())
    const navigate = vi.fn()
    installWorldSync({ createChannel: () => null, storageTarget: target, postLogout, navigate })

    target.dispatchEvent(new StorageEvent('storage', {
      key: WORLD_SIGNAL_KEY,
      newValue: JSON.stringify({ world: 'participant', at: 'now' }),
    }))

    expect(postLogout).toHaveBeenCalledWith('staff-tok')
    expect(navigate).toHaveBeenCalledWith('/staff/login')
  })
})
