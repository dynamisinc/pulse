/**
 * features/controller/hooks/useRemovedPostIds.test.tsx
 * ---------------------------------------------------------------------------
 * The console's reactive read of "which posts are taken down" (demo-polish C5, story 22), the seam
 * the orchestrator wires to the Live world column's `isRowRemoved` prop:
 *  - `useRemovedPostIds` returns a stable Set that changes identity only when a removal is recorded
 *    (or the session is reset), and re-renders its caller then;
 *  - `useIsRowRemoved` returns a predicate whose identity is stable between removals and new after
 *    each one, answering true exactly for removed ids - so a memoized column re-renders on a
 *    takedown and not otherwise;
 *  - both reflect a takedown made by this console and one recorded by a push, and the sign-out
 *    reset;
 *  - `isPostRemoved` is the plain non-reactive read of the same store.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { removedPosts } from '@/features/social/services/removedPosts'
import { isPostRemoved } from '../services/takedownService'
import { useIsRowRemoved, useRemovedPostIds } from './useRemovedPostIds'

afterEach(() => {
  removedPosts.resetForTests()
})

describe('useRemovedPostIds', () => {
  it('starts empty and keeps the SAME set across unrelated re-renders', () => {
    const { result, rerender } = renderHook(() => useRemovedPostIds())
    const first = result.current
    expect(first.size).toBe(0)

    rerender()

    expect(result.current).toBe(first)
  })

  it('re-renders with a new set when a removal is recorded, and not for a repeat', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useRemovedPostIds()
    })
    const before = result.current
    const rendersBefore = renders

    act(() => removedPosts.add('post-1'))
    const after = result.current
    expect(after).not.toBe(before)
    expect(after.has('post-1')).toBe(true)
    expect(renders).toBe(rendersBefore + 1)

    act(() => removedPosts.add('post-1'))
    expect(result.current).toBe(after)
    expect(renders).toBe(rendersBefore + 1)
  })

  it('reflects the sign-out reset on its next render (the reset itself is silent)', () => {
    removedPosts.add('post-1')
    const { result, rerender } = renderHook(() => useRemovedPostIds())
    expect(result.current.has('post-1')).toBe(true)

    act(() => removedPosts.reset())
    // Gate-2 B L-3: `reset()` notifies nobody - sign-out unmounts the consumers, and a blocking
    // notify could repaint a taken-down post for a frame before the navigation commits.
    rerender()

    expect(result.current.size).toBe(0)
  })
})

describe('useIsRowRemoved', () => {
  it('answers true exactly for removed ids', () => {
    removedPosts.add('post-gone')
    const { result } = renderHook(() => useIsRowRemoved())

    expect(result.current({ id: 'post-gone' })).toBe(true)
    expect(result.current({ id: 'post-here' })).toBe(false)
  })

  it('keeps the SAME predicate between removals and hands out a NEW one after each', () => {
    const { result, rerender } = renderHook(() => useIsRowRemoved())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)

    act(() => removedPosts.add('post-1'))

    expect(result.current).not.toBe(first)
    expect(result.current({ id: 'post-1' })).toBe(true)
    // The earlier predicate is a snapshot: it never changes its mind.
    expect(first({ id: 'post-1' })).toBe(false)
  })

  it('takes anything with an id - a LiveWorldPost satisfies it', () => {
    removedPosts.add('post-1')
    const { result } = renderHook(() => useIsRowRemoved())
    const row = { id: 'post-1', authorHandle: 'x', text: 'ignored' }
    expect(result.current(row)).toBe(true)
  })
})

describe('isPostRemoved', () => {
  it('is the plain read of the same store', () => {
    expect(isPostRemoved('post-1')).toBe(false)
    removedPosts.add('post-1')
    expect(isPostRemoved('post-1')).toBe(true)
  })
})
