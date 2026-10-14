/**
 * features/controller/engine/services/liveReviewStore.sessionReset.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE review-queue store across an IDENTITY CHANGE on one tab (COR-001): sign-out then
 * sign-in as another staff user, or any `completeSignIn`. The store is a tab-lived singleton, but
 * its snapshot, its GET and its hub connection all belong to ONE staff identity (and exercise).
 * `resetClientSession()` therefore (a) stops the shared connection and (b) runs this store's
 * registered session reset. Pinned here:
 *  - the previous identity's queue is forgotten and its pushes are no longer heard (a failed GET
 *    would otherwise leave them on screen under the new identity);
 *  - a GET still in flight for the previous identity is DISCARDED when it lands;
 *  - the next `ensureStarted()` (the next console mount) does a full fresh start - GET, subscribe,
 *    `connection.start()` - which opens a NEW connection on the NEW token, so the store is not
 *    left permanently attached to a connection that was stopped;
 *  - a console that is STILL mounted re-attaches itself, whichever order the resets ran in
 *    (store before the connection's stop, or after), but not after a sign-out (no token).
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
import { liveReviewStore } from './liveReviewStore'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: () => Promise.resolve({ data: {} }),
  },
}))

function wireItem(overrides: Record<string, unknown> = {}) {
  return {
    exerciseId: 'ex-live-0001',
    storylineId: 'storyline-live',
    draftId: 'draft-live-1',
    routedAtLevel: 'suggest',
    disposition: 'queued',
    countdown: null,
    posts: [{ personaHandle: 'FulcoEM', text: 'draft text', sentiment: 0, hashtags: ['#Tag'] }],
    storylineTag: '#Tag',
    storylineBrief: 'brief',
    actionLabel: 'reply',
    ...overrides,
  }
}

/** Lets the store's own `void` promises, and the deferred re-attach, settle. */
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
  getMock.mockResolvedValue({ data: [wireItem()] })
  liveReviewStore.resetForTests()
  setTokens({ token: 'identity-A' })
  transport = createFakeTransport()
  // What `connection.ts` does for the app-wide singleton: stop the connection with the session.
  // Registered AFTER the store's own reset (which registers at import), the order that matters.
  unregisterConnectionReset = registerSessionReset(() => {
    void transport.connection.stop()
  })
})

afterEach(() => {
  unregisterConnectionReset()
  liveReviewStore.resetForTests()
  clearTokens()
})

describe('liveReviewStore - the session ends', () => {
  it('forgets the previous identity\'s queue, notifying subscribers, and stops hearing its pushes', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    expect(liveReviewStore.getItems()).toHaveLength(1)

    runSessionResets()
    await flush()

    expect(liveReviewStore.getItems()).toEqual([])
    // The old connection's push handler is detached: a late frame reaches nobody.
    transport.fakes[0]?.emit('ReviewItemChanged', wireItem({ draftId: 'draft-from-old-exercise' }))
    expect(liveReviewStore.getItems()).toEqual([])
  })

  it('notifies a mounted subscriber that the queue emptied', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    const listener = vi.fn()
    liveReviewStore.subscribe(listener)

    runSessionResets()

    expect(listener).toHaveBeenCalled()
    expect(liveReviewStore.getItems()).toEqual([])
  })

  it('discards a GET that was still in flight for the previous identity', async () => {
    const slow = deferred<{ data: unknown }>()
    getMock.mockReturnValue(slow.promise)
    liveReviewStore.ensureStarted(transport.connection)
    await flush()

    runSessionResets() // identity A ends while its GET is on the wire
    slow.resolve({ data: [wireItem({ draftId: 'draft-from-identity-A' })] })
    await flush()

    expect(liveReviewStore.getItems()).toEqual([])
  })

  it('the next ensureStarted() does a full fresh start: a NEW connection on the NEW token', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    expect(transport.fakes[0]?.startedWithToken).toBe('identity-A')

    setTokens({ token: 'identity-B' }) // completeSignIn: store the new pair, then reset
    runSessionResets()
    await flush()
    getMock.mockResolvedValue({ data: [wireItem({ draftId: 'draft-b' })] })
    liveReviewStore.ensureStarted(transport.connection) // the next console mounts
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[1]?.startedWithToken).toBe('identity-B')
    expect(liveReviewStore.getItems().map(item => item.draftId)).toEqual(['draft-b'])
    // Live again on the new connection, and only on it.
    transport.fakes[1]?.emit('ReviewItemChanged', wireItem({ draftId: 'draft-pushed' }))
    expect(liveReviewStore.getItems().map(item => item.draftId)).toEqual(['draft-b', 'draft-pushed'])
    transport.fakes[0]?.emit('ReviewItemChanged', wireItem({ draftId: 'draft-from-old-exercise' }))
    expect(liveReviewStore.getItems().map(item => item.draftId)).toEqual(['draft-b', 'draft-pushed'])
  })
})

describe('liveReviewStore - a console still mounted when the session ends', () => {
  it('re-attaches itself on the new token, with the store reset running BEFORE the stop', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    liveReviewStore.subscribe(() => {}) // a mounted <ReviewQueue>
    const getsBefore = getMock.mock.calls.length

    setTokens({ token: 'identity-B' })
    runSessionResets() // registry order: this store first, then the connection's stop
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[1]?.startedWithToken).toBe('identity-B')
    expect(getMock.mock.calls.length).toBeGreaterThan(getsBefore) // the queue was re-read
    transport.fakes[1]?.emit('ReviewItemChanged', wireItem({ draftId: 'draft-pushed' }))
    expect(liveReviewStore.getItems().map(item => item.draftId)).toContain('draft-pushed')
  })

  it('re-attaches itself equally when the connection was already stopped first', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    liveReviewStore.subscribe(() => {})

    setTokens({ token: 'identity-B' })
    void transport.connection.stop() // the other order: the stop has already begun
    runSessionResets()
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[1]?.startedWithToken).toBe('identity-B')
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
  })

  it('does NOT re-attach after a sign-out: there is no session token to attach as', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    liveReviewStore.subscribe(() => {})
    const getsBefore = getMock.mock.calls.length

    runSessionResets() // endSession runs the reset, and logout() clears the tokens right after
    clearTokens()
    await flush()

    expect(transport.fakes).toHaveLength(1)
    expect(getMock.mock.calls.length).toBe(getsBefore)
  })
})
