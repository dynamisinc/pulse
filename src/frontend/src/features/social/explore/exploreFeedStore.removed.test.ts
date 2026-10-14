/**
 * features/social/explore/exploreFeedStore.removed.test.ts
 * ---------------------------------------------------------------------------
 * TAKEDOWN in the shared Explore baseline (demo-polish C5 resolving F6's `TODO(C5)`; CTL-025,
 * XC-002): while the store runs it listens to the session's removed-post ids, so a taken-down
 * post leaves trending and search without a reload -
 *  - an id recorded AFTER the baseline landed is dropped and published at once (not batched), and
 *    the published snapshot is a NEW array (consumers' memoized computations recompute) while an
 *    id the store does not hold wakes nobody;
 *  - it is dropped from trending: its hashtag stops counting (`computeTrending` over the snapshot);
 *  - an id recorded BEFORE the baseline read lands, or before an arrival is offered, is never
 *    admitted at all (the removal can beat the read);
 *  - a removal that lands while the read is still in flight is applied when it settles;
 *  - the listener lives and dies with the run: a torn-down store ignores later removals and
 *    leaves nothing subscribed; an observer / read-only consumer (no stream) still hears them;
 *  - a different scope restarts clean and re-subscribes exactly once (no listener leak).
 * Fake timers drive the batching.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ParticipantPostView, Post } from '@/features/social'
import type { FeedStreamHandler, FeedStreamSource } from '../services/feedStreamSource'
import {
  EXPLORE_ARRIVAL_BATCH_MS,
  createExploreFeedStore,
  type ExploreFeedStore,
  type RemovedPostsSource,
} from './exploreFeedStore'
import { removedPosts } from '../services/removedPosts'
import { computeTrending } from './trending'

const SCOPE = 'ex-1|acct-1'
const NOW = new Date('2033-09-04T15:00:00Z')

function post(id: string, at: string, text = `post ${id}`): Post {
  return {
    id,
    exerciseId: 'ex-1',
    authorPersonaId: 'persona-a',
    actingHumanId: 'human-x',
    text,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: at,
    origin: 'participant',
  }
}

function view(id: string, at: string, text = `post ${id}`): ParticipantPostView {
  return {
    id,
    authorPersonaId: 'persona-a',
    text,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: at,
  }
}

class FakeSource implements FeedStreamSource {
  readonly handlers = new Set<FeedStreamHandler>()
  readonly mode = 'realtime' as const
  subscribe(handler: FeedStreamHandler) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }
  start() {
    return Promise.resolve()
  }
  stop() {}
  emit(arrival: ParticipantPostView) {
    for (const handler of [...this.handlers]) handler(arrival)
  }
}

/** A controllable removed-id source with the two members the store reads. */
class FakeRemoved implements RemovedPostsSource {
  readonly ids = new Set<string>()
  readonly listeners = new Set<() => void>()
  has(postId: string): boolean {
    return this.ids.has(postId)
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  remove(postId: string): void {
    this.ids.add(postId)
    for (const listener of [...this.listeners]) listener()
  }
}

let source: FakeSource
let removed: FakeRemoved
let store: ExploreFeedStore
let feed: Post[]
let releases: (() => void)[]

function build(fetchFeed?: () => Promise<Post[]>): ExploreFeedStore {
  return createExploreFeedStore({
    source,
    removed,
    fetchFeed: fetchFeed ?? (() => Promise.resolve(feed)),
  })
}

function acquire(options?: { stream?: boolean }, scope = SCOPE): { listener: Mock } {
  const listener = vi.fn()
  releases.push(store.subscribe(scope, listener, options))
  return { listener }
}

function ids(scope = SCOPE): string[] {
  return store.getSnapshot(scope).posts.map(p => p.id)
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  source = new FakeSource()
  removed = new FakeRemoved()
  releases = []
  feed = [
    post('keep-1', '2033-09-04T14:00:00Z', 'Boil notice #WaterIssues'),
    post('gone-1', '2033-09-04T14:10:00Z', 'Awful rumor #Rumor #WaterIssues'),
    post('keep-2', '2033-09-04T14:20:00Z', 'Lines at the depot #Depot'),
  ]
  store = build()
})

afterEach(async () => {
  for (const release of releases) release()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers()
})

