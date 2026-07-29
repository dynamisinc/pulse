/**
 * features/social/hooks/useFeedStream.test.ts
 * ---------------------------------------------------------------------------
 * Test pass for feeds-discovery/04 "Realtime new-posts pill" (#123) — the
 * buffering hook's own contract, isolated from the transport it consumes via
 * an injectable in-memory `FeedStreamSource` fake (no SignalR, no postStore):
 *
 *  - disabled (`enabled: false`) is fully inert — no start, no subscribe,
 *    `newCount` stays 0, `loadBuffered()` returns `[]` (D1-011);
 *  - each arrival only moves `newCount`; `loadBuffered()` drains newest-first
 *    and clears (AC2);
 *  - the bounded ring never exceeds `FEED_STREAM_BUFFER_CAP` under a burst far
 *    past it, and keeps the NEWEST arrivals (evict-oldest) — SOC-071/NFR-002;
 *  - the hook adds no client `exerciseId`/scope parameter anywhere on this
 *    seam — `start()`/`subscribe()` are called with exactly the arguments the
 *    interface defines, nothing more (COR-001, by construction);
 *  - a drained post carries none of the four provenance keys (XC-002, defence
 *    in depth over the type-level guarantee).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ParticipantPostView } from '@/features/social'
import type { FeedStreamHandler, FeedStreamSource, FeedTransportMode } from '../services/feedStreamSource'
import { FEED_STREAM_BUFFER_CAP, useFeedStream } from './useFeedStream'

function buildView(id: string, overrides: Partial<ParticipantPostView> = {}): ParticipantPostView {
  return {
    id,
    authorPersonaId: 'persona-fairhavenwater',
    text: `post ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T15:00:00Z',
    ...overrides,
  }
}

/** A minimal, deterministic `FeedStreamSource` test double — drives arrivals via `push()`. */
class FakeFeedStreamSource implements FeedStreamSource {
  private handler: FeedStreamHandler | null = null
  startCalls = 0
  stopCalls = 0
  mode: FeedTransportMode = 'realtime'

  subscribe(handler: FeedStreamHandler): () => void {
    this.handler = handler
    return () => {
      if (this.handler === handler) this.handler = null
    }
  }

  start(): Promise<void> {
    this.startCalls += 1
    return Promise.resolve()
  }

  stop(): void {
    this.stopCalls += 1
  }

  /** Test helper: deliver an arrival to whoever is currently subscribed. */
  push(post: ParticipantPostView): void {
    this.handler?.(post)
  }
}

describe('useFeedStream — disabled is fully inert (D1-011)', () => {
  it('never starts or subscribes, and keeps newCount at 0 / loadBuffered at []', () => {
    const fake = new FakeFeedStreamSource()
    const subscribeSpy = vi.spyOn(fake, 'subscribe')

    const { result } = renderHook(() => useFeedStream({ enabled: false, source: fake }))

    expect(fake.startCalls).toBe(0)
    expect(subscribeSpy).not.toHaveBeenCalled()
    expect(result.current.newCount).toBe(0)
    expect(result.current.loadBuffered()).toEqual([])
  })
})

describe('useFeedStream — buffers arrivals behind a count only (AC1/AC2)', () => {
  it('starts and subscribes to the source when enabled', async () => {
    const fake = new FakeFeedStreamSource()
    renderHook(() => useFeedStream({ enabled: true, source: fake }))

    await waitFor(() => expect(fake.startCalls).toBe(1))
  })

  it('increments newCount per arrival without needing a re-subscribe', async () => {
    const fake = new FakeFeedStreamSource()
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => fake.push(buildView('p1')))
    expect(result.current.newCount).toBe(1)

    act(() => fake.push(buildView('p2')))
    expect(result.current.newCount).toBe(2)
  })

  it('dedups a re-delivered id (defence in depth over the source-level dedup)', async () => {
    const fake = new FakeFeedStreamSource()
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => {
      fake.push(buildView('p1'))
      fake.push(buildView('p1'))
    })

    expect(result.current.newCount).toBe(1)
  })

  it('loadBuffered drains newest-first and clears the count (AC2)', async () => {
    const fake = new FakeFeedStreamSource()
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => {
      fake.push(buildView('p1'))
      fake.push(buildView('p2'))
      fake.push(buildView('p3'))
    })
    expect(result.current.newCount).toBe(3)

    let drained: ParticipantPostView[] = []
    act(() => {
      drained = result.current.loadBuffered()
    })

    expect(drained.map(p => p.id)).toEqual(['p3', 'p2', 'p1'])
    expect(result.current.newCount).toBe(0)
    // Already drained — a second call returns nothing, doesn't re-hand the same posts.
    expect(result.current.loadBuffered()).toEqual([])
  })

  it('unsubscribes and stops the source on unmount', async () => {
    const fake = new FakeFeedStreamSource()
    const { unmount } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    unmount()
    expect(fake.stopCalls).toBe(1)
  })
})

