/**
 * features/social/edit/editedPostsStore.test.ts
 * ---------------------------------------------------------------------------
 * The version-gated edited-post overlay (story 20; DF-33): a newer frame wins, a stale or
 * replayed one is dropped, a fresher card read beats an older override, an optimistic text shows
 * and clears, and `reset()` forgets everything AND ignores a save that started before it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editedPostsStore, type PostEditedEvent } from './editedPostsStore'

function frame(version: number, text = `v${version}`, postId = 'p1'): PostEditedEvent {
  return {
    postId,
    text,
    edited: { count: version, scenarioTime: `2033-09-04T10:0${version}:00Z` },
    version,
  }
}

afterEach(() => editedPostsStore.resetForTests())

describe('editedPostsStore version gate', () => {
  it('applies a newer frame and exposes text + edited', () => {
    expect(editedPostsStore.apply(frame(1))).toBe(true)

    expect(editedPostsStore.get('p1')).toEqual({
      text: 'v1',
      edited: { count: 1, scenarioTime: '2033-09-04T10:01:00Z' },
    })
  })

  it('drops a stale, a replayed and an equal frame', () => {
    editedPostsStore.apply(frame(3))

    expect(editedPostsStore.apply(frame(2))).toBe(false)
    expect(editedPostsStore.apply(frame(3, 'replay'))).toBe(false)
    expect(editedPostsStore.get('p1').text).toBe('v3')
    expect(editedPostsStore.apply(frame(4))).toBe(true)
    expect(editedPostsStore.get('p1').text).toBe('v4')
  })

  it('keeps posts independent', () => {
    editedPostsStore.apply(frame(2, 'a', 'p1'))
    editedPostsStore.apply(frame(1, 'b', 'p2'))

    expect(editedPostsStore.get('p1').text).toBe('a')
    expect(editedPostsStore.get('p2').text).toBe('b')
    expect(editedPostsStore.get('p3')).toEqual({})
  })

  it('only notifies and re-snapshots the post that changed', () => {
    editedPostsStore.apply(frame(1, 'a', 'p1'))
    const other = editedPostsStore.get('p2')
    const first = editedPostsStore.get('p1')
    const listener = vi.fn()
    editedPostsStore.subscribe(listener)

    editedPostsStore.apply(frame(2, 'a2', 'p1'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(editedPostsStore.get('p2')).toBe(other)
    expect(editedPostsStore.get('p1')).not.toBe(first)
    expect(editedPostsStore.get('p1')).toBe(editedPostsStore.get('p1'))
  })
})

describe('editedPostsStore base, pending and reset', () => {
  it('shows the card base summary until a push overrides it', () => {
    editedPostsStore.noteBase('p1', { count: 1, scenarioTime: '2033-09-04T10:01:00Z' })
    expect(editedPostsStore.get('p1').edited?.count).toBe(1)

    // A frame at or below the base is stale; above it applies.
    expect(editedPostsStore.apply(frame(1))).toBe(false)
    expect(editedPostsStore.apply(frame(2))).toBe(true)
    expect(editedPostsStore.get('p1').edited?.count).toBe(2)
  })

  it('lets a fresher read (higher count) beat an older override', () => {
    editedPostsStore.apply(frame(1, 'old'))
    editedPostsStore.noteBase('p1', { count: 2, scenarioTime: '2033-09-04T10:02:00Z' })

    expect(editedPostsStore.get('p1').text).toBeUndefined()
    expect(editedPostsStore.get('p1').edited?.count).toBe(2)
  })

  it('moves an override up to a fresher read\'s text instead of dropping it (no fall back)', () => {
    editedPostsStore.apply(frame(1, 'v1 text'))

    editedPostsStore.noteBase('p1', { count: 2, scenarioTime: '2033-09-04T10:02:00Z' }, 'v2 text')

    // Another mounted card, still holding older props, reads the override: v2, not v1 or original.
    expect(editedPostsStore.get('p1').text).toBe('v2 text')
    expect(editedPostsStore.get('p1').edited?.count).toBe(2)
    // A frame at or below the new version is stale.
    expect(editedPostsStore.apply(frame(2, 'replay'))).toBe(false)
    expect(editedPostsStore.apply(frame(3, 'v3 text'))).toBe(true)
  })

  it('shows a pending text immediately, clears it, and lets the applied frame replace it', () => {
    editedPostsStore.setPendingText('p1', 'optimistic')
    expect(editedPostsStore.get('p1').text).toBe('optimistic')

    editedPostsStore.setPendingText('p1', null)
    expect(editedPostsStore.get('p1').text).toBeUndefined()

    editedPostsStore.setPendingText('p1', 'optimistic')
    editedPostsStore.apply(frame(1, 'server'))
    expect(editedPostsStore.get('p1').text).toBe('server')
  })

  it('forgets everything on reset and ignores a save from the previous generation', () => {
    const generation = editedPostsStore.getGeneration()
    editedPostsStore.apply(frame(2))
    editedPostsStore.noteBase('p9', { count: 1, scenarioTime: '2033-09-04T10:01:00Z' })

    editedPostsStore.reset()

    expect(editedPostsStore.get('p1')).toEqual({})
    expect(editedPostsStore.get('p9')).toEqual({})
    expect(editedPostsStore.getGeneration()).toBe(generation + 1)
    expect(editedPostsStore.apply(frame(5), generation)).toBe(false)
    editedPostsStore.setPendingText('p1', 'late', generation)
    expect(editedPostsStore.get('p1')).toEqual({})
    // A frame for the new generation still works, from version 1 again.
    expect(editedPostsStore.apply(frame(1))).toBe(true)
  })
})
