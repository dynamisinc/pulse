/**
 * features/social/hooks/useFeed.test.ts
 * ---------------------------------------------------------------------------
 * Covers `useFeed()`'s FROZEN reading stream (feeds-discovery/04 supersedes the
 * interim /07 auto-insert; SOC-083, COR-053, XC-002, NFR-002/SOC-071):
 *  - `useFeed()` resolves the seeded baseline, newest-first;
 *  - a post appended to `postStore` AFTER the hook mounts does NOT insert into
 *    the reading stream — that stream is frozen at resolve time; real-time
 *    arrivals are the "new posts" pill's to buffer (`useFeedStream`), never this
 *    hook's to move (AC1);
 *  - the baseline is narrowed like any participant read (no `origin`/
 *    `actingHumanId`/`injectId`/`createdWallClock` leak — XC-002), even though
 *    the seeded `Post`s carry that provenance;
 *  - the mapped feed array keeps a STABLE identity across a re-render with
 *    unchanged inputs (the burst-legibility memoization contract, NFR-002/
 *    SOC-071).
 *
 * `usePersonas` and `resolveFeed` both run through the shipped mock adapters
 * (USE_MOCK_DATA on in test), so no providers are needed — the seeded Fairhaven
 * cast resolves and the appended author (an existing seeded persona) is present.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { useFeed } from './useFeed'

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-live-appended',
    exerciseId: 'ex-mock-0001',
    // An existing seeded persona so the feed convergence WOULD resolve an author
    // (proving the post is withheld by the freeze, not dropped for a missing author).
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'live update from the utility',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    // Newer than every seeded post (max seed = 2033-09-04T14:20:00Z) → would be
    // top if it were inserted.
    scenarioTime: '2033-09-04T15:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

afterEach(() => {
  postStore.resetForTests()
})

describe('useFeed — frozen reading stream (feeds-discovery/04)', () => {
  it('resolves the seeded baseline, newest-first (COR-053)', async () => {
    const { result } = renderHook(() => useFeed())

    await waitFor(() => expect(result.current.loading).toBe(false))
    const ids = result.current.posts.map(p => p.id)
    expect(ids.length).toBeGreaterThan(0)
    // Newest-first: the correction (14:20) leads, the advisory (13:15) trails.
    expect(ids[0]).toBe('post-seed-kward-correction')
    expect(ids[ids.length - 1]).toBe('post-seed-fw-advisory')
  })

  it('does NOT insert a post appended after mount (the stream is frozen — AC1)', async () => {
    const { result, rerender } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const baselineIds = result.current.posts.map(p => p.id)
    const baselineArray = result.current.posts

    act(() => {
      postStore.appendPost(buildPost())
    })
    // Force a re-render: even so, the frozen stream must not read the store.
    rerender()

    expect(result.current.posts.some(p => p.id === 'post-live-appended')).toBe(false)
    expect(result.current.posts.map(p => p.id)).toEqual(baselineIds)
    // No store subscription → no state change → the memoized array is untouched.
    expect(result.current.posts).toBe(baselineArray)
  })

  it('narrows the baseline — no provenance leak (XC-002)', async () => {
    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The inject-origin rumor post carries origin/injectId/actingHumanId on its
    // full `Post`; the participant view must expose none of them.
    const rumor = result.current.posts.find(p => p.id === 'post-seed-fwupd-rumor')
    expect(rumor).toBeDefined()
    expect(rumor).not.toHaveProperty('origin')
    expect(rumor).not.toHaveProperty('actingHumanId')
    expect(rumor).not.toHaveProperty('injectId')
    expect(rumor).not.toHaveProperty('createdWallClock')
  })

  it('does not re-derive when inputs are unchanged (stable feed array across re-render)', async () => {
    const { result, rerender } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = result.current.posts
    // A re-render with no store change must not rebuild the memoized view array
    // (the burst-legibility memoization stays intact — NFR-002/SOC-071).
    rerender()
    expect(result.current.posts).toBe(before)
  })
})
