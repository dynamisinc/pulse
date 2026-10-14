/**
 * features/social/services/postStore.test.ts
 * ---------------------------------------------------------------------------
 * Covers the live post store (feeds-discovery/07; SOC-083 partial, COR-001,
 * XC-002):
 *  - seeded once from `listPosts()`; `appendPost` + `getPosts()` return the
 *    baseline plus the appended post in INSERTION order (sorting is
 *    `assembleFeedView`'s job, not the store's);
 *  - `getPosts()` returns a referentially-stable snapshot between appends and a
 *    NEW identity after one (so subscribers can memoize / avoid a read loop);
 *  - `subscribe` notifies on append and the returned unsubscribe stops it;
 *  - `resetForTests()` restores the seeded baseline and clears listeners (no
 *    cross-test pollution);
 *  - the store holds FULL `Post` records (provenance intact) — narrowing is the
 *    read path's job (XC-002), never the store's;
 *  - `removePost` (demo-polish C5, the mock-mode takedown's soft delete) removes by id, swaps
 *    the snapshot and notifies; an unknown id changes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listPosts, type Post } from '@/features/social'
import { postStore } from './postStore'

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-appended',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-simcell-utility',
    text: 'appended post',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T15:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

afterEach(() => {
  postStore.resetForTests()
})

describe('postStore — seeding & append', () => {
  it('is seeded from listPosts()', () => {
    expect(postStore.getPosts().map(p => p.id)).toEqual(listPosts().map(p => p.id))
  })

  it('appends a post AFTER the seeded baseline, in insertion order', () => {
    const baselineLength = listPosts().length
    postStore.appendPost(buildPost({ id: 'first' }))
    postStore.appendPost(buildPost({ id: 'second' }))

    const ids = postStore.getPosts().map(p => p.id)
    expect(ids).toHaveLength(baselineLength + 2)
    // Store does NOT sort — insertion order, seeded baseline first.
    expect(ids.slice(-2)).toEqual(['first', 'second'])
  })

  it('holds the FULL Post record (provenance intact — narrowing is the read path)', () => {
    postStore.appendPost(buildPost({ id: 'with-provenance', origin: 'inject', injectId: '042' }))
    const stored = postStore.getPosts().find(p => p.id === 'with-provenance')
    expect(stored?.origin).toBe('inject')
    expect(stored?.injectId).toBe('042')
    expect(stored?.actingHumanId).toBe('human-simcell-utility')
  })
})

describe('postStore — snapshot identity', () => {
  it('returns a stable reference between appends and a new one after an append', () => {
    const before = postStore.getPosts()
    expect(postStore.getPosts()).toBe(before) // stable — no read loop

    postStore.appendPost(buildPost())
    expect(postStore.getPosts()).not.toBe(before) // new identity after append
  })
})

describe('postStore — subscription', () => {
  it('notifies subscribers on append and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = postStore.subscribe(listener)

    postStore.appendPost(buildPost({ id: 'a' }))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    postStore.appendPost(buildPost({ id: 'b' }))
    expect(listener).toHaveBeenCalledTimes(1) // no further calls after unsubscribe
  })
})

describe('postStore — resetForTests', () => {
  it('restores the seeded baseline and clears listeners', () => {
    const listener = vi.fn()
    postStore.subscribe(listener)
    postStore.appendPost(buildPost())
    expect(postStore.getPosts().length).toBeGreaterThan(listPosts().length)

    postStore.resetForTests()

    expect(postStore.getPosts().map(p => p.id)).toEqual(listPosts().map(p => p.id))
    postStore.appendPost(buildPost())
    // The pre-reset listener was cleared, so it saw only the pre-reset append.
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('postStore - removePost (C5 mock-mode takedown)', () => {
  it('removes the post by id, swaps the snapshot and notifies subscribers', () => {
    postStore.appendPost(buildPost({ id: 'post-to-remove' }))
    const before = postStore.getPosts()
    const heard = vi.fn()
    postStore.subscribe(heard)

    expect(postStore.removePost('post-to-remove')).toBe(true)

    expect(postStore.getPosts().some(post => post.id === 'post-to-remove')).toBe(false)
    expect(postStore.getPosts()).not.toBe(before)
    expect(before.some(post => post.id === 'post-to-remove')).toBe(true)
    expect(postStore.getPosts()).toHaveLength(listPosts().length)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('answers false for an unknown id and changes nothing (no snapshot swap, no notification)', () => {
    const before = postStore.getPosts()
    const heard = vi.fn()
    postStore.subscribe(heard)

    expect(postStore.removePost('never-existed')).toBe(false)

    expect(postStore.getPosts()).toBe(before)
    expect(heard).not.toHaveBeenCalled()
  })

  it('leaves replies that pointed at the removed post alone (the server does not cascade)', () => {
    postStore.appendPost(buildPost({ id: 'parent-post' }))
    postStore.appendPost(buildPost({ id: 'child-reply', parentPostId: 'parent-post' }))

    postStore.removePost('parent-post')

    expect(postStore.getPosts().some(post => post.id === 'child-reply')).toBe(true)
  })
})
