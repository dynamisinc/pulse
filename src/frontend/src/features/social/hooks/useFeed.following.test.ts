/**
 * features/social/hooks/useFeed.following.test.ts
 * ---------------------------------------------------------------------------
 * Covers `useFeed(scope)`'s story-02 extension (SOC-081, COR-053, XC-002):
 *  - `useFeed('following')` resolves ONLY posts from the mock following set;
 *  - an empty follow set resolves an EMPTY `posts` array with
 *    `loading: false, error: undefined` (the honest "nothing to show" state,
 *    never a silent fallback to the unfiltered 'all' scope);
 *  - switching `scope` across a re-render re-resolves against the new scope
 *    (this hook does not freeze scope itself — only the per-scope baseline);
 *  - `useFeed()` with no argument is unaffected (default `'all'`, covered
 *    already by the sibling `useFeed.test.ts` — this file only adds the
 *    scope-switch + following coverage).
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import { setMockFollowingForTests, type FeedScope } from '../services/feedService'
import { postStore } from '../services/postStore'
import { useFeed } from './useFeed'

afterEach(() => {
  postStore.resetForTests()
  setMockFollowingForTests(undefined)
})

describe('useFeed(\'following\') — Following scope (SOC-081)', () => {
  it('resolves only posts from the mock following set', async () => {
    setMockFollowingForTests([personaIdForHandle('FairhavenWater')])

    const { result } = renderHook(() => useFeed('following'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeUndefined()
    expect(result.current.posts.length).toBeGreaterThan(0)
    expect(
      result.current.posts.every(p => p.author.id === personaIdForHandle('FairhavenWater')),
    ).toBe(true)
  })

  it('resolves an empty, non-error posts array for an empty follow set (honest empty state)', async () => {
    setMockFollowingForTests([])

    const { result } = renderHook(() => useFeed('following'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeUndefined()
    expect(result.current.posts).toEqual([])
  })

  it('re-resolves against the new scope when scope changes across a re-render', async () => {
    setMockFollowingForTests([personaIdForHandle('FairhavenWater')])

    const { result, rerender } = renderHook(
      ({ scope }: { scope: FeedScope }) => useFeed(scope),
      { initialProps: { scope: 'all' } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    const allCount = result.current.posts.length
    expect(allCount).toBeGreaterThan(1) // the full seeded set

    rerender({ scope: 'following' })

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.posts.length).toBeLessThan(allCount))
    expect(
      result.current.posts.every(p => p.author.id === personaIdForHandle('FairhavenWater')),
    ).toBe(true)
  })
})
