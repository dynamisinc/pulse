/**
 * features/social/hooks/useFeed.race.test.ts
 * ---------------------------------------------------------------------------
 * Baseline-adoption semantics of the FROZEN reading stream (feeds-discovery/04,
 * UAT feed-bug fix). Two things must both hold:
 *
 *  - the baseline is EXACTLY what `resolveFeed()` resolves with — never a
 *    separate re-read of `postStore` at settle time. This is the regression
 *    test for the UAT bug: the previous build awaited `resolveFeed()` purely
 *    for its validation/loading semantics and then discarded the resolved
 *    value in favor of `postStore.getPosts()`, so a live `GET /api/feed`
 *    response (or, here, anything appended to the store while the resolve is
 *    still in flight) was silently thrown away. A post appended to the store
 *    WHILE the resolve is pending must NOT leak into the baseline unless
 *    `resolveFeed()`'s own resolution includes it; and
 *  - once the baseline has resolved, a LATER append does NOT move the stream —
 *    it is frozen (AC1); that arrival is the "new posts" pill's to buffer.
 *
 * DRIVER — mocks the shared axios client (`@/core/services/api`) directly
 * (mirrors `liveReviewActions.test.ts`/`useFeed.live.test.ts`) rather than
 * `vi.mock`-ing `../services/feedService` itself: an async `vi.mock` factory
 * that calls `importOriginal()` on this module was found, in this Vitest
 * 4.1.10 setup, to leave `useFeed.ts`'s OWN import of `resolveFeed` bound to
 * the REAL implementation rather than the stub (`vi.isMockFunction` on the
 * test file's own imported reference reported `true`, but the hook's calls
 * never reached it — a hoisting/registration race specific to calling
 * `importOriginal()` from an async factory). Mocking one level down, at the
 * network boundary `resolveFeed()` itself calls, sidesteps that entirely and
 * lets `resolveFeed`'s real `isPost` validation run for real. `usePersonas`
 * stays real too (routed through the same mocked `api.get`, with a `/personas`
 * fixture below) so the feed convergence resolves an author.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { useFeed } from './useFeed'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: { get: (...args: unknown[]) => getMock(...args) },
}))

const STORE_APPENDED_ID = 'post-store-appended-during-resolve'
const API_RESOLVED_ID = 'post-from-resolve'
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

/** Routes `/personas` to a fixed one-author cast and `/feed` to `implementation`
 * (both requests `useFeed`'s two reads make); anything else is unexpected. */
function mockApi(feedImpl: () => Promise<{ data: unknown }>): void {
  getMock.mockImplementation((url: string) => {
    if (url === '/feed') return feedImpl()
    if (url === '/personas') {
      return Promise.resolve({
        data: [
          {
            id: personaIdForHandle('FairhavenWater'),
            exerciseId: 'ex-mock-0001',
            templateId: 'tmpl-fairhaven-water',
            displayName: 'Fairhaven Water Utility',
            handle: 'FairhavenWater',
            kind: 'org',
            personaType: 'agency',
            verified: true,
            avatarColor: '#19647e',
            initials: 'FW',
            audienceBand: 'mid',
            followerCount: 50232,
            joinedAt: '2025-07-08T12:00:00.000Z',
          },
        ],
      })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

afterEach(() => {
  postStore.resetForTests()
  getMock.mockReset()
})

describe('useFeed — the baseline is exactly what resolveFeed() resolves with (UAT feed-bug fix)', () => {
  it('adopts the live GET /feed response as the baseline — a store append meanwhile does NOT leak in', async () => {
    let releasePosts: (posts: Post[]) => void = () => {}
    const pending = new Promise<Post[]>(resolve => {
      releasePosts = resolve
    })
    mockApi(() => pending.then(posts => ({ data: posts })))

    const { result } = renderHook(() => useFeed())
    expect(result.current.loading).toBe(true)

    // The store changes WHILE the baseline resolve is still pending. Under the
    // pre-fix behavior this would have been folded into the baseline (the hook
    // re-read `postStore.getPosts()` after the await); under the fix it must
    // NOT — the baseline is exactly what `resolveFeed()` resolves with.
    act(() => {
      postStore.appendPost(buildPost(STORE_APPENDED_ID, '2033-09-04T15:00:00Z'))
    })

    const apiPost = buildPost(API_RESOLVED_ID, '2033-09-04T12:00:00Z')
    await act(async () => {
      releasePosts([apiPost])
      await pending
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    // Exactly what the live response resolved with — nothing more, nothing less.
    expect(result.current.posts.map(p => p.id)).toEqual([API_RESOLVED_ID])
    expect(result.current.posts.some(p => p.id === STORE_APPENDED_ID)).toBe(false)
  })

  it('freezes after resolve — a LATER append does not enter the stream (AC1)', async () => {
    mockApi(() => Promise.resolve({ data: [] }))

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
