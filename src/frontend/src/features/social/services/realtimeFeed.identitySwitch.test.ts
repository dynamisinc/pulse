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
 * Gate-1 fold, pinned below:
 *  - H-1: the feed's own identity-scoped state (`seenIds`, `baselined`, `pollInFlight`, a
 *    `fetchFeed()` in flight) is forgotten by `resetForSession()`; a late answer for the previous
 *    identity is dropped, the next identity's polls are not blocked, and its first degraded poll
 *    baselines silently instead of raising a spurious "N new posts" pill;
 *  - M-1: a start that `stop()` overtook may reject LATE, after the re-attach has connected; that
 *    must not leave the feed in polling mode on a live connection;
 *  - L-1: no re-attach (and so no empty-token negotiate) when the stop was a sign-out.
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
import type { FakeHubConnection } from '@/test/fakeHubConnection'
import { createRealtimeFeed } from './realtimeFeed'
import { makeRealtimeArrivalSource, refCounted } from './feedStreamSource'

/** A promise whose settlement the test controls - for answers that land LATE. */
function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** A feed row as the polling fallback returns it (`GET /feed`). */
function polledPost(id: string): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-a',
    actingHumanId: 'human-a',
    text: `polled ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T13:00:00Z',
    origin: 'participant',
  }
}

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

describe('H-1: the feed forgets the previous identity when the session ends', () => {
  /** A feed whose hub is unreachable, so it polls - with every `GET /feed` answered by the test. */
  function degradedFeed() {
    const { connection } = createFakeTransport(fake => {
      fake.startImpl = () => Promise.reject(new Error('hub down'))
    })
    const gets: Array<ReturnType<typeof deferred<Post[]>>> = []
    const fetchFeed = vi.fn<() => Promise<Post[]>>(() => {
      const get = deferred<Post[]>()
      gets.push(get)
      return get.promise
    })
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    return { feed, fetchFeed, gets }
  }

  it('drops A\'s late GET /feed answer, and B\'s own polls are not blocked behind it', async () => {
    const { feed, fetchFeed, gets } = degradedFeed()
    await feed.start() // A's feed, degraded: polls
    await vi.advanceTimersByTimeAsync(0)
    gets[0]?.resolve([]) // A's first poll baselines
    await vi.advanceTimersByTimeAsync(1000) // the next poll goes out on A's token...
    expect(fetchFeed).toHaveBeenCalledTimes(2) // ...and is still on the wire (no request timeout)

    // A signs out, B signs in, B's feed mounts.
    feed.stop()
    feed.resetForSession()
    setTokens({ token: 'identity-B' })
    const received: ParticipantPostView[] = []
    feed.subscribe(post => received.push(post))
    await feed.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchFeed).toHaveBeenCalledTimes(3) // B polled at once instead of waiting on A's answer
    gets[1]?.resolve([polledPost('post-of-exercise-A')]) // A's answer finally lands
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toEqual([]) // nothing from A's exercise reaches B

    gets[2]?.resolve([polledPost('post-b1')]) // B's own answer is its baseline
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toEqual([])
    feed.stop()
  })

  it('B\'s first degraded poll baselines silently: no spurious "N new posts" for B\'s whole page', async () => {
    const { feed, gets } = degradedFeed()
    await feed.start()
    await vi.advanceTimersByTimeAsync(0)
    gets[0]?.resolve([polledPost('post-a1')]) // A's feed baselined (baselined = true, seenIds = a1)
    await vi.advanceTimersByTimeAsync(0)
    feed.stop() // A's screens unmount on sign-out

    feed.resetForSession()
    setTokens({ token: 'identity-B' })
    const received: ParticipantPostView[] = []
    feed.subscribe(post => received.push(post))
    await feed.start() // B's feed mounts, hub still degraded
    await vi.advanceTimersByTimeAsync(0)
    gets[1]?.resolve([polledPost('post-b1'), polledPost('post-b2')])
    await vi.advanceTimersByTimeAsync(0)

    expect(received).toEqual([]) // B's page is the baseline, not news

    // The stream still works afterwards: a genuinely new post is delivered.
    await vi.advanceTimersByTimeAsync(1000)
    gets[2]?.resolve([polledPost('post-b1'), polledPost('post-b2'), polledPost('post-b3')])
    await vi.advanceTimersByTimeAsync(0)
    expect(received.map(post => post.id)).toEqual(['post-b3'])
    feed.stop()
  })

  it('also covers a feed that is still started: the next poll re-baselines on the new identity', async () => {
    const { feed, gets } = degradedFeed()
    const received: ParticipantPostView[] = []
    feed.subscribe(post => received.push(post))
    await feed.start()
    await vi.advanceTimersByTimeAsync(0)
    gets[0]?.resolve([polledPost('post-a1')])
    await vi.advanceTimersByTimeAsync(0)

    feed.resetForSession() // identity switched under a still-mounted feed
    await vi.advanceTimersByTimeAsync(1000)
    gets[1]?.resolve([polledPost('post-b1')])
    await vi.advanceTimersByTimeAsync(0)

    expect(received).toEqual([])
    feed.stop()
  })
})

describe('M-1: a start that stop() overtook settles LATE', () => {
  it('does not leave the feed polling on a live connection when the old start rejects after the re-attach', async () => {
    let oldStart!: ReturnType<FakeHubConnection['holdStart']>
    const { connection, fakes } = createFakeTransport((fake, index) => {
      if (index === 0) oldStart = fake.holdStart() // the first negotiate is on the wire
    })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    const starting = feed.start()

    setTokens({ token: 'identity-B' })
    void connection.stop() // overtakes the start; the old negotiate has not returned yet
    await vi.advanceTimersByTimeAsync(0) // 'stopped': the feed re-attaches on identity B
    expect(fakes[1]?.startedWithToken).toBe('identity-B')
    expect(connection.state).toBe(HubConnectionState.Connected)
    expect(feed.mode).toBe('realtime')

    oldStart.release() // the old negotiate returns: the feed's OWN start() rejects, late
    await starting
    await vi.advanceTimersByTimeAsync(5000)

    expect(feed.mode).toBe('realtime') // not 'polling' on a connected hub
    expect(fetchFeed).not.toHaveBeenCalled() // and no GET /feed storm on top of the pushes
    feed.stop()
  })

  it('the same holds for a re-attach that a second stop overtakes and that then fails late', async () => {
    let firstReattach!: ReturnType<FakeHubConnection['holdStart']>
    const { connection, fakes } = createFakeTransport((fake, index) => {
      if (index === 1) firstReattach = fake.holdStart() // the first re-attach hangs on the wire
    })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    await feed.start()

    setTokens({ token: 'identity-B' })
    await connection.stop()
    await vi.advanceTimersByTimeAsync(0) // re-attach #1: fakes[1], held
    setTokens({ token: 'identity-C' })
    void connection.stop() // overtakes re-attach #1
    await vi.advanceTimersByTimeAsync(0) // re-attach #2: fakes[2] connects on identity C
    expect(fakes[2]?.startedWithToken).toBe('identity-C')
    expect(connection.state).toBe(HubConnectionState.Connected)

    firstReattach.fail() // re-attach #1's start rejects, late
    await vi.advanceTimersByTimeAsync(5000)

    expect(feed.mode).toBe('realtime')
    expect(fetchFeed).not.toHaveBeenCalled()
    feed.stop()
  })
})

describe('M-1 (defence in depth): polling never outlives a live connection or an unmounted feed', () => {
  it('a polling feed whose connection is up again returns to real-time on its next tick', async () => {
    const { connection, fakes } = createFakeTransport(fake => {
      fake.startImpl = () => Promise.reject(new Error('hub down'))
    })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    await feed.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(feed.mode).toBe('polling')

    // Whatever degraded the feed has been overtaken: the connection is up, with no event the
    // feed heard (the poll loop only ever restarts a connection that is Disconnected).
    const live = fakes[0]
    if (live === undefined) throw new Error('no connection was built')
    live.state = HubConnectionState.Connected
    await vi.advanceTimersByTimeAsync(1000)
    const reads = fetchFeed.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)

    expect(feed.mode).toBe('realtime')
    expect(fetchFeed).toHaveBeenCalledTimes(reads) // and the polling has stopped
    feed.stop()
  })

  it('a start that rejects after the feed was stopped does not start a poll timer', async () => {
    let oldStart!: ReturnType<FakeHubConnection['holdStart']>
    const { connection } = createFakeTransport((fake, index) => {
      if (index === 0) oldStart = fake.holdStart()
    })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    const starting = feed.start()
    feed.stop() // the screen unmounts before the hub answered

    oldStart.fail() // the hub answers, late, with a failure
    await starting
    await vi.advanceTimersByTimeAsync(5000)

    expect(fetchFeed).not.toHaveBeenCalled() // nothing polls on behalf of a stopped feed
  })
})

describe('L-1: a sign-out does not re-attach', () => {
  it('does not negotiate an empty-token connection when the stop is a sign-out', async () => {
    const { connection, fakes } = createFakeTransport()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({ connection, fetchFeed, pollIntervalMs: 1000 })
    await feed.start()

    // endSession(): the reset stops the connection, then logout() clears the tokens synchronously;
    // the 'stopped' microtask fires before React has unmounted the feed.
    void connection.stop()
    clearTokens()
    await vi.advanceTimersByTimeAsync(0)

    expect(fakes).toHaveLength(1) // no second connection, so no 401 on /hubs/exercise/negotiate
    expect(fetchFeed).not.toHaveBeenCalled()
    expect(feed.mode).not.toBe('realtime') // honest: there is no live connection
    feed.stop()
  })
})
