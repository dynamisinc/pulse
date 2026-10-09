/**
 * features/social/services/removedPosts.test.ts
 * ---------------------------------------------------------------------------
 * The session's taken-down post ids (demo-polish C5, story 22; CTL-025, XC-002, COR-001):
 *  - `add` records an id; `has` reads it; a repeat, an empty or a non-string id changes nothing
 *    and wakes nobody;
 *  - `getAll()` is a REFERENTIALLY-STABLE read-only snapshot - the same Set until a change - so a
 *    `useSyncExternalStore` read never loops, and an earlier snapshot is never mutated;
 *  - subscribers hear each change once; the unsubscribe stops it;
 *  - the store is bounded: past the cap the OLDEST id is forgotten, the newest survive;
 *  - `reset()` (sign-out) forgets everything and tells NOBODY (Gate-2 B L-3: a notify here is a
 *    blocking update that can repaint a taken-down post for a frame before the router's
 *    transition navigates to /login); a reset of an empty store keeps the snapshot;
 *  - it holds ids and nothing else (no content to retain: XC-002).
 */
import { useSyncExternalStore } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REMOVED_POST_CAP, removedPosts } from './removedPosts'

afterEach(() => {
  removedPosts.resetForTests()
})

describe('removedPosts - recording', () => {
  it('records an id and reports it', () => {
    expect(removedPosts.has('post-1')).toBe(false)

    removedPosts.add('post-1')

    expect(removedPosts.has('post-1')).toBe(true)
    expect(removedPosts.has('post-2')).toBe(false)
    expect([...removedPosts.getAll()]).toEqual(['post-1'])
  })

  it('ignores a repeat, an empty id and a non-string id - and wakes nobody for them', () => {
    removedPosts.add('post-1')
    const heard = vi.fn()
    removedPosts.subscribe(heard)

    removedPosts.add('post-1')
    removedPosts.add('')
    removedPosts.add(42 as unknown as string)

    expect(heard).not.toHaveBeenCalled()
    expect(removedPosts.getAll().size).toBe(1)
  })

  it('treats ids as opaque (the mock backend\'s ids are not GUIDs)', () => {
    removedPosts.add('post-7b2c')
    removedPosts.add('3f2504e0-4f89-11d3-9a0c-0305e82c3301')
    expect(removedPosts.has('post-7b2c')).toBe(true)
    expect(removedPosts.has('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true)
  })
})

describe('removedPosts - snapshot and subscription', () => {
  it('returns the SAME snapshot until something changes, and never mutates an earlier one', () => {
    const empty = removedPosts.getAll()
    expect(removedPosts.getAll()).toBe(empty)

    removedPosts.add('post-1')
    const one = removedPosts.getAll()
    expect(one).not.toBe(empty)
    expect(empty.size).toBe(0)
    expect(removedPosts.getAll()).toBe(one)

    removedPosts.add('post-1')
    expect(removedPosts.getAll()).toBe(one)

    removedPosts.add('post-2')
    expect(removedPosts.getAll()).not.toBe(one)
    expect(one.size).toBe(1)
  })

  it('notifies each subscriber once per change, and stops after the unsubscribe', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = removedPosts.subscribe(first)
    removedPosts.subscribe(second)

    removedPosts.add('post-1')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    stopFirst()
    removedPosts.add('post-2')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('has already recorded the id by the time a subscriber is told (feed focus logic relies on it)', () => {
    let seen: boolean | undefined
    removedPosts.subscribe(() => {
      seen = removedPosts.has('post-1')
    })
    removedPosts.add('post-1')
    expect(seen).toBe(true)
  })
})

describe('removedPosts - bounds and reset', () => {
  it('is bounded: past the cap the oldest id is forgotten and the newest survive', () => {
    for (let i = 0; i < REMOVED_POST_CAP + 5; i += 1) removedPosts.add(`post-${i}`)

    expect(removedPosts.getAll().size).toBe(REMOVED_POST_CAP)
    expect(removedPosts.has('post-0')).toBe(false)
    expect(removedPosts.has('post-4')).toBe(false)
    expect(removedPosts.has('post-5')).toBe(true)
    expect(removedPosts.has(`post-${REMOVED_POST_CAP + 4}`)).toBe(true)
  })

  it('reset() forgets every id and tells NOBODY (Gate-2 B L-3)', () => {
    removedPosts.add('post-1')
    removedPosts.add('post-2')
    const heard = vi.fn()
    removedPosts.subscribe(heard)
    heard.mockClear()

    removedPosts.reset()

    expect(removedPosts.has('post-1')).toBe(false)
    expect(removedPosts.getAll().size).toBe(0)
    expect(heard).not.toHaveBeenCalled()
  })

  it('reset() does not re-render a mounted consumer (so sign-out cannot repaint a removed post)', () => {
    removedPosts.add('post-1')
    let renders = 0
    const view = renderHook(() => {
      renders += 1
      return useSyncExternalStore(removedPosts.subscribe, removedPosts.getAll)
    })
    expect(view.result.current.has('post-1')).toBe(true)
    const before = renders

    act(() => removedPosts.reset())

    expect(renders).toBe(before)
    // ... yet the NEXT render reads the new, empty snapshot (no stale set survives).
    view.rerender()
    expect(view.result.current.size).toBe(0)
  })

  it('reset() of an empty store wakes nobody and keeps the snapshot', () => {
    const snapshot = removedPosts.getAll()
    const heard = vi.fn()
    removedPosts.subscribe(heard)

    removedPosts.reset()

    expect(heard).not.toHaveBeenCalled()
    expect(removedPosts.getAll()).toBe(snapshot)
  })

  it('keeps its subscribers across a reset (they are mounted components, which unmount themselves)', () => {
    const heard = vi.fn()
    removedPosts.subscribe(heard)
    removedPosts.add('post-1')
    removedPosts.reset()
    removedPosts.add('post-2')
    // Two adds heard; the reset between them was silent.
    expect(heard).toHaveBeenCalledTimes(2)
  })
})

describe('removedPosts - what it holds (XC-002)', () => {
  it('holds opaque ids only: nothing but strings, no content', () => {
    removedPosts.add('post-1')
    for (const entry of removedPosts.getAll()) expect(typeof entry).toBe('string')
  })
})
