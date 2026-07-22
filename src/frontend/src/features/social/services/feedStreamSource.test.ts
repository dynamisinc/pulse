/**
 * features/social/services/feedStreamSource.test.ts
 * ---------------------------------------------------------------------------
 * Test pass for feeds-discovery/04 "Realtime new-posts pill" (#123) — the
 * `FeedStreamSource` seam itself (AC4, COR-001, XC-002). Does NOT re-cover
 * `realtimeFeed.ts`'s own transport/fallback/dedup suite (see
 * `realtimeFeed.test.ts`); this file only proves:
 *
 *  - `makeRealtimeFeedSource()` is a faithful, argument-preserving passthrough
 *    over the injected feed, and its `mode` tracks the feed's mode LIVE
 *    (including a realtime → polling flip) — the story-04-level proof that
 *    NFR-003 fallback is transparent to this seam;
 *  - `makeMockPostStoreSource()` baselines on `start()` (pre-existing store
 *    posts are never emitted), emits only posts appended AFTER, each narrowed
 *    to a `ParticipantPostView` via the sole sanctioned `toParticipantView`
 *    (XC-002) — including a post carrying `origin: 'inject'` +
 *    `actingHumanId` + `injectId` — re-baselines cleanly across a stop/start
 *    cycle, and reports a constant `'realtime'` mode;
 *  - neither source threads a client `exerciseId`/scope parameter onto the
 *    store/feed it wraps (COR-001, by construction).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ParticipantPostView, Post } from '@/features/social'
import type { PostStreamHandler, RealtimeFeed, FeedTransportMode } from './realtimeFeed'
import { makeMockPostStoreSource, makeRealtimeFeedSource } from './feedStreamSource'

// ---------------------------------------------------------------------------
// makeRealtimeFeedSource — thin passthrough
// ---------------------------------------------------------------------------

class FakeRealtimeFeed implements RealtimeFeed {
  subscribeSpy = vi.fn((_handler: PostStreamHandler) => () => {})
  startSpy = vi.fn(() => Promise.resolve())
  stopSpy = vi.fn()
  mode: FeedTransportMode = 'connecting'

  subscribe(handler: PostStreamHandler): () => void {
    return this.subscribeSpy(handler)
  }

  start(): Promise<void> {
    return this.startSpy()
  }

  stop(): void {
    this.stopSpy()
  }
}

describe('makeRealtimeFeedSource — faithful passthrough over the shared transport (AC4)', () => {
  it('delegates subscribe/start/stop to the injected feed unchanged, with no extra argument', async () => {
    const feed = new FakeRealtimeFeed()
    const source = makeRealtimeFeedSource(feed)

    const handler = vi.fn()
    const unsubscribe = source.subscribe(handler)
    expect(feed.subscribeSpy).toHaveBeenCalledTimes(1)
    // Exactly the handler — no exerciseId/scope argument threaded through.
    expect(feed.subscribeSpy.mock.calls[0]).toEqual([handler])

    await source.start()
    expect(feed.startSpy).toHaveBeenCalledTimes(1)
    expect(feed.startSpy.mock.calls[0]).toEqual([])

    source.stop()
    expect(feed.stopSpy).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('reflects the feed transport mode LIVE, including a realtime → polling fallback flip (NFR-003 transparency)', () => {
    const feed = new FakeRealtimeFeed()
    feed.mode = 'realtime'
    const source = makeRealtimeFeedSource(feed)
    expect(source.mode).toBe('realtime')

    feed.mode = 'polling'
    expect(source.mode).toBe('polling') // a live getter, never snapshotted at construction

    feed.mode = 'realtime'
    expect(source.mode).toBe('realtime') // and recovers back, transparently
  })
})

// ---------------------------------------------------------------------------
// makeMockPostStoreSource — baseline + narrow + isolation
// ---------------------------------------------------------------------------

interface FakeStore {
  getPosts: () => Post[]
  appendPost: (post: Post) => void
  subscribe: (listener: () => void) => () => void
  resetForTests: () => void
}

function makeFakeStore(initial: Post[]): FakeStore {
  let posts = initial
  const listeners = new Set<() => void>()
  return {
    getPosts: () => posts,
    appendPost: post => {
      posts = [...posts, post]
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    resetForTests: () => {
      posts = initial
      listeners.clear()
    },
  }
}

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-x',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-simcell-utility',
    text: 'a store-backed post',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T15:00:00Z',
    origin: 'participant',
    ...overrides,
  }
}

describe('makeMockPostStoreSource — baselines on start(), emits only appended-after (AC4)', () => {
  it('does NOT emit posts already in the store at start() (baseline, no re-emit)', async () => {
    const store = makeFakeStore([buildPost({ id: 'existing-1' })])
    const source = makeMockPostStoreSource(store)
    const received: ParticipantPostView[] = []
    source.subscribe(v => received.push(v))

    await source.start()

    expect(received).toEqual([])
  })

  it('emits a post appended AFTER start(), narrowed to a ParticipantPostView (XC-002)', async () => {
    const store = makeFakeStore([])
    const source = makeMockPostStoreSource(store)
    const received: ParticipantPostView[] = []
    source.subscribe(v => received.push(v))
    await source.start()

    store.appendPost(buildPost({ id: 'new-1', text: 'hello there' }))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      id: 'new-1',
      authorPersonaId: 'persona-fairhavenwater',
      text: 'hello there',
      counts: { reply: 0, repost: 0, like: 0 },
      scenarioTime: '2033-09-04T15:00:00Z',
    })
  })

  it('narrows a Post carrying origin "inject" + injectId + actingHumanId before it is buffered (XC-002)', async () => {
    const store = makeFakeStore([])
    const source = makeMockPostStoreSource(store)
    const received: ParticipantPostView[] = []
    source.subscribe(v => received.push(v))
    await source.start()

    store.appendPost(buildPost({
      id: 'inject-1',
      origin: 'inject',
      injectId: 'INJ-099',
      actingHumanId: 'human-simcell-rumor',
    }))

    expect(received).toHaveLength(1)
    const loaded = received[0] as unknown as Record<string, unknown>
    expect(Object.keys(loaded).sort()).toEqual(
      ['authorPersonaId', 'counts', 'id', 'scenarioTime', 'text'].sort(),
    )
    for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId']) {
      expect(Object.prototype.hasOwnProperty.call(loaded, key)).toBe(false)
    }
  })

  it('re-baselines cleanly on a stop → start cycle — no stale id carried over, no duplicate emit', async () => {
    const store = makeFakeStore([])
    const source = makeMockPostStoreSource(store)
    const received: ParticipantPostView[] = []
    source.subscribe(v => received.push(v))
    await source.start()

    store.appendPost(buildPost({ id: 'p1' }))
    expect(received.map(v => v.id)).toEqual(['p1'])

    source.stop()
    // Restart re-baselines against the store's THEN-current snapshot (which
    // already includes p1) — p1 must not re-emit this cycle.
    await source.start()
    store.appendPost(buildPost({ id: 'p2' }))

    expect(received.map(v => v.id)).toEqual(['p1', 'p2'])
  })

  it('reports a constant "realtime" mode — an in-tab push store, not a degraded poll', () => {
    const store = makeFakeStore([])
    const source = makeMockPostStoreSource(store)
    expect(source.mode).toBe('realtime')
  })
})

describe('makeMockPostStoreSource — introduces no client exerciseId (COR-001, isolation intent)', () => {
  it('reads/subscribes the store with NO scope/exerciseId argument — isolation stays server/store-side', async () => {
    const store = makeFakeStore([])
    const getPostsSpy = vi.spyOn(store, 'getPosts')
    const subscribeSpy = vi.spyOn(store, 'subscribe')
    const source = makeMockPostStoreSource(store)

    await source.start()

    // The baseline read and the change subscription take no filter/exerciseId
    // argument — the store itself is already exercise-scoped by construction;
    // this seam adds no NEW scope parameter on top of it.
    expect(getPostsSpy.mock.calls.every(args => args.length === 0)).toBe(true)
    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(subscribeSpy.mock.calls[0]).toHaveLength(1)
  })
})
