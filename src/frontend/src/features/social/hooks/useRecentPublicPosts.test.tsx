/**
 * features/social/hooks/useRecentPublicPosts.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 21, "Bounded recent public posts (R-S1)", over the REAL app-wide
 * Explore baseline with its feed read and arrival source stubbed at the module seam:
 *  - newest top-level, visible posts only (no replies, tombstones, hidden or taken-down
 *    posts), `limit` 1-20, default 5;
 *  - NO second read or connection: mounted beside `useTrending` it shares the one feed
 *    read and the one arrival subscription;
 *  - isolation: it takes no exercise id (a type error) and puts none on the read;
 *  - burst (NFR-002): a 120 posts/min stream, and a same-tick flood, re-render a consumer
 *    at most once per store batch (250 ms), never once per post (fake timers).
 */
import { Profiler, type ReactNode } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import type { ParticipantPostView, Post } from '../types/post'

const fakes = vi.hoisted(() => {
  class FakeSource {
    readonly handlers = new Set<(view: unknown) => void>()
    starts = 0
    readonly mode = 'realtime' as const
    subscribe(handler: (view: unknown) => void) {
      this.handlers.add(handler)
      return () => {
        this.handlers.delete(handler)
      }
    }
    start() {
      this.starts += 1
      return Promise.resolve()
    }
    stop() {}
    emit(view: unknown) {
      for (const handler of [...this.handlers]) handler(view)
    }
  }
  return { source: new FakeSource(), resolveFeed: vi.fn() }
})

vi.mock('../services/feedStreamSource', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/feedStreamSource')>()),
  defaultFeedStreamSource: fakes.source,
}))
vi.mock('../services/feedService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/feedService')>()),
  resolveFeed: fakes.resolveFeed,
}))

// Imported after the mocks, so the singleton store is built over the fakes.
const { exploreFeedStore, EXPLORE_ARRIVAL_BATCH_MS } = await import('../explore/exploreFeedStore')
const { useTrending } = await import('../explore/useTrending')
const { useRecentPublicPosts, clampRecentLimit } = await import('./useRecentPublicPosts')

function post(id: string, minute: number, extra: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-x',
    text: `post ${id} #Water`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: `2033-09-04T14:${String(minute).padStart(2, '0')}:00.000Z`,
    origin: 'participant',
    ...extra,
  }
}

