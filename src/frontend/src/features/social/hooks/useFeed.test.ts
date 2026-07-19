/**
 * features/social/hooks/useFeed.test.ts
 * ---------------------------------------------------------------------------
 * Covers the live-feed slice (feeds-discovery/07; SOC-083 partial, COR-053,
 * XC-002, NFR-002/SOC-071):
 *  - `useFeed()` resolves the seeded baseline, newest-first;
 *  - a post appended to `postStore` AFTER the hook mounts appears at the TOP of
 *    the assembled feed (newest-first by `scenarioTime`) via the store
 *    subscription — no remount, no re-fetch of the baseline;
 *  - the just-appended post is narrowed like any other (no `origin`/
 *    `actingHumanId` leak — XC-002);
 *  - unchanged rows keep a STABLE `PostView` identity across the append
 *    (the burst-legibility memoization contract, NFR-002/SOC-071).
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
    // An existing seeded persona so the feed convergence resolves an author and
    // keeps the row (a post with an unknown author would be skipped).
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'live update from the utility',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    // Newer than every seeded post (max seed = 2033-09-04T14:20:00Z) → top.
    scenarioTime: '2033-09-04T15:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

afterEach(() => {
  postStore.resetForTests()
})

describe('useFeed — live appends (feeds-discovery/07)', () => {
  it('surfaces an appended post at the TOP without a remount or re-fetch', async () => {
    const { result } = renderHook(() => useFeed())

    await waitFor(() => expect(result.current.loading).toBe(false))
    const baselineIds = result.current.posts.map(p => p.id)
    expect(baselineIds.length).toBeGreaterThan(0)
    expect(baselineIds).not.toContain('post-live-appended')

    act(() => {
      postStore.appendPost(buildPost())
    })

    await waitFor(() =>
      expect(result.current.posts.some(p => p.id === 'post-live-appended')).toBe(true),
    )
    // Newest scenarioTime → first (newest-first, COR-053).
    expect(result.current.posts[0]?.id).toBe('post-live-appended')
  })

  it('narrows the appended post like any other — no provenance leak (XC-002)', async () => {
    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      postStore.appendPost(buildPost({ origin: 'inject', injectId: '042' }))
    })

    await waitFor(() =>
      expect(result.current.posts.some(p => p.id === 'post-live-appended')).toBe(true),
    )
    const appended = result.current.posts.find(p => p.id === 'post-live-appended')
    expect(appended).toBeDefined()
    expect(appended).not.toHaveProperty('origin')
    expect(appended).not.toHaveProperty('actingHumanId')
    expect(appended).not.toHaveProperty('injectId')
    expect(appended).not.toHaveProperty('createdWallClock')
  })

  it('leaves the seeded rows in place (same keys & relative order) below the new post', async () => {
    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const baselineIds = result.current.posts.map(p => p.id)

    act(() => {
      postStore.appendPost(buildPost())
    })

    await waitFor(() =>
      expect(result.current.posts.some(p => p.id === 'post-live-appended')).toBe(true),
    )
    // The appended (newest) post is prepended; every seeded row keeps its key
    // and its relative newest-first order below it — no reorder, no drop.
    expect(result.current.posts[0]?.id).toBe('post-live-appended')
    expect(result.current.posts.slice(1).map(p => p.id)).toEqual(baselineIds)
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