describe('useFeedStream — a disable transition clears the buffer (Copilot #301 round-2)', () => {
  it('does not resurface stale buffered posts / count when re-enabled without a remount', async () => {
    const fake = new FakeFeedStreamSource()
    const { result, rerender } = renderHook(
      ({ enabled }) => useFeedStream({ enabled, source: fake }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(fake.startCalls).toBe(1))

    // Enabled: N arrivals buffer behind the pill → newCount = N.
    act(() => {
      fake.push(buildView('p1'))
      fake.push(buildView('p2'))
      fake.push(buildView('p3'))
    })
    expect(result.current.newCount).toBe(3)

    // Disable (observer/read-only, D1-011): the effect cleanup unsubscribes +
    // stops AND the buffer is cleared. newCount drops to 0.
    rerender({ enabled: false })
    expect(result.current.newCount).toBe(0)

    // Re-enable WITHOUT a remount: the stale 3 must NOT resurface. The count
    // stays 0 (the buffer was cleared on disable) until a genuinely NEW arrival.
    rerender({ enabled: true })
    await waitFor(() => expect(fake.startCalls).toBe(2))
    expect(result.current.newCount).toBe(0)

    // A fresh arrival now counts from a clean base — 1, not the stale 4.
    act(() => fake.push(buildView('p4')))
    expect(result.current.newCount).toBe(1)

    // And the drain hands back only the new post, not the pre-disable ones.
    let drained: ParticipantPostView[] = []
    act(() => {
      drained = result.current.loadBuffered()
    })
    expect(drained.map(p => p.id)).toEqual(['p4'])
  })
})

describe('useFeedStream — a source whose start() rejects is fail-soft (Copilot #301)', () => {
  it('swallows a rejected start() (no unhandled rejection) and still buffers arrivals', async () => {
    // A pathological source whose start() REJECTS. The hook must swallow it so
    // it never becomes an unhandled promise rejection (which has crashed vitest
    // worker teardown in this repo) AND stay fully functional — subscribe is
    // wired before start(), so arrivals still buffer regardless of the outcome.
    const fake = new FakeFeedStreamSource()
    vi.spyOn(fake, 'start').mockRejectedValue(new Error('start blew up'))

    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))

    // Let the rejected start() settle — the hook's own .catch() handles it; if
    // the fix were missing this microtask would surface an unhandled rejection.
    await Promise.resolve()

    // Subscription is still live: an arrival buffers as normal.
    act(() => fake.push(buildView('p1')))
    expect(result.current.newCount).toBe(1)

    // And draining still works — the hook is not wedged by the failed start.
    let drained: ParticipantPostView[] = []
    act(() => {
      drained = result.current.loadBuffered()
    })
    expect(drained.map(p => p.id)).toEqual(['p1'])
    expect(result.current.newCount).toBe(0)
  })
})

describe('useFeedStream — bounded ring under burst (NFR-002, SOC-071)', () => {
  it('never exceeds FEED_STREAM_BUFFER_CAP and keeps the NEWEST arrivals (evict-oldest)', async () => {
    const fake = new FakeFeedStreamSource()
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    const totalArrivals = FEED_STREAM_BUFFER_CAP + 50
    act(() => {
      for (let i = 0; i < totalArrivals; i += 1) {
        fake.push(buildView(`p${i}`))
      }
    })

    // The count is the ONLY render state per arrival — never exceeds the cap.
    expect(result.current.newCount).toBe(FEED_STREAM_BUFFER_CAP)

    let drained: ParticipantPostView[] = []
    act(() => {
      drained = result.current.loadBuffered()
    })

    expect(drained).toHaveLength(FEED_STREAM_BUFFER_CAP)
    // Keep-newest: the retained ids are exactly the LAST `cap` pushed, newest-first.
    const expectedNewestFirst = Array.from(
      { length: FEED_STREAM_BUFFER_CAP },
      (_, i) => `p${totalArrivals - 1 - i}`,
    )
    expect(drained.map(p => p.id)).toEqual(expectedNewestFirst)
  })
})