function arrival(id: string, at: string): ParticipantPostView {
  return {
    id,
    authorPersonaId: 'persona-fairhavenwater',
    text: `arrival ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: at,
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
        >
          {children}
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>
  )
}

const BASELINE: Post[] = [
  post('v1', 1),
  post('v2', 2),
  post('reply', 3, { inReplyTo: { postId: 'v1', authorHandle: 'FairhavenWater' } }),
  post('v3', 6),
  post('v4', 7),
  post('v5', 8),
  post('v6', 9),
  post('v7', 10),
]

beforeEach(() => {
  fakes.resolveFeed.mockReset()
  fakes.resolveFeed.mockResolvedValue(BASELINE)
  fakes.source.handlers.clear()
  fakes.source.starts = 0
})

afterEach(() => {
  vi.useRealTimers()
  exploreFeedStore.reset()
})

describe('useRecentPublicPosts: what it returns', () => {
  it('returns the newest top-level visible posts, default 5', async () => {
    const { result } = renderHook(() => useRecentPublicPosts(), { wrapper: Providers })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.posts.map(p => p.id)).toEqual(['v7', 'v6', 'v5', 'v4', 'v3'])
    expect(result.current.failed).toBe(false)
  })

  it('never returns a reply, a tombstone or a hidden post, however large the limit', async () => {
    const { result } = renderHook(() => useRecentPublicPosts({ limit: 20 }), { wrapper: Providers })
    await waitFor(() => expect(result.current.loading).toBe(false))
    // The read is narrowed (`toParticipantView`), so a removal marker can only reach the
    // hook on an ARRIVAL, which the store holds as delivered. Deliver one of each.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => {
      fakes.source.emit({ ...arrival('tomb', '2033-09-04T15:01:00.000Z'), status: 'taken-down' })
      fakes.source.emit({ ...arrival('hidden', '2033-09-04T15:02:00.000Z'), status: 'hidden' })
      fakes.source.emit({ ...arrival('deleted', '2033-09-04T15:03:00.000Z'), status: 'deleted' })
      fakes.source.emit({
        ...arrival('late-reply', '2033-09-04T15:04:00.000Z'),
        inReplyTo: { postId: 'v1', authorHandle: 'FairhavenWater' },
      })
    })
    act(() => {
      vi.advanceTimersByTime(EXPLORE_ARRIVAL_BATCH_MS)
    })

    const ids = result.current.posts.map(p => p.id)
    expect(ids).toEqual(['v7', 'v6', 'v5', 'v4', 'v3', 'v2', 'v1'])
    expect(ids).not.toContain('deleted')
    expect(ids).not.toContain('late-reply')
    expect(ids).not.toContain('reply')
    expect(ids).not.toContain('tomb')
    expect(ids).not.toContain('hidden')
  })

  it('returns participant-safe views (no provenance keys)', async () => {
    const { result } = renderHook(() => useRecentPublicPosts({ limit: 1 }), { wrapper: Providers })
    await waitFor(() => expect(result.current.posts).toHaveLength(1))

    const [first] = result.current.posts
    for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId', 'exerciseId']) {
      expect(first).not.toHaveProperty(key)
    }
  })

  it('clamps the limit to 1-20', () => {
    expect(clampRecentLimit(undefined)).toBe(5)
    expect(clampRecentLimit(0)).toBe(1)
    expect(clampRecentLimit(-3)).toBe(1)
    expect(clampRecentLimit(2.9)).toBe(2)
    expect(clampRecentLimit(21)).toBe(20)
    expect(clampRecentLimit(500)).toBe(20)
    expect(clampRecentLimit(Number.NaN)).toBe(5)
  })

  it('drops a post a controller takes down (the shared store does)', async () => {
    const { removedPosts } = await import('../services/removedPosts')
    const { result } = renderHook(() => useRecentPublicPosts(), { wrapper: Providers })
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('v7'))

    act(() => removedPosts.add('v7'))

    expect(result.current.posts.map(p => p.id)).not.toContain('v7')
    removedPosts.resetForTests()
  })
})

describe('useRecentPublicPosts: one read, one connection (no second subscription)', () => {
  it('shares the feed read and the arrival subscription with useTrending', async () => {
    const { result } = renderHook(
      () => ({ recent: useRecentPublicPosts(), trending: useTrending() }),
      { wrapper: Providers },
    )
    await waitFor(() => expect(result.current.recent.loading).toBe(false))

    expect(fakes.resolveFeed).toHaveBeenCalledTimes(1)
    expect(fakes.source.starts).toBe(1)
    expect(fakes.source.handlers.size).toBe(1)
    expect(result.current.trending.topics.map(t => t.tag)).toContain('water')
  })
})

describe('useRecentPublicPosts: isolation (XC-001)', () => {
  it('accepts no exercise id and sends none on the read', async () => {
    // @ts-expect-error -- the hook has no exercise-id option: scope is the session's.
    const options: Parameters<typeof useRecentPublicPosts>[0] = { exerciseId: 'ex-other' }
    const { result } = renderHook(() => useRecentPublicPosts(options), { wrapper: Providers })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The read is session-scoped: it is called with nothing at all.
    expect(fakes.resolveFeed).toHaveBeenCalledWith()
  })

  it('a different scope never reads the previous scope\'s posts', async () => {
    const { result } = renderHook(() => useRecentPublicPosts(), { wrapper: Providers })
    await waitFor(() => expect(result.current.posts).toHaveLength(5))

    expect(exploreFeedStore.getSnapshot('ex-other|acct-other|live').posts).toEqual([])
  })
})

describe('useRecentPublicPosts: burst legibility (NFR-002)', () => {
  /** Renders the slice (ids, newest first) so a test reads what the consumer shows. */
  function Consumer() {
    const { posts } = useRecentPublicPosts({ limit: 5 })
    return <ol>{posts.map(p => <li key={p.id}>{p.id}</li>)}</ol>
  }

  function latestIds(): string[] {
    return screen.queryAllByRole('listitem').map(item => item.textContent ?? '')
  }

  /** Mounts the consumer under a `<Profiler>` that counts its commits. */
  async function mountCounter() {
    let renders = 0
    const onRender = () => {
      renders += 1
    }
    render(
      <Providers>
        <Profiler id="recent" onRender={onRender}>
          <Consumer />
        </Profiler>
      </Providers>,
    )
    await waitFor(() => expect(latestIds()).toHaveLength(5))
    return { renders: () => renders }
  }

  it('a same-tick flood of 30 posts re-renders the consumer once, after the batch', async () => {
    const counter = await mountCounter()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const before = counter.renders()

    act(() => {
      for (let i = 0; i < 30; i += 1) {
        const at = `2033-09-04T15:${String(i).padStart(2, '0')}:00.000Z`
        fakes.source.emit(arrival(`flood-${i}`, at))
      }
    })
    expect(counter.renders()).toBe(before) // nothing until the batch fires

    act(() => {
      vi.advanceTimersByTime(EXPLORE_ARRIVAL_BATCH_MS)
    })
    expect(counter.renders()).toBe(before + 1)
    expect(latestIds()).toEqual([
      'flood-29', 'flood-28', 'flood-27', 'flood-26', 'flood-25',
    ])
  })

  it('a 120 posts/min stream renders at most once per batch, never once per post', async () => {
    const counter = await mountCounter()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const before = counter.renders()

    // One minute at 120 posts/min, delivered as 4 posts every 2 s (bursty, as injects are).
    const MINUTE_MS = 60_000
    const STEP_MS = 2_000
    let sent = 0
    for (let t = 0; t < MINUTE_MS; t += STEP_MS) {
      act(() => {
        for (let k = 0; k < 4; k += 1) {
          sent += 1
          const at = new Date(Date.UTC(2033, 8, 4, 15, 0, 0) + sent * 500).toISOString()
          fakes.source.emit(arrival(`burst-${sent}`, at))
        }
      })
      act(() => {
        vi.advanceTimersByTime(STEP_MS)
      })
    }

    const renders = counter.renders() - before
    expect(sent).toBe(120)
    // One render per batch window that had arrivals: 30, never 120.
    expect(renders).toBeLessThanOrEqual(MINUTE_MS / STEP_MS)
    // And never more often than once per animation frame (~16.7 ms) over the minute.
    expect(renders).toBeLessThanOrEqual(MINUTE_MS / (1000 / 60))
    expect(latestIds()[0]).toBe('burst-120')
  })
})
