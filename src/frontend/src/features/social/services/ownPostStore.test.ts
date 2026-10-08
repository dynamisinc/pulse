/**
 * features/social/services/ownPostStore.test.ts
 * ---------------------------------------------------------------------------
 * The viewer's own just-published posts (demo-polish F4, story 13 "Own post appears
 * instantly"; XC-002): registration is idempotent by id and newest-first, the
 * snapshot is referentially stable between changes (so `useSyncExternalStore` and
 * `<Feed>`'s memoization are safe), subscribers hear each real change once, and
 * `narrowCreatedPost` rebuilds the 201 body — which may be the STAFF provenance
 * shape — as a participant-safe view with none of the provenance keys.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreatedPostView, ParticipantPostView, StaffPostView } from '../types/post'
import { OWN_POST_CAP, narrowCreatedPost, ownPostStore } from './ownPostStore'

function view(id: string): ParticipantPostView {
  return {
    id,
    authorPersonaId: 'persona-dreyes_fh',
    text: `post ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T15:00:00Z',
  }
}

afterEach(() => {
  ownPostStore.resetForTests()
})

describe('ownPostStore', () => {
  it('registers posts newest-first and answers has()', () => {
    ownPostStore.add(view('a'))
    ownPostStore.add(view('b'))

    expect(ownPostStore.getAll().map(v => v.id)).toEqual(['b', 'a'])
    expect(ownPostStore.has('a')).toBe(true)
    expect(ownPostStore.has('nope')).toBe(false)
  })

  it('is idempotent by id: a second add changes nothing and wakes nobody', () => {
    const listener = vi.fn()
    ownPostStore.subscribe(listener)
    ownPostStore.add(view('a'))
    const snapshot = ownPostStore.getAll()

    ownPostStore.add(view('a'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(ownPostStore.getAll()).toBe(snapshot)
  })

  it('keeps a stable snapshot between changes and swaps it on add', () => {
    const empty = ownPostStore.getAll()
    expect(ownPostStore.getAll()).toBe(empty)

    ownPostStore.add(view('a'))

    expect(ownPostStore.getAll()).not.toBe(empty)
  })

  it('notifies subscribers once per registration, and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = ownPostStore.subscribe(listener)

    ownPostStore.add(view('a'))
    ownPostStore.add(view('b'))
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    ownPostStore.add(view('c'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('is bounded: the oldest registrations fall off past the cap', () => {
    for (let i = 0; i < OWN_POST_CAP + 5; i += 1) ownPostStore.add(view(`p${i}`))

    const all = ownPostStore.getAll()
    expect(all).toHaveLength(OWN_POST_CAP)
    expect(all[0]?.id).toBe(`p${OWN_POST_CAP + 4}`)
    expect(ownPostStore.has('p0')).toBe(false)
  })
})

describe('narrowCreatedPost — the 201 body becomes participant-safe state (XC-002)', () => {
  const STAFF: StaffPostView = {
    id: 'post-1',
    authorPersonaId: 'persona-fulcoem',
    text: 'Advisory lifted.',
    counts: { reply: 1, repost: 2, like: 3 },
    scenarioTime: '2033-09-04T15:00:00Z',
    exerciseId: 'ex-1',
    actingHumanId: 'human-1',
    origin: 'controller-as-persona',
    injectId: '042',
    createdWallClock: '2026-10-08T00:00:00.000Z',
  }

  it('drops every staff-only provenance key from a staff-shaped body', () => {
    const narrowed = narrowCreatedPost(STAFF)

    for (const key of ['exerciseId', 'actingHumanId', 'origin', 'injectId', 'createdWallClock']) {
      expect(narrowed).not.toHaveProperty(key)
    }
    expect(Object.keys(narrowed).sort()).toEqual(
      ['authorPersonaId', 'counts', 'id', 'scenarioTime', 'text'],
    )
  })

  it('drops a stray unknown key too (never a spread)', () => {
    const body = { ...STAFF, sneaky: 'secret' } as CreatedPostView

    expect(narrowCreatedPost(body)).not.toHaveProperty('sneaky')
  })

  it('carries the participant-safe optional members, rebuilt member by member', () => {
    const narrowed = narrowCreatedPost({
      ...STAFF,
      media: [{
        id: 'm1',
        kind: 'image',
        url: 'https://blob/m1',
        alt: 'A road',
        width: 800,
        height: 600,
      }],
      inReplyTo: { postId: 'post-0', authorHandle: 'FulcoEM' },
      viewer: { liked: false, reposted: true },
      linkPreview: { title: 'T', domain: 'newsline7.news' },
    })

    expect(narrowed.media).toEqual([{
      id: 'm1',
      kind: 'image',
      url: 'https://blob/m1',
      alt: 'A road',
      width: 800,
      height: 600,
    }])
    expect(narrowed.inReplyTo).toEqual({ postId: 'post-0', authorHandle: 'FulcoEM' })
    expect(narrowed.viewer).toEqual({ liked: false, reposted: true })
    expect(narrowed.linkPreview).toEqual({ title: 'T', domain: 'newsline7.news' })
  })

  it('treats a null optional member as absent', () => {
    const body = {
      ...STAFF,
      media: null,
      inReplyTo: null,
      viewer: null,
      linkPreview: null,
    } as unknown as CreatedPostView

    const narrowed = narrowCreatedPost(body)

    for (const key of ['media', 'inReplyTo', 'viewer', 'linkPreview']) {
      expect(narrowed).not.toHaveProperty(key)
    }
  })
})
