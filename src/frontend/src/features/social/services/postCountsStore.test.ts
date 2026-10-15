/**
 * features/social/services/postCountsStore.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback story 14 (DF-17 / DF-18): the version-gated live counts store.
 *
 *  - ORDERING: a frame is kept only when its version is higher than the one held, so a stale,
 *    replayed or reordered frame never winds a number back.
 *  - `usePostCounts` returns the newest of the card's seed and the store, by observation order.
 *  - SIGN-OUT: `resetClientSession()` (the sign-out path) forgets every frame, and its reset
 *    generation drops a late frame from a request (or mock toggle) started before it.
 *  - WIRING: the default engagement source (the mock adapter under mock data) lands in the store,
 *    and the mock adapter emits on a mock like / repost / reply.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientSession } from '@/core/auth/endSession'
import type { Post } from '../types/post'
import { postCountsStore, usePostCounts } from './postCountsStore'
import { emitMockReactionEngagement, setMockEngagementForTests } from './mockEngagementChanges'
import { postStore } from './postStore'
import { defaultEngagementChangeSource } from './realtimeFeed'

const SEED = { reply: 1, repost: 2, like: 3 }

beforeEach(() => {
  postCountsStore.reset()
})

afterEach(() => {
  setMockEngagementForTests(false)
  postStore.resetForTests()
  postCountsStore.reset()
})

describe('postCountsStore.apply (version-gated)', () => {
  it('keeps a newer frame and drops an older or equal one', () => {
    expect(postCountsStore.apply('p1', { reply: 0, repost: 0, like: 5 }, 10)).toBe(true)
    expect(postCountsStore.apply('p1', { reply: 0, repost: 0, like: 4 }, 9)).toBe(false)
    expect(postCountsStore.apply('p1', { reply: 0, repost: 0, like: 4 }, 10)).toBe(false)
    expect(postCountsStore.get('p1')).toEqual({ counts: { reply: 0, repost: 0, like: 5 }, version: 10 })

    expect(postCountsStore.apply('p1', { reply: 0, repost: 0, like: 4 }, 11)).toBe(true)
    expect(postCountsStore.get('p1')?.counts.like).toBe(4)
  })

  it('gates each post on its own version', () => {
    postCountsStore.apply('p1', { reply: 0, repost: 0, like: 5 }, 10)
    expect(postCountsStore.apply('p2', { reply: 0, repost: 0, like: 1 }, 1)).toBe(true)
  })

  it('tells only the listeners of the post that changed, and only for a kept frame', () => {
    const p1 = vi.fn()
    const p2 = vi.fn()
    const off = postCountsStore.subscribe('p1', p1)
    postCountsStore.subscribe('p2', p2)

    postCountsStore.apply('p1', SEED, 1)
    postCountsStore.apply('p1', SEED, 1)
    expect(p1).toHaveBeenCalledTimes(1)
    expect(p2).not.toHaveBeenCalled()

    off()
    postCountsStore.apply('p1', SEED, 2)
    expect(p1).toHaveBeenCalledTimes(1)
  })

  it('stores only the three counts, whatever else the caller object carried', () => {
    const noisy = { ...SEED, viewer: { liked: true } } as unknown as typeof SEED
    postCountsStore.apply('p1', noisy, 1)
    expect(postCountsStore.get('p1')?.counts).toEqual(SEED)
  })
})

describe('usePostCounts', () => {
  it('returns the seed while the store holds nothing for the post', () => {
    const { result } = renderHook(() => usePostCounts('p1', SEED))
    expect(result.current).toEqual(SEED)
  })

  it('switches to a frame that arrives after the card rendered', () => {
    const { result } = renderHook(() => usePostCounts('p1', SEED))

    act(() => {
      postCountsStore.apply('p1', { reply: 1, repost: 2, like: 4 }, 7)
    })

    expect(result.current).toEqual({ reply: 1, repost: 2, like: 4 })
  })

  it('lets a later re-seed (a fresher read) win over an earlier frame, until the next frame', () => {
    const { result, rerender } = renderHook(({ seed }) => usePostCounts('p1', seed), {
      initialProps: { seed: SEED },
    })
    act(() => {
      postCountsStore.apply('p1', { reply: 1, repost: 2, like: 4 }, 7)
    })

    rerender({ seed: { reply: 1, repost: 2, like: 6 } })
    expect(result.current.like).toBe(6)

    rerender({ seed: { reply: 1, repost: 2, like: 6 } })
    expect(result.current.like).toBe(6)

    act(() => {
      postCountsStore.apply('p1', { reply: 1, repost: 2, like: 7 }, 8)
    })
    expect(result.current.like).toBe(7)
  })

  it('ignores a stale frame', () => {
    postCountsStore.apply('p1', { reply: 1, repost: 2, like: 9 }, 20)
    const { result } = renderHook(() => usePostCounts('p1', SEED))
    expect(result.current.like).toBe(9)

    act(() => {
      postCountsStore.apply('p1', { reply: 1, repost: 2, like: 8 }, 19)
    })
    expect(result.current.like).toBe(9)
  })
})

describe('sign-out', () => {
  it('resetClientSession() forgets every frame and the cards fall back to their seed', () => {
    postCountsStore.apply('p1', { reply: 1, repost: 2, like: 9 }, 20)
    const { result } = renderHook(() => usePostCounts('p1', SEED))
    expect(result.current.like).toBe(9)

    act(() => {
      resetClientSession()
    })

    expect(postCountsStore.get('p1')).toBeUndefined()
    expect(result.current).toEqual(SEED)
    // The next identity starts clean: a low version is accepted again.
    expect(postCountsStore.apply('p1', SEED, 1)).toBe(true)
  })
})

describe('reset generation (the pinState pattern)', () => {
  it('bumps on every reset, even an empty store, and drops a frame from a request started before it', () => {
    const before = postCountsStore.generation()
    postCountsStore.reset()
    expect(postCountsStore.generation()).toBe(before + 1)

    // A request that started under the previous identity answers after the reset: dropped.
    const stale = before
    expect(postCountsStore.apply('p1', SEED, 5, stale)).toBe(false)
    expect(postCountsStore.get('p1')).toBeUndefined()

    // One that started after it lands.
    expect(postCountsStore.apply('p1', SEED, 5, postCountsStore.generation())).toBe(true)
  })

  it('a mock toggle that settles after a sign-out pushes nothing into the next session', () => {
    setMockEngagementForTests(true)
    const heard = vi.fn()
    const off = defaultEngagementChangeSource.subscribeEngagementChanged(heard)

    const startedAt = postCountsStore.generation()
    act(() => {
      resetClientSession()
    })
    emitMockReactionEngagement('mock-1', 'like', 3, startedAt)

    expect(heard).not.toHaveBeenCalled()
    expect(postCountsStore.get('mock-1')).toBeUndefined()
    off()
  })
})

describe('mock engagement source (USE_MOCK_DATA)', () => {
  function seedPost(id: string, counts: { reply: number; repost: number; like: number }): Post {
    return {
      id,
      authorPersonaId: 'persona-a',
      text: 'a post',
      scenarioTime: '2033-09-04T09:30:00Z',
      counts,
      origin: 'participant',
      actingHumanId: 'human-a',
      createdWallClock: '2026-10-15T12:00:00Z',
    } as Post
  }

  it('emits on a mock like (keeping the other counts) and lands in the store', () => {
    postStore.appendPost(seedPost('mock-1', { reply: 4, repost: 1, like: 2 }))
    setMockEngagementForTests(true)
    const heard = vi.fn()
    const off = defaultEngagementChangeSource.subscribeEngagementChanged(heard)

    emitMockReactionEngagement('mock-1', 'like', 3)

    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0]?.[0]).toMatchObject({
      postId: 'mock-1',
      counts: { reply: 4, repost: 1, like: 3 },
    })
    expect(postCountsStore.get('mock-1')?.counts).toEqual({ reply: 4, repost: 1, like: 3 })

    emitMockReactionEngagement('mock-1', 'repost', 2)
    expect(postCountsStore.get('mock-1')?.counts).toEqual({ reply: 4, repost: 2, like: 3 })
    off()
  })

  it("emits the parent's new reply count when a mock reply is appended", () => {
    postStore.appendPost(seedPost('parent-1', { reply: 0, repost: 0, like: 1 }))
    setMockEngagementForTests(true)
    const heard = vi.fn()
    const off = defaultEngagementChangeSource.subscribeEngagementChanged(heard)

    postStore.appendPost({
      ...seedPost('reply-1', { reply: 0, repost: 0, like: 0 }),
      inReplyTo: { postId: 'parent-1', authorHandle: 'someone' },
    })

    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0]?.[0]).toMatchObject({
      postId: 'parent-1',
      counts: { reply: 1, repost: 0, like: 1 },
    })
    off()
  })

  it('emits nothing while off (the Vitest default)', () => {
    setMockEngagementForTests(false)
    const heard = vi.fn()
    const off = defaultEngagementChangeSource.subscribeEngagementChanged(heard)
    emitMockReactionEngagement('mock-1', 'like', 3)
    expect(heard).not.toHaveBeenCalled()
    off()
  })
})
