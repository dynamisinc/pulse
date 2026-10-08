/**
 * features/social/explore/exploreFeedStore.test.ts
 * ---------------------------------------------------------------------------
 * The shared Explore baseline (demo-polish F6, fold of Gate-1 M1/M3), driven with a
 * fake arrival source and a controllable feed read:
 *  - ONE feed read and ONE source start for any number of consumers; the last
 *    consumer leaving stops the source and drops the data (deferred a microtask so a
 *    same-commit unmount + mount keeps it alive);
 *  - arrivals after the read are folded in, batched, deduped by id (also against the
 *    read), and bounded to the newest 200;
 *  - a different scope never sees the previous one's data; a failed read is reported
 *    and retried; a result that lands after teardown is ignored.
 * Fake timers drive the batching and the retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParticipantPostView, Post } from '@/features/social'
import type { FeedStreamHandler, FeedStreamSource } from '../services/feedStreamSource'
import {
  EXPLORE_ARRIVAL_BATCH_MS,
  EXPLORE_FEED_CAP,
  EXPLORE_RETRY_MS,
  createExploreFeedStore,
  type ExploreFeedStore,
} from './exploreFeedStore'

const SCOPE = 'ex-1|acct-1'

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
  starts = 0
  stops = 0
  readonly mode = 'realtime' as const
  subscribe(handler: FeedStreamHandler) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }
  start() {
    this.starts += 1
    return Promise.resolve()
  }
  stop() {
    this.stops += 1
  }
  emit(arrival: ParticipantPostView) {
    for (const handler of [...this.handlers]) handler(arrival)
  }
}

interface Deferred {
  readonly promise: Promise<Post[]>
  resolve(posts: Post[]): void
  reject(error: unknown): void
}

function deferred(): Deferred {
  let resolve!: (posts: Post[]) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Post[]>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let source: FakeSource
let reads: Deferred[]
let store: ExploreFeedStore

function build(): ExploreFeedStore {
  return createExploreFeedStore({
    source,
    fetchFeed: () => {
      const next = deferred()
      reads.push(next)
      return next.promise
    },
  })
}

/** Lets promise callbacks and queued microtasks run (timers stay faked). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function ids(): string[] {
  return store.getSnapshot(SCOPE).posts.map(p => p.id)
}

beforeEach(() => {
  vi.useFakeTimers()
  source = new FakeSource()
  reads = []
  store = build()
})

afterEach(() => {
  store.reset()
  vi.useRealTimers()
})

describe('exploreFeedStore — one read, one connection, ref-counted', () => {
  it('starts the read and the source once for any number of consumers', async () => {
    const release = [
      store.subscribe(SCOPE, () => {}),
      store.subscribe(SCOPE, () => {}),
      store.subscribe(SCOPE, () => {}),
    ]
    expect(reads).toHaveLength(1)
    expect(source.starts).toBe(1)
    expect(source.handlers.size).toBe(1)
    expect(store.getSnapshot(SCOPE).status).toBe('loading')

    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    expect(store.getSnapshot(SCOPE).status).toBe('ready')
    expect(ids()).toEqual(['a'])
    expect(reads).toHaveLength(1)
    release.forEach(r => r())
  })

  it('stops the source and drops the data when the LAST consumer leaves', async () => {
    const first = store.subscribe(SCOPE, () => {})
    const second = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()

    first()
    await settle()
    expect(source.stops).toBe(0)
    expect(ids()).toEqual(['a'])

    second()
    await settle()
    expect(source.stops).toBe(1)
    expect(source.handlers.size).toBe(0)
    expect(store.getSnapshot(SCOPE).status).toBe('idle')
    expect(ids()).toEqual([])
  })

  it('keeps the baseline alive across a same-commit unmount + mount (no restart)', async () => {
    const outgoing = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()

    outgoing() // the rail's consumer leaves...
    const incoming = store.subscribe(SCOPE, () => {}) // ...the page's arrives, same tick
    await settle()

    expect(reads).toHaveLength(1)
    expect(source.starts).toBe(1)
    expect(source.stops).toBe(0)
    expect(store.getSnapshot(SCOPE).status).toBe('ready')
    expect(ids()).toEqual(['a'])
    incoming()
  })

  it('restarts cleanly after a full teardown', async () => {
    store.subscribe(SCOPE, () => {})()
    await settle()
    expect(source.stops).toBe(1)

    const again = store.subscribe(SCOPE, () => {})
    expect(reads).toHaveLength(2)
    expect(source.starts).toBe(2)
    again()
  })

  it('ignores a double release', async () => {
    const keep = store.subscribe(SCOPE, () => {})
    const release = store.subscribe(SCOPE, () => {})
    release()
    release()
    await settle()
    expect(source.stops).toBe(0)
    keep()
  })

  it('tells listeners when the snapshot changes', async () => {
    const listener = vi.fn()
    const release = store.subscribe(SCOPE, listener)
    const afterStart = listener.mock.calls.length
    expect(afterStart).toBeGreaterThan(0) // the loading snapshot
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    expect(listener.mock.calls.length).toBeGreaterThan(afterStart)
    release()
  })
})

describe('exploreFeedStore — arrivals', () => {
  it('folds an arrival in after the read, batched', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('old', '2033-09-04T10:00:00Z')])
    await settle()
    const before = store.getSnapshot(SCOPE).posts

    source.emit(view('new1', '2033-09-04T11:00:00Z'))
    source.emit(view('new2', '2033-09-04T11:05:00Z'))
    // Not yet: arrivals are collected for one batch window.
    expect(store.getSnapshot(SCOPE).posts).toBe(before)

    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)
    expect(ids()).toEqual(['new2', 'new1', 'old'])
    expect(store.getSnapshot(SCOPE).posts).not.toBe(before)
    release()
  })

  it('publishes one snapshot per batch, not one per arrival (burst)', async () => {
    const listener = vi.fn()
    const release = store.subscribe(SCOPE, listener)
    reads[0]?.resolve([])
    await settle()
    listener.mockClear()

    for (let index = 0; index < 120; index += 1) {
      source.emit(view(`burst-${index}`, '2033-09-04T12:00:00Z'))
    }
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot(SCOPE).posts).toHaveLength(120)
    release()
  })

  it('keeps the snapshot array identity between batches', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    const first = store.getSnapshot(SCOPE)
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS * 4)
    expect(store.getSnapshot(SCOPE)).toBe(first)
    release()
  })

  it('collects arrivals that land while the read is in flight, deduped against it', async () => {
    const release = store.subscribe(SCOPE, () => {})
    source.emit(view('early', '2033-09-04T11:00:00Z')) // before the read resolves
    source.emit(view('both', '2033-09-04T10:30:00Z')) // ...and also in the read
    reads[0]?.resolve([
      post('both', '2033-09-04T10:30:00Z'),
      post('old', '2033-09-04T10:00:00Z'),
    ])
    await settle()

    expect(ids()).toEqual(['early', 'both', 'old'])
    release()
  })

  it('dedupes a re-delivered arrival by id', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([])
    await settle()
    source.emit(view('dup', '2033-09-04T11:00:00Z'))
    source.emit(view('dup', '2033-09-04T11:00:00Z'))
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)
    expect(ids()).toEqual(['dup'])
    release()
  })

  it('keeps only the newest 200 by scenario time', async () => {
    const release = store.subscribe(SCOPE, () => {})
    const initial: Post[] = []
    for (let index = 0; index < EXPLORE_FEED_CAP; index += 1) {
      const minute = String(index % 60).padStart(2, '0')
      const hour = String(Math.floor(index / 60)).padStart(2, '0')
      initial.push(post(`base-${index}`, `2033-09-04T${hour}:${minute}:00Z`))
    }
    reads[0]?.resolve(initial)
    await settle()
    expect(ids()).toHaveLength(EXPLORE_FEED_CAP)

    source.emit(view('newest', '2033-09-04T23:00:00Z'))
    source.emit(view('older-than-all', '2033-09-03T00:00:00Z'))
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)

    const after = ids()
    expect(after).toHaveLength(EXPLORE_FEED_CAP)
    expect(after[0]).toBe('newest')
    expect(after).not.toContain('older-than-all')
    expect(after).not.toContain('base-0') // the oldest of the original 200 fell off
    release()
  })

  it('orders ties by id so the order is total', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('b', '2033-09-04T10:00:00Z'), post('a', '2033-09-04T10:00:00Z')])
    await settle()
    expect(ids()).toEqual(['a', 'b'])
    release()
  })

  it('narrows the read through the participant view (no provenance)', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    const [first] = store.getSnapshot(SCOPE).posts
    expect(first).toBeDefined()
    expect(first).not.toHaveProperty('origin')
    expect(first).not.toHaveProperty('actingHumanId')
    expect(first).not.toHaveProperty('exerciseId')
    release()
  })
})

describe('exploreFeedStore — scope, failure, staleness', () => {
  it('serves nothing to a different scope and drops the old data on a scope change', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    expect(store.getSnapshot('ex-2|acct-9').posts).toEqual([])
    expect(store.getSnapshot('ex-2|acct-9').status).toBe('idle')

    const other = store.subscribe('ex-2|acct-9', () => {})
    expect(reads).toHaveLength(2)
    expect(store.getSnapshot(SCOPE).status).toBe('idle') // the old scope is gone
    reads[1]?.resolve([post('b', '2033-09-04T11:00:00Z')])
    await settle()
    expect(store.getSnapshot('ex-2|acct-9').posts.map(p => p.id)).toEqual(['b'])
    release()
    other()
  })

  it('reports a failed read, serves no posts as if empty, and retries', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.reject(new Error('boom'))
    await settle()
    expect(store.getSnapshot(SCOPE).status).toBe('error')
    expect(store.getSnapshot(SCOPE).error).toBeInstanceOf(Error)

    await vi.advanceTimersByTimeAsync(EXPLORE_RETRY_MS)
    expect(reads).toHaveLength(2)
    reads[1]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    expect(store.getSnapshot(SCOPE).status).toBe('ready')
    expect(store.getSnapshot(SCOPE).error).toBeUndefined()
    expect(ids()).toEqual(['a'])
    release()
  })

  it('stops retrying once nobody is consuming', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.reject(new Error('boom'))
    await settle()
    release()
    await vi.advanceTimersByTimeAsync(EXPLORE_RETRY_MS * 3)
    expect(reads).toHaveLength(1)
  })

  it('ignores a read that lands after teardown', async () => {
    const release = store.subscribe(SCOPE, () => {})
    release()
    await settle()
    reads[0]?.resolve([post('late', '2033-09-04T10:00:00Z')])
    await settle()
    expect(store.getSnapshot(SCOPE).posts).toEqual([])

    const again = store.subscribe(SCOPE, () => {})
    reads[1]?.resolve([post('fresh', '2033-09-04T11:00:00Z')])
    await settle()
    expect(ids()).toEqual(['fresh'])
    again()
  })

  it('ignores arrivals once torn down', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([])
    await settle()
    release()
    await settle()
    source.emit(view('ghost', '2033-09-04T11:00:00Z'))
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS)
    expect(store.getSnapshot(SCOPE).posts).toEqual([])
  })

  it('a swallowed source start failure does not break the baseline', async () => {
    const failing = createExploreFeedStore({
      source: {
        subscribe: handler => source.subscribe(handler),
        start: () => Promise.reject(new Error('no transport')),
        stop: () => {},
        mode: 'polling',
      },
      fetchFeed: () => Promise.resolve([post('a', '2033-09-04T10:00:00Z')]),
    })
    const release = failing.subscribe(SCOPE, () => {})
    await settle()
    expect(failing.getSnapshot(SCOPE).status).toBe('ready')
    release()
    failing.reset()
  })

  it('reset() drops everything and leaves old releases harmless', async () => {
    const release = store.subscribe(SCOPE, () => {})
    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    store.reset()
    expect(store.getSnapshot(SCOPE).status).toBe('idle')
    expect(source.stops).toBe(1)

    const fresh = store.subscribe(SCOPE, () => {})
    release() // a stale release from before the reset
    await settle()
    expect(source.stops).toBe(1) // the new consumer was not disturbed
    fresh()
  })
})

describe('exploreFeedStore — an observer / read-only consumer never opens the transport (D1-011)', () => {
  it('with { stream: false } it does the one baseline read and nothing to the source', async () => {
    const release = store.subscribe(SCOPE, () => {}, { stream: false })
    expect(reads).toHaveLength(1)
    expect(source.starts).toBe(0)
    expect(source.handlers.size).toBe(0)

    reads[0]?.resolve([post('a', '2033-09-04T10:00:00Z')])
    await settle()
    expect(store.getSnapshot(SCOPE).status).toBe('ready')
    expect(ids()).toEqual(['a'])

    // Nothing is listening, so an arrival cannot reach the baseline; it stays as read.
    source.emit(view('b', '2033-09-04T11:00:00Z'))
    await vi.advanceTimersByTimeAsync(EXPLORE_ARRIVAL_BATCH_MS * 2)
    expect(ids()).toEqual(['a'])

    // Leaving releases NOTHING it did not take: `stop()` is the shared transport's
    // ref-count release, so calling it would drop another consumer's hold.
    release()
    await settle()
    expect(source.stops).toBe(0)
    expect(store.getSnapshot(SCOPE).status).toBe('idle')
  })

  it('still retries a failed baseline read without ever touching the source', async () => {
    const release = store.subscribe(SCOPE, () => {}, { stream: false })
    reads[0]?.reject(new Error('down'))
    await settle()
    expect(store.getSnapshot(SCOPE).status).toBe('error')

    await vi.advanceTimersByTimeAsync(EXPLORE_RETRY_MS)
    expect(reads).toHaveLength(2)
    expect(source.starts).toBe(0)
    release()
  })

  it('streams by default (the option is opt-out), and a full consumer still starts it', () => {
    const release = store.subscribe(SCOPE, () => {})
    expect(source.starts).toBe(1)
    expect(source.handlers.size).toBe(1)
    release()
  })
})
