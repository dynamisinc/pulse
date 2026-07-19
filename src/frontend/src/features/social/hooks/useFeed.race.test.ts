/**
 * features/social/hooks/useFeed.race.test.ts
 * ---------------------------------------------------------------------------
 * Regression for the in-flight-append race (feeds-discovery/07): a post
 * appended to `postStore` WHILE the baseline `resolveFeed()` is still pending
 * must NOT be dropped when that late resolve settles.
 *
 * Before the fix, the resolve path set `rawPosts` to the value captured when the
 * request started (the pre-append snapshot), clobbering a post the subscription
 * had already surfaced. Now both the resolve and the subscription read the
 * store's CURRENT snapshot, so neither can clobber the other regardless of
 * order. `resolveFeed` is mocked here purely to CONTROL that timing; the feed
 * convergence (`assembleFeedView`) and `usePersonas` stay real (mock adapters).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'

// Control resolveFeed's timing; keep assembleFeedView (and everything else) real.
vi.mock('../services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

import { resolveFeed } from '../services/feedService'
import { useFeed } from './useFeed'

const APPENDED_ID = 'post-race-appended'

function buildAppendedPost(): Post {
  return {
    id: APPENDED_ID,
    exerciseId: 'ex-mock-0001',
    // An existing seeded persona so the feed convergence resolves its author.
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'appended while the baseline resolve was in flight',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    // Newer than every seeded post → sorts to the top.
    scenarioTime: '2033-09-04T15:00:00Z',
    origin: 'controller-as-persona',
  }
}

afterEach(() => {
  postStore.resetForTests()
  vi.mocked(resolveFeed).mockReset()
})

describe('useFeed — append during in-flight baseline resolve (feeds-discovery/07 race)', () => {
  it('does not drop a post appended before the initial resolve settles', async () => {
    // The STALE pre-append snapshot the late resolve would have carried.
    const staleBaseline = postStore.getPosts()

    let releaseResolve: (posts: Post[]) => void = () => {}
    const pending = new Promise<Post[]>(resolve => {
      releaseResolve = resolve
    })
    vi.mocked(resolveFeed).mockReturnValueOnce(pending)

    const { result } = renderHook(() => useFeed())

    // Append WHILE the baseline resolve is still pending — the subscription
    // surfaces the new post.
    act(() => {
      postStore.appendPost(buildAppendedPost())
    })
    await waitFor(() =>
      expect(result.current.posts.some(p => p.id === APPENDED_ID)).toBe(true),
    )

    // Now the late baseline resolve settles carrying the STALE (pre-append) set.
    await act(async () => {
      releaseResolve(staleBaseline)
      await pending
    })

    // The appended post must SURVIVE the stale resolve (it was dropped pre-fix),
    // and still sort newest-first at the top.
    expect(result.current.posts.some(p => p.id === APPENDED_ID)).toBe(true)
    expect(result.current.posts[0]?.id).toBe(APPENDED_ID)
    expect(result.current.loading).toBe(false)
  })
})
