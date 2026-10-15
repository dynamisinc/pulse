/**
 * features/social/services/realtimeFeed.sessionReset.test.ts
 * ---------------------------------------------------------------------------
 * The APP-WIDE `realtimeFeed` is registered with `core/auth/sessionReset`, so
 * `resetClientSession()` (sign-out and every sign-in) makes it forget the previous identity
 * (COR-001; Gate-1 H-1). Its `seenIds`, `baselined`, `pollInFlight` and any `GET /feed` still on
 * the wire all belong to ONE identity; they used to outlive `stop()` and the reset, so:
 *  - A's late answer could be delivered into B's "new posts" stream (the shared api client has no
 *    request timeout, so "late" can be long);
 *  - A's in-flight flag blocked B's polls until A's answer landed;
 *  - B's first degraded poll emitted B's whole page as "new" (a spurious pill).
 *
 * This file pins the REGISTRATION, end to end through `runSessionResets()` - the behaviour of
 * `resetForSession()` itself is in `realtimeFeed.identitySwitch.test.ts`. The hub is mocked as
 * unreachable so the feed polls, and `GET /feed` is answered by the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSessionResets } from '@/core/auth/sessionReset'
import type { RealtimeConnection } from '@/core/realtime/connection'
import type { ParticipantPostView, Post } from '@/features/social'
import { realtimeFeed } from './realtimeFeed'

const resolveFeedMock = vi.fn<() => Promise<Post[]>>()

vi.mock('./feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('./feedService')>()
  return { ...actual, resolveFeed: () => resolveFeedMock() }
})

vi.mock('@/core/realtime/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/realtime/connection')>()
  const unreachableHub: RealtimeConnection = {
    state: actual.HubConnectionState.Disconnected,
    subscribe: () => () => {},
    onStateChange: () => () => {},
    start: () => Promise.reject(new Error('hub down')),
    stop: () => Promise.resolve(),
  }
  return { ...actual, realtimeConnection: unreachableHub }
})

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

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

let gets: Array<ReturnType<typeof deferred<Post[]>>>

beforeEach(() => {
  vi.useFakeTimers()
  gets = []
  resolveFeedMock.mockReset()
  resolveFeedMock.mockImplementation(() => {
    const get = deferred<Post[]>()
    gets.push(get)
    return get.promise
  })
})

afterEach(() => {
  realtimeFeed.stop()
  // The singleton outlives each test: clear its poll state (an unresolved GET leaves
  // `pollInFlight` set) so the next test starts from a clean feed, not this one's leftovers.
  runSessionResets()
  vi.useRealTimers()
})

describe('runSessionResets() resets the app-wide realtimeFeed', () => {
  it('B receives nothing from A\'s late GET /feed, and B\'s own poll is not blocked behind it', async () => {
    await realtimeFeed.start() // A's feed: the hub is down, so it polls
    await vi.advanceTimersByTimeAsync(0)
    gets[0]?.resolve([]) // A's first poll baselines
    await vi.advanceTimersByTimeAsync(5000) // the next poll goes out and never comes back (yet)
    expect(resolveFeedMock).toHaveBeenCalledTimes(2)

    // A signs out, B signs in: the screens unmount, the session resets, B's feed mounts.
    realtimeFeed.stop()
    runSessionResets()
    const received: ParticipantPostView[] = []
    const unsubscribe = realtimeFeed.subscribe(post => received.push(post))
    await realtimeFeed.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(resolveFeedMock).toHaveBeenCalledTimes(3) // B polled at once
    gets[1]?.resolve([polledPost('post-of-exercise-A')]) // A's answer finally lands
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toEqual([])
    unsubscribe()
  })

  it('B\'s first degraded poll baselines silently (no spurious "N new posts")', async () => {
    await realtimeFeed.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolveFeedMock).toHaveBeenCalledTimes(1) // a clean singleton polls at once
    gets[0]?.resolve([polledPost('post-a1')]) // A's feed is baselined
    await vi.advanceTimersByTimeAsync(0)
    realtimeFeed.stop() // A's screens unmount

    runSessionResets()
    const received: ParticipantPostView[] = []
    const unsubscribe = realtimeFeed.subscribe(post => received.push(post))
    await realtimeFeed.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolveFeedMock).toHaveBeenCalledTimes(2) // A's baseline, then B's first poll
    gets[1]?.resolve([polledPost('post-b1'), polledPost('post-b2')])
    await vi.advanceTimersByTimeAsync(0)

    expect(received).toEqual([])
    unsubscribe()
  })
})
