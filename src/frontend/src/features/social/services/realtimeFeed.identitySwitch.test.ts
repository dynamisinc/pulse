/**
 * features/social/services/realtimeFeed.identitySwitch.test.ts
 * ---------------------------------------------------------------------------
 * The social feed's transport across an IDENTITY CHANGE on one tab (COR-001): sign-out then
 * sign-in as someone else, or any `completeSignIn`. The session reset STOPS the shared hub
 * connection, because the server joined it to the previous identity's exercise groups once, at
 * connect, from the token presented then (see `core/realtime/connection.ts`).
 *
 * The feed must RECOVER from that, not degrade permanently. A deliberate stop reaches it as
 * `Disconnected` with reason `'stopped'` (distinct from a bare `Disconnected`, "auto-reconnect
 * exhausted"), and:
 *   - a feed that is still started RE-ATTACHES: a fresh connection on the NEW token, its handlers
 *     intact, real-time mode, no polling flash; if that fails it falls back to polling, whose
 *     recovery driver brings real-time back;
 *   - a feed that is not started (the usual case: the screens unmounted) simply starts clean on
 *     the next mount, again on the new token;
 *   - nothing the OLD connection still carries can reach it.
 * Through `feedStreamSource` too: the ref-counted source every feed, thread, notifications and
 * live-world consumer shares.
 *
 * Uses the REAL shared-connection wrapper over a fake transport (`@/test/fakeHubConnection`), so
 * the stop/restart logic under test is the production code, not a stand-in. Fake timers, as in
 * `realtimeFeed.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import type { ParticipantPostView, Post } from '@/features/social'
import { createFakeTransport } from '@/test/fakeHubConnection'
import { createRealtimeFeed } from './realtimeFeed'
import { makeRealtimeArrivalSource, refCounted } from './feedStreamSource'

function pushPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-push-1',
    authorPersonaId: 'persona-a',
    text: 'pushed post',
    scenarioTime: '2033-09-04T13:05:00Z',
    counts: { reply: 0, repost: 0, like: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  setTokens({ token: 'identity-A' })
})

afterEach(() => {
  vi.useRealTimers()
  clearTokens()
})

describe('a feed that is still started when the identity changes', () => {
  it('re-attaches on the NEW token in real-time mode, without ever polling', async () => {
    const { connection, fakes } = createFakeTransport()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    const received: ParticipantPostView[] = []
    feed.subscribe(post => received.push(post))
    await feed.start()
    expect(feed.mode).toBe('realtime')
    expect(fakes[0]?.startedWithToken).toBe('identity-A')

    // What `completeSignIn` does: store the new pair, then reset the session (stop).
    setTokens({ token: 'identity-B' })
    await connection.stop()
    await vi.advanceTimersByTimeAsync(0)

    expect(fakes).toHaveLength(2)
    expect(fakes[1]?.startedWithToken).toBe('identity-B')
    expect(connection.state).toBe(HubConnectionState.Connected)
    expect(feed.mode).toBe('realtime') // not 'polling': a deliberate stop is not a lost hub
    expect(fetchFeed).not.toHaveBeenCalled()

    // The feed's handlers rode over to the new connection...
    fakes[1]?.emit('PostReceived', pushPayload())
    expect(received.map(post => post.id)).toEqual(['post-push-1'])
    // ...and the previous identity's connection can deliver nothing, even if it still tries.
    fakes[0]?.emit('PostReceived', pushPayload({ id: 'post-from-the-old-exercise' }))
    expect(received.map(post => post.id)).toEqual(['post-push-1'])

    feed.stop()
  })

  it('falls back to polling if the re-attach fails, and the recovery driver restores real-time', async () => {
    let attempts = 0
    const { connection, fakes } = createFakeTransport((fake, index) => {
      // The SECOND connection (the re-attach) is unreachable on its first try only.
      if (index === 1) {
        fake.startImpl = () => (attempts++ === 0 ? Promise.reject(new Error('hub down')) : Promise.resolve())
      }
    })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    await feed.start()

    setTokens({ token: 'identity-B' })
    await connection.stop()
    await vi.advanceTimersByTimeAsync(0)

    // The failed re-attach degraded to polling (a GET /feed was made) and, in that same tick,
    // the recovery driver started the connection again.
    expect(fetchFeed).toHaveBeenCalled()
    expect(fakes).toHaveLength(2)
    expect(fakes[1]?.startCallCount).toBe(2)
    expect(feed.mode).toBe('realtime')

    // Real-time is back, so polling has stopped for good.
    const calls = fetchFeed.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchFeed).toHaveBeenCalledTimes(calls)

    feed.stop()
  })

  it('recovers when the stop lands while its very first start is still in flight', async () => {
    let releaseStart: () => void = () => {}
    const { connection, fakes } = createFakeTransport((fake, index) => {
      // The first negotiate is still on the wire when the identity changes.
      if (index === 0) {
        fake.startImpl = () => new Promise<void>(resolve => { releaseStart = resolve })
      }
    })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    const starting = feed.start()

    setTokens({ token: 'identity-B' })
    const stopping = connection.stop() // overtakes the start in flight
    releaseStart() // the library notices the stop when the negotiate returns, and aborts the start
    await stopping
    await vi.advanceTimersByTimeAsync(0)
    await starting

    expect(fakes[0]?.state).toBe(HubConnectionState.Disconnected) // never came up on identity A
    expect(fakes[fakes.length - 1]?.startedWithToken).toBe('identity-B')
    expect(connection.state).toBe(HubConnectionState.Connected)
    expect(feed.mode).toBe('realtime')

    feed.stop()
  })

  it('still degrades to polling when the hub is genuinely lost (auto-reconnect exhausted)', async () => {
    const { connection, fakes } = createFakeTransport()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    await feed.start()

    // A bare Disconnected (no 'stopped' reason) is the existing NFR-003 path, unchanged.
    const first = fakes[0]
    if (first === undefined) throw new Error('no connection was built')
    first.startImpl = () => Promise.reject(new Error('still down'))
    first.triggerClose()
    await vi.advanceTimersByTimeAsync(0)

    expect(feed.mode).toBe('polling')
    expect(fetchFeed).toHaveBeenCalled()

    feed.stop()
  })
})

describe('a feed that is not started when the identity changes (its screens unmounted)', () => {
  it('starts clean on the next mount, on the NEW token, in real-time mode', async () => {
    const { connection, fakes } = createFakeTransport()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    await feed.start()
    feed.stop() // the participant's screens unmount on sign-out

    await connection.stop()
    setTokens({ token: 'identity-B' })
    await vi.advanceTimersByTimeAsync(0)
    const received: ParticipantPostView[] = []
    feed.subscribe(post => received.push(post))
    await feed.start() // the next identity's screen mounts

    expect(feed.mode).toBe('realtime')
    expect(fakes).toHaveLength(2)
    expect(fakes[1]?.startedWithToken).toBe('identity-B')
    expect(fetchFeed).not.toHaveBeenCalled()
    fakes[1]?.emit('PostReceived', pushPayload())
    expect(received.map(post => post.id)).toEqual(['post-push-1'])

    feed.stop()
  })
})

describe('the ref-counted arrival source every feed consumer shares (feedStreamSource)', () => {
  it('every holder is carried over a stop: real-time again, on the new token, posts still flowing', async () => {
    const { connection, fakes } = createFakeTransport()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    const source = refCounted(makeRealtimeArrivalSource(feed))
    const received: ParticipantPostView[] = []
    source.subscribe(post => received.push(post))
    await source.start() // e.g. the feed's pill
    await source.start() // e.g. a thread view

    setTokens({ token: 'identity-B' })
    await connection.stop()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.mode).toBe('realtime')
    expect(fakes[1]?.startedWithToken).toBe('identity-B')
    fakes[1]?.emit('PostReceived', pushPayload())
    expect(received.map(post => post.id)).toEqual(['post-push-1'])

    source.stop()
    source.stop()
  })

  it('a source released before the stop starts cleanly for the next holder', async () => {
    const { connection, fakes } = createFakeTransport()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    const source = refCounted(makeRealtimeArrivalSource(feed))
    await source.start()
    source.stop() // the last holder unmounts

    await connection.stop()
    setTokens({ token: 'identity-B' })
    await vi.advanceTimersByTimeAsync(0)
    await source.start() // the next identity's first holder

    expect(source.mode).toBe('realtime')
    expect(fakes[fakes.length - 1]?.startedWithToken).toBe('identity-B')
    expect(fetchFeed).not.toHaveBeenCalled()

    source.stop()
  })
})
