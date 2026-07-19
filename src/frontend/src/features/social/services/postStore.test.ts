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
 *    read path's job (XC-002), never the store's.
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
