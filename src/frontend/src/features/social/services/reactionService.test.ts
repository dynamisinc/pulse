/**
 * features/social/services/reactionService.test.ts
 * ---------------------------------------------------------------------------
 * The reaction write seam in MOCK mode (the Vitest default) — the adapter that
 * keeps `npm run dev` working with no backend (demo-polish F3, implementation.md
 * §5 "Mock seam notes"). It must behave like the server it stands in for:
 *
 *  - PUT / DELETE on `/posts/{id}/reactions/{like|repost}`, a `ReactionState` back
 *    (post id echoed, kind, active, counts after the change, viewer flags);
 *  - IDEMPOTENT: a repeat PUT / DELETE is a 200 with no count movement; the count
 *    never goes below 0;
 *  - works for ANY post id (stateless baseline = the client's seed), so a fixture,
 *    a fresh own post and a test's ad-hoc id all behave;
 *  - the test-only failure switch rejects with an `AxiosError` 503 (so it takes
 *    the same rollback path a real outage does);
 *  - persistence is OFF under Vitest (no cross-test leak) and ON when a test opts
 *    in, remembering both kinds so the response's other-kind fields stay coherent.
 *
 * The LIVE wire (no body / no config, encoding, malformed-200 rejection) is pinned
 * through the component in `PostActions.live.test.tsx`.
 */
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import {
  deleteReaction,
  mockReactionSnapshot,
  putReaction,
  resetMockReactions,
  setMockReactionFailure,
} from './reactionService'

beforeEach(() => {
  resetMockReactions()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMockReactions()
})

describe('reactionService (mock) — PUT / DELETE semantics', () => {
  it('PUT turns a reaction on: active, count + 1, viewer flag', async () => {
    const state = await putReaction('post-1', 'like', { active: false, count: 41 })

    expect(state).toEqual({
      postId: 'post-1',
      kind: 'like',
      active: true,
      counts: { reply: 0, like: 42, repost: 0 },
      viewer: { liked: true, reposted: false },
    })
  })

  it('DELETE turns it off: inactive, count - 1, never below 0', async () => {
    const off = await deleteReaction('post-1', 'repost', { active: true, count: 8 })
    expect(off.active).toBe(false)
    expect(off.counts.repost).toBe(7)
    expect(off.viewer.reposted).toBe(false)

    const floor = await deleteReaction('post-1', 'repost', { active: true, count: 0 })
    expect(floor.counts.repost).toBe(0)
  })

  it('is idempotent: a repeat PUT / DELETE moves nothing', async () => {
    const again = await putReaction('post-1', 'like', { active: true, count: 43 })
    expect(again.active).toBe(true)
    expect(again.counts.like).toBe(43)

    const noop = await deleteReaction('post-1', 'like', { active: false, count: 42 })
    expect(noop.active).toBe(false)
    expect(noop.counts.like).toBe(42)
  })

  it('goes through the shared axios client with the contract URL and no body', async () => {
    const put = vi.spyOn(api, 'put')
    const del = vi.spyOn(api, 'delete')

    await putReaction('post-9', 'repost', { active: false, count: 1 })
    await deleteReaction('post-9', 'repost', { active: true, count: 2 })

    expect(put).toHaveBeenCalledWith(
      '/posts/post-9/reactions/repost',
      undefined,
      expect.objectContaining({ adapter: expect.any(Function) }),
    )
    expect(del).toHaveBeenCalledWith(
      '/posts/post-9/reactions/repost',
      expect.objectContaining({ adapter: expect.any(Function) }),
    )
  })
})

describe('reactionService (mock) — test-only failure switch', () => {
  it('rejects every write with an AxiosError 503 until reset', async () => {
    setMockReactionFailure(true)

    const error = await putReaction('post-1', 'like', { active: false, count: 1 }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(AxiosError)
    expect(error instanceof AxiosError ? error.response?.status : undefined).toBe(503)
    await expect(deleteReaction('post-1', 'like', { active: true, count: 1 })).rejects.toBeInstanceOf(
      AxiosError,
    )

    setMockReactionFailure(false)
    await expect(putReaction('post-1', 'like', { active: false, count: 1 })).resolves.toBeDefined()
  })

  it('resetMockReactions clears the switch', async () => {
    setMockReactionFailure(true)
    resetMockReactions()

    await expect(putReaction('post-1', 'like', { active: false, count: 1 })).resolves.toBeDefined()
  })
})

describe('reactionService (mock) — persistence', () => {
  it('is OFF under Vitest: nothing is remembered, so no test can leak into another', async () => {
    await putReaction('post-leak', 'like', { active: false, count: 1 })

    expect(mockReactionSnapshot('post-leak', 'like')).toBeUndefined()
  })

  it('remembers the result when a test opts in, per post and per kind', async () => {
    resetMockReactions({ persist: true })

    await putReaction('post-1', 'like', { active: false, count: 41 })
    await putReaction('post-1', 'repost', { active: false, count: 7 })

    expect(mockReactionSnapshot('post-1', 'like')).toEqual({ active: true, count: 42 })
    expect(mockReactionSnapshot('post-1', 'repost')).toEqual({ active: true, count: 8 })
    expect(mockReactionSnapshot('post-2', 'like')).toBeUndefined()
  })

  it('fills the OTHER kind of the response from what it remembers', async () => {
    resetMockReactions({ persist: true })
    await putReaction('post-1', 'like', { active: false, count: 41 })

    const repost = await putReaction('post-1', 'repost', { active: false, count: 7 })

    expect(repost.counts).toEqual({ reply: 0, like: 42, repost: 8 })
    expect(repost.viewer).toEqual({ liked: true, reposted: true })
  })

  it('resetMockReactions forgets everything', async () => {
    resetMockReactions({ persist: true })
    await putReaction('post-1', 'like', { active: false, count: 41 })

    resetMockReactions({ persist: true })

    expect(mockReactionSnapshot('post-1', 'like')).toBeUndefined()
  })
})