describe('exploreFeedStore - a post taken down after the baseline landed', () => {
  it('is dropped and published at once (not waiting for the arrival batch)', async () => {
    const { listener } = acquire()
    await settle()
    expect(ids()).toEqual(['keep-2', 'gone-1', 'keep-1'])
    listener.mockClear()

    removed.remove('gone-1')

    expect(ids()).toEqual(['keep-2', 'keep-1'])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('publishes a NEW posts array (memoized consumers recompute) and keeps the status ready', async () => {
    acquire()
    await settle()
    const before = store.getSnapshot(SCOPE)

    removed.remove('gone-1')

    const after = store.getSnapshot(SCOPE)
    expect(after.posts).not.toBe(before.posts)
    expect(after.status).toBe('ready')
  })

  it('stops counting the post toward trending: its hashtag loses a post and a tag only it carried disappears', async () => {
    acquire()
    await settle()
    const trending = (snapshotPosts: readonly ParticipantPostView[]) => computeTrending(
      snapshotPosts,
      { now: NOW, futureToleranceMs: Infinity },
    )
    const before = trending(store.getSnapshot(SCOPE).posts)
    expect(before.find(topic => topic.tag === 'waterissues')?.postCount).toBe(2)
    expect(before.some(topic => topic.tag === 'rumor')).toBe(true)

    removed.remove('gone-1')

    const after = trending(store.getSnapshot(SCOPE).posts)
    expect(after.find(topic => topic.tag === 'waterissues')?.postCount).toBe(1)
    expect(after.some(topic => topic.tag === 'rumor')).toBe(false)
  })

  it('wakes nobody for an id it is not holding', async () => {
    const { listener } = acquire()
    await settle()
    listener.mockClear()
    const before = store.getSnapshot(SCOPE)

    removed.remove('never-held')

    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot(SCOPE)).toBe(before)
  })

  it('drops an ARRIVAL that was folded in, too (published immediately, ahead of its own batch)', async () => {
    acquire()
    await settle()
    source.emit(view('live-1', '2033-09-04T14:30:00Z', 'fresh #Live'))
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)
    expect(ids()).toContain('live-1')

    removed.remove('live-1')

    expect(ids()).not.toContain('live-1')
  })

  it('drops an arrival that is still waiting in the batch, without publishing early', async () => {
    acquire()
    await settle()
    source.emit(view('live-2', '2033-09-04T14:30:00Z'))
    removed.remove('live-2')
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)

    expect(ids()).not.toContain('live-2')
  })
})

describe('exploreFeedStore - a post removed BEFORE it could be admitted', () => {
  it('never admits an arrival whose id is already removed', async () => {
    acquire()
    await settle()
    removed.ids.add('late-echo')

    source.emit(view('late-echo', '2033-09-04T14:40:00Z'))
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)

    expect(ids()).not.toContain('late-echo')
  })

  it('never admits a baseline post whose id is already removed', async () => {
    removed.ids.add('gone-1')
    acquire()
    await settle()

    expect(ids()).toEqual(['keep-2', 'keep-1'])
  })

  it('applies a removal that lands while the baseline read is still in flight', async () => {
    let resolve!: (posts: Post[]) => void
    store = build(() => new Promise<Post[]>(res => {
      resolve = res
    }))
    acquire()
    removed.remove('gone-1')
    resolve(feed)
    await settle()

    expect(ids()).toEqual(['keep-2', 'keep-1'])
    expect(store.getSnapshot(SCOPE).status).toBe('ready')
  })
})

describe('exploreFeedStore - the removal listener follows the run', () => {
  it('is subscribed while a consumer holds the store and released with the last one', async () => {
    expect(removed.listeners.size).toBe(0)
    acquire()
    acquire()
    await settle()
    expect(removed.listeners.size).toBe(1)

    for (const release of releases) release()
    await settle()

    expect(removed.listeners.size).toBe(0)
  })

  it('ignores a removal after teardown (nothing held, nothing woken)', async () => {
    const { listener } = acquire()
    await settle()
    for (const release of releases) release()
    await settle()
    listener.mockClear()

    removed.remove('gone-1')

    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot(SCOPE).posts).toEqual([])
  })

  it('an observer / read-only consumer (no stream) still hears a removal', async () => {
    acquire({ stream: false })
    await settle()
    expect(source.handlers.size).toBe(0)
    expect(ids()).toContain('gone-1')

    removed.remove('gone-1')

    expect(ids()).not.toContain('gone-1')
  })

  it('a different scope restarts clean and holds exactly one removal listener (no leak)', async () => {
    acquire()
    await settle()
    acquire(undefined, 'ex-2|acct-9')
    await settle()

    expect(removed.listeners.size).toBe(1)
    expect(store.getSnapshot(SCOPE).posts).toEqual([])
  })

  it('reset() releases the listener', async () => {
    acquire()
    await settle()

    store.reset()

    expect(removed.listeners.size).toBe(0)
  })
})

describe('exploreFeedStore - the default wiring is the session\'s removedPosts store', () => {
  afterEach(() => {
    removedPosts.resetForTests()
  })

  it('drops a post recorded by a PostRemoved push / the mock takedown, with no injection', async () => {
    const wired = createExploreFeedStore({ source, fetchFeed: () => Promise.resolve(feed) })
    releases.push(wired.subscribe(SCOPE, vi.fn()))
    await settle()
    expect(wired.getSnapshot(SCOPE).posts.map(p => p.id)).toContain('gone-1')

    removedPosts.add('gone-1')

    expect(wired.getSnapshot(SCOPE).posts.map(p => p.id)).not.toContain('gone-1')
  })
})
