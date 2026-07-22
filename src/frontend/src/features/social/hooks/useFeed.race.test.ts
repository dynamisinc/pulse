/**
 * features/social/hooks/useFeed.race.test.ts
 * ---------------------------------------------------------------------------
 * Baseline-capture semantics of the FROZEN reading stream (feeds-discovery/04,
 * superseding the /07 in-flight-append race). Two things must both hold:
 *
 *  - a post appended to `postStore` WHILE the baseline `resolveFeed()` is still
 *    pending is part of the INITIAL baseline — the resolve reads the store's
 *    CURRENT snapshot, not a stale pre-append one, so the post the reader first
 *    sees is not silently dropped; and
 *  - once the baseline has resolved, a LATER append does NOT move the stream —
 *    it is frozen (AC1); that arrival is the "new posts" pill's to buffer.
 *
 * `resolveFeed` is mocked purely to CONTROL the resolve timing; the feed
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

const IN_FLIGHT_ID = 'post-inflight-appended'
const LATER_ID = 'post-later-appended'

function buildPost(id: string, scenarioTime: string): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    // An existing seeded persona so the feed convergence resolves its author.
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: `appended: ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime,
    origin: 'controller-as-persona',
  }
}

afterEach(() => {
  postStore.resetForTests()
  vi.mocked(resolveFeed).mockReset()
})

describe('useFeed — baseline capture vs. freeze (feeds-discovery/04)', () => {
  it('captures a post appended during the in-flight resolve into the baseline (not dropped)', async () => {
    let releaseResolve: (posts: Post[]) => void = () => {}
    const pending = new Promise<Post[]>(resolve => {
      releaseResolve = resolve
    })
    vi.mocked(resolveFeed).mockReturnValueOnce(pending)

    const { result } = renderHook(() => useFeed())
    expect(result.current.loading).toBe(true)

    // Append WHILE the baseline resolve is still pending.
    act(() => {
      postStore.appendPost(buildPost(IN_FLIGHT_ID, '2033-09-04T15:00:00Z'))
    })

    // Now let the resolve settle. useFeed reads the store's CURRENT snapshot
    // (which includes the in-flight append), so it lands in the initial baseline.
    await act(async () => {
      releaseResolve([])
      await pending
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.posts.some(p => p.id === IN_FLIGHT_ID)).toBe(true)
    // Newest scenarioTime → top of the baseline.
    expect(result.current.posts[0]?.id).toBe(IN_FLIGHT_ID)
  })

  it('freezes after resolve — a LATER append does not enter the stream (AC1)', async () => {
    vi.mocked(resolveFeed).mockResolvedValueOnce([])

    const { result, rerender } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const baselineIds = result.current.posts.map(p => p.id)

    act(() => {
      postStore.appendPost(buildPost(LATER_ID, '2033-09-04T16:00:00Z'))
    })
    rerender()

    expect(result.current.posts.some(p => p.id === LATER_ID)).toBe(false)
    expect(result.current.posts.map(p => p.id)).toEqual(baselineIds)
  })
})
