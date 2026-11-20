/**
 * features/social/services/realtimeFeed.scopeReset.test.ts
 * ---------------------------------------------------------------------------
 * #856: the APP-WIDE `realtimeFeed` is registered with the exercise-scope reset registry, so a
 * staff exercise switch (session stays signed in) clears its seen-id set, baseline and in-flight
 * poll: exercise B's first degraded poll baselines silently instead of emitting B's page as
 * "new", and exercise A's late `GET /feed` answer is delivered to nobody.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runExerciseScopeResets, runSessionResets } from '@/core/auth/sessionReset'
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

describe('runExerciseScopeResets() resets the app-wide realtimeFeed', () => {
  it('exercise B baselines silently and exercise A late GET /feed reaches nobody', async () => {
    await realtimeFeed.start()
    await vi.advanceTimersByTimeAsync(0)
    gets[0]?.resolve([polledPost('post-a1')]) // A's feed is baselined
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000) // the next poll goes out and never comes back (yet)
    expect(resolveFeedMock).toHaveBeenCalledTimes(2)

    const received: ParticipantPostView[] = []
    const unsubscribe = realtimeFeed.subscribe(post => received.push(post))
    runExerciseScopeResets() // the console switched to exercise B
    gets[1]?.resolve([polledPost('post-of-exercise-A')]) // A's answer finally lands
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toEqual([])

    await vi.advanceTimersByTimeAsync(5000) // B's own poll
    gets[2]?.resolve([polledPost('post-b1'), polledPost('post-b2')])
    await vi.advanceTimersByTimeAsync(0)

    expect(received).toEqual([]) // baselined silently, no spurious "N new posts"
    unsubscribe()
  })
})
