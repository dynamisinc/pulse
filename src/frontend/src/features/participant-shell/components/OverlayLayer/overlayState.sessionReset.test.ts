/**
 * features/participant-shell/components/OverlayLayer/overlayState.sessionReset.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE overlay-state source across an IDENTITY CHANGE on one tab (COR-001): sign-out then
 * sign-in as another participant, or any `completeSignIn`. The source is a tab-lived singleton,
 * but its snapshot, its sequence cutoff, its GET and its hub connection all belong to ONE
 * participant identity (and exercise). `resetClientSession()` therefore (a) stops the shared
 * connection and (b) runs this source's registered session reset. Pinned here:
 *  - the previous identity's holding page is dropped back to the safe `'none'` (an overlay one
 *    exercise froze must not outlive the identity that saw it), and its pushes are no longer
 *    heard;
 *  - the sequence cutoff goes back to 0: the next exercise counts its own sequence, so its first
 *    push (sequence 2, say) is not discarded as "older" than the last exercise's (sequence 7);
 *  - a GET still in flight for the previous identity is DISCARDED when it lands;
 *  - the next `ensureStarted()` (the next shell mount) does a full fresh start - GET, subscribe,
 *    `connection.start()` - which opens a NEW connection on the NEW token, so the source is not
 *    left permanently attached to a connection that was stopped;
 *  - a shell that is STILL mounted re-attaches itself, whichever order the resets ran in, but not
 *    after a sign-out (no token).
 *
 * Uses the REAL shared-connection wrapper over a fake transport, with the wrapper's own stop
 * registered on the session-reset registry the way `connection.ts` registers the singleton's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import { registerSessionReset, runSessionResets } from '@/core/auth/sessionReset'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { createFakeTransport } from '@/test/fakeHubConnection'
import type { FakeTransport } from '@/test/fakeHubConnection'
import { liveOverlayStateStore } from './overlayState'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

const NONE = { state: 'none', register: 'in-fiction', message: '', ended: false }

function wireState(overrides: Record<string, unknown> = {}) {
  return { ...NONE, sequence: 1, ...overrides }
}

/** Lets the source's own `void` promises, and the deferred re-attach, settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

let transport: FakeTransport
let unregisterConnectionReset: () => void

beforeEach(() => {
  getMock.mockReset()
  getMock.mockResolvedValue({ data: wireState({ state: 'pause', message: 'Paused', sequence: 7 }) })
  liveOverlayStateStore.resetForTests()
  setTokens({ token: 'identity-A' })
  transport = createFakeTransport()
  // What `connection.ts` does for the app-wide singleton: stop the connection with the session.
  // Registered AFTER the source's own reset (which registers at import), the order that matters.
  unregisterConnectionReset = registerSessionReset(() => {
    void transport.connection.stop()
  })
})

afterEach(() => {
  unregisterConnectionReset()
  liveOverlayStateStore.resetForTests()
  clearTokens()
})

describe('liveOverlayStateStore - the session ends', () => {
  it('drops the previous identity\'s holding page back to "none", notifying subscribers', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
    const listener = vi.fn()
    liveOverlayStateStore.subscribe(listener)
    getMock.mockResolvedValue({ data: wireState() }) // (a re-attach below would re-read this)

    runSessionResets()

    expect(liveOverlayStateStore.getSnapshot()).toEqual(NONE)
    expect(listener).toHaveBeenCalled()
  })

  it('stops hearing the previous identity\'s pushes', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()

    runSessionResets()
    await flush()
    transport.fakes[0]?.emit('OverlayStateChanged', wireState({ state: 'endex', sequence: 9 }))

    expect(liveOverlayStateStore.getSnapshot()).toEqual(NONE)
  })

  it('discards a GET that was still in flight for the previous identity', async () => {
    const slow = deferred<{ data: unknown }>()
    getMock.mockReturnValue(slow.promise)
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()

    runSessionResets() // identity A ends while its GET is on the wire
    slow.resolve({ data: wireState({ state: 'pause', sequence: 8 }) })
    await flush()

    expect(liveOverlayStateStore.getSnapshot()).toEqual(NONE)
  })

  it('the next ensureStarted() does a full fresh start: a NEW connection on the NEW token', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()
    expect(transport.fakes[0]?.startedWithToken).toBe('identity-A')

    setTokens({ token: 'identity-B' }) // completeSignIn: store the new pair, then reset
    runSessionResets()
    await flush()
    getMock.mockResolvedValue({ data: wireState({ sequence: 0 }) }) // exercise B: not paused
    liveOverlayStateStore.ensureStarted(transport.connection) // the next shell mounts
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[1]?.startedWithToken).toBe('identity-B')
    expect(liveOverlayStateStore.getSnapshot()).toEqual(NONE) // A's pause did not carry over
    // Live again on the new connection, and only on it.
    transport.fakes[1]?.emit('OverlayStateChanged', wireState({ state: 'broadcast', sequence: 1 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('broadcast')
    transport.fakes[0]?.emit('OverlayStateChanged', wireState({ state: 'endex', sequence: 50 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('broadcast')
  })

  it('counts the next exercise\'s sequence from scratch: a low sequence is not "stale" any more', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection) // A's cutoff is now 7
    await flush()

    runSessionResets()
    await flush()
    // B's seeding GET fails, so nothing re-bases the cutoff but the reset itself.
    getMock.mockRejectedValue(new Error('network'))
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()
    transport.fakes[1]?.emit('OverlayStateChanged', wireState({ state: 'pause', sequence: 2 }))

    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })
})

describe('liveOverlayStateStore - a shell still mounted when the session ends', () => {
  it('re-attaches itself on the new token, with the source reset running BEFORE the stop', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()
    liveOverlayStateStore.subscribe(() => {}) // a mounted <OverlayLayer>
    const getsBefore = getMock.mock.calls.length
    getMock.mockResolvedValue({ data: wireState({ state: 'none', sequence: 0 }) })

    setTokens({ token: 'identity-B' })
    runSessionResets() // registry order: this source first, then the connection's stop
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[1]?.startedWithToken).toBe('identity-B')
    expect(getMock.mock.calls.length).toBeGreaterThan(getsBefore) // the state was re-read
    transport.fakes[1]?.emit('OverlayStateChanged', wireState({ state: 'pause', sequence: 1 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })

  it('re-attaches itself equally when the connection was already stopped first', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()
    liveOverlayStateStore.subscribe(() => {})

    setTokens({ token: 'identity-B' })
    void transport.connection.stop() // the other order: the stop has already begun
    runSessionResets()
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[1]?.startedWithToken).toBe('identity-B')
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
  })

  it('does NOT re-attach after a sign-out: there is no session token to attach as', async () => {
    liveOverlayStateStore.ensureStarted(transport.connection)
    await flush()
    liveOverlayStateStore.subscribe(() => {})
    const getsBefore = getMock.mock.calls.length

    runSessionResets() // endSession runs the reset, and logout() clears the tokens right after
    clearTokens()
    await flush()

    expect(transport.fakes).toHaveLength(1)
    expect(getMock.mock.calls.length).toBe(getsBefore)
  })
})
