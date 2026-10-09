/**
 * features/social/hooks/useFeed.withCast.test.ts
 * ---------------------------------------------------------------------------
 * Covers `useFeedWithCast(scope, cast)` -- `useFeed()`'s body with the persona cast
 * supplied by the caller instead of read by the hook. It exists so a surface that already
 * holds the cast (`<Profile>`, via the channel's `SocialDirectory`) does not start a
 * second, private `GET /personas` just to resolve post authors (Copilot review, PR #460).
 *
 *  - it never reads the cast itself: no `GET /personas` is issued, and the posts still
 *    resolve against the cast it was handed;
 *  - the supplied cast's `loading` and `error` fold into the result's, exactly as
 *    `useFeed()` folds in `usePersonas()`'s (so a not-yet-loaded cast never flashes an
 *    empty "No posts yet." state), and a later cast swaps in without a refetch of posts.
 *
 * `@/core/auth` is mocked to a fixed persona-bound session for the same reason the sibling
 * `useFeed.test.ts` does (the hook reads the session for its COR-015 guard).
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { api } from '@/core/services/api'
import { resolvePersonas, type Persona } from '@/features/personas'
import { postStore } from '../services/postStore'
import { useFeedWithCast, type FeedCast } from './useFeed'

const MOCK_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-dreyes',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', () => ({
  useSession: () => MOCK_SESSION,
}))

afterEach(() => {
  postStore.resetForTests()
  vi.restoreAllMocks()
})

const castOf = (
  personas: readonly Persona[],
  overrides: Partial<FeedCast> = {},
): FeedCast => ({ personas, loading: false, error: undefined, ...overrides })

describe('useFeedWithCast — the caller supplies the cast', () => {
  it('resolves the feed against the supplied cast without reading the cast itself', async () => {
    const personas = await resolvePersonas()
    const get = vi.spyOn(api, 'get')

    const { result } = renderHook(() => useFeedWithCast('all', castOf(personas)))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.posts.length).toBeGreaterThan(0)
    expect(result.current.posts.every(post => post.author.handle.length > 0)).toBe(true)
    expect(get.mock.calls.filter(call => call[0] === '/personas')).toHaveLength(0)
  })

  it('stays loading while the supplied cast is loading, then settles once it lands', async () => {
    const personas = await resolvePersonas()

    const { result, rerender } = renderHook(
      ({ cast }: { cast: FeedCast }) => useFeedWithCast('all', cast),
      { initialProps: { cast: castOf([], { loading: true }) } },
    )
    // Let the post read settle: the cast, not the posts, is what is still outstanding.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.current.loading).toBe(true)
    expect(result.current.posts).toEqual([])

    rerender({ cast: castOf(personas) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.posts.length).toBeGreaterThan(0)
  })

  it('surfaces the supplied cast\'s error', async () => {
    const failure = new Error('cast unavailable')

    const { result } = renderHook(() => useFeedWithCast('all', castOf([], { error: failure })))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe(failure)
    expect(result.current.posts).toEqual([])
  })
})