describe('useFeedStream — the optional `admit` predicate filters arrivals (feeds-discovery/08)', () => {
  it('omitting `admit` admits everything — the All Posts path is unchanged', async () => {
    const fake = new FakeFeedStreamSource()
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => {
      fake.push(buildView('p1', { authorPersonaId: 'persona-a' }))
      fake.push(buildView('p2', { authorPersonaId: 'persona-b' }))
    })

    expect(result.current.newCount).toBe(2)
  })

  it('never counts NOR buffers a rejected arrival, and the count always equals the drain', async () => {
    const fake = new FakeFeedStreamSource()
    const admit = (post: ParticipantPostView) => post.authorPersonaId === 'persona-followed'
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake, admit }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => {
      fake.push(buildView('p1', { authorPersonaId: 'persona-followed' }))
      fake.push(buildView('p2', { authorPersonaId: 'persona-unfollowed' }))
      fake.push(buildView('p3', { authorPersonaId: 'persona-followed' }))
    })

    // 3 arrived, 2 admitted — the count promises only what it can deliver.
    expect(result.current.newCount).toBe(2)

    let drained: ParticipantPostView[] = []
    act(() => {
      drained = result.current.loadBuffered()
    })

    // …and the drain hands back EXACTLY that many, newest-first. A pill saying
    // "2 new posts" that drains to 2 posts is the whole point of the option.
    expect(drained).toHaveLength(2)
    expect(drained.map(p => p.id)).toEqual(['p3', 'p1'])
    expect(result.current.newCount).toBe(0)
  })

  it('leaves no dedup trace for a rejected post — one that later becomes admissible still buffers', async () => {
    // Mirrors <Feed>'s ref-backed predicate: a STABLE function whose answer
    // changes as the viewer's followed set moves, with no re-subscribe.
    const fake = new FakeFeedStreamSource()
    const followed = new Set<string>()
    const admit = (post: ParticipantPostView) => followed.has(post.authorPersonaId)
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake, admit }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => fake.push(buildView('p1', { authorPersonaId: 'persona-a' })))
    expect(result.current.newCount).toBe(0)

    // The reader follows persona-a mid-session; the SAME post id is re-offered
    // (a redelivery) and must now be admitted — a stale dedup entry from the
    // rejection would silently swallow it.
    followed.add('persona-a')
    act(() => fake.push(buildView('p1', { authorPersonaId: 'persona-a' })))
    expect(result.current.newCount).toBe(1)

    // No re-subscribe was needed for any of that (stable predicate identity).
    expect(fake.startCalls).toBe(1)
    expect(fake.stopCalls).toBe(0)
  })

  it('a stable predicate is not re-subscribed on re-render; a changed one re-subscribes without losing the buffer', async () => {
    const fake = new FakeFeedStreamSource()
    const admitAll = () => true
    const { result, rerender } = renderHook(
      ({ admit }) => useFeedStream({ enabled: true, source: fake, admit }),
      { initialProps: { admit: admitAll } },
    )
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => fake.push(buildView('p1')))
    expect(result.current.newCount).toBe(1)

    // Same identity → no churn.
    rerender({ admit: admitAll })
    expect(fake.startCalls).toBe(1)
    expect(fake.stopCalls).toBe(0)

    // A NEW identity re-subscribes (documented cost of the stability contract),
    // but the buffer survives — only a disable transition clears it, so what the
    // reader was already promised is not silently withdrawn.
    rerender({ admit: () => true })
    await waitFor(() => expect(fake.startCalls).toBe(2))
    expect(result.current.newCount).toBe(1)
  })
})

describe('useFeedStream — surfaces the source transport mode (NFR-003 transparency)', () => {
  it('reflects the source mode at render time, including after it changes underneath', async () => {
    const fake = new FakeFeedStreamSource()
    fake.mode = 'connecting'
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    expect(result.current.mode).toBe('connecting')

    fake.mode = 'polling'
    // Force a re-render (an arrival is a convenient, realistic trigger) — the
    // hook re-reads the source's live `mode` getter rather than a snapshot.
    act(() => fake.push(buildView('p1')))
    expect(result.current.mode).toBe('polling')
  })
})

describe('useFeedStream — introduces no client exerciseId anywhere on this seam (COR-001)', () => {
  it('calls start()/subscribe() with exactly the interface arguments — no scope/exerciseId parameter', async () => {
    const startSpy = vi.fn(() => Promise.resolve())
    const subscribeSpy = vi.fn((_handler: FeedStreamHandler) => () => {})
    const source: FeedStreamSource = {
      subscribe: subscribeSpy,
      start: startSpy,
      stop: vi.fn(),
      mode: 'realtime',
    }

    renderHook(() => useFeedStream({ enabled: true, source }))
    await waitFor(() => expect(startSpy).toHaveBeenCalled())

    // Isolation is inherited entirely from the source (COR-001) — this hook
    // never re-opens scope by threading a client-side exerciseId/filter value
    // through start()/subscribe(). Asserted structurally: zero extra args.
    expect(startSpy.mock.calls[0]).toEqual([])
    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(subscribeSpy.mock.calls[0]).toHaveLength(1)
  })
})

describe('useFeedStream — drained posts carry no provenance (XC-002)', () => {
  it('a loaded post has none of the four provenance keys', async () => {
    const fake = new FakeFeedStreamSource()
    const { result } = renderHook(() => useFeedStream({ enabled: true, source: fake }))
    await waitFor(() => expect(fake.startCalls).toBe(1))

    act(() => fake.push(buildView('p1')))

    let drained: ParticipantPostView[] = []
    act(() => {
      drained = result.current.loadBuffered()
    })

    const loaded = drained[0]
    expect(loaded).toBeDefined()
    for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId']) {
      expect(Object.prototype.hasOwnProperty.call(loaded as object, key)).toBe(false)
    }
  })
})
