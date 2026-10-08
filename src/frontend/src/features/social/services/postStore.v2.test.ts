/**
 * features/social/services/postStore.v2.test.ts
 * ---------------------------------------------------------------------------
 * The post store under CONTRACT v2 (demo-polish F0): replies are posts carrying
 * `inReplyTo`; `appendPost` LINKS a freshly created reply (`parentPostId`, as
 * `createPost` produces) to its parent — resolving the parent author's handle —
 * and bumps the parent's reply count with a NEW parent object (same id, so the
 * live pill never re-emits it). The default seed stays the canonical six.
 *
 * The STREAM view of that (demo-polish F4): the ARRIVAL source emits the linked reply
 * exactly once (that is what a thread listens to) and never the bumped parent, while
 * the FEED/pill source drops the reply altogether - a reply never raises the pill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetMockMediaRegistry } from '@/core/media'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '../types/post'
import { createPost, listPosts } from './postService'
import { postStore } from './postStore'
import { makeMockArrivalSource, makeMockPostStoreSource } from './feedStreamSource'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

function reply(parentPostId: string, overrides: Partial<Post> = {}): Post {
  return {
    ...createPost({
      exerciseId: 'ex-mock-0001',
      timeZone: 'America/New_York',
      scenarioTime: '2033-09-04T16:00:00Z',
      authorPersonaId: personaIdForHandle('dreyes_fh'),
      actingHumanId: 'human-dreyes',
      text: 'a reply',
      origin: 'participant',
      parentPostId,
    }),
    ...overrides,
  }
}

function byId(id: string): Post {
  const post = postStore.getPosts().find(p => p.id === id)
  if (post === undefined) throw new Error(`missing ${id}`)
  return post
}

afterEach(() => {
  postStore.resetForTests()
  resetMockMediaRegistry()
})

describe('postStore — seeding', () => {
  it('seeds just the canonical six by default (the rich fixtures are opt-in)', () => {
    postStore.resetForTests()

    expect(postStore.getPosts().map(p => p.id)).toEqual(listPosts().map(p => p.id))
    expect(postStore.getPosts().every(p => p.inReplyTo === undefined)).toBe(true)
  })
})

describe('postStore.appendPost — reply linking', () => {
  it('resolves the parent author handle into inReplyTo and keeps the reply', () => {
    const created = reply('post-seed-fw-advisory')
    expect(created.inReplyTo).toBeUndefined() // createPost only records the parent id

    postStore.appendPost(created)

    expect(byId(created.id).inReplyTo).toEqual({
      postId: 'post-seed-fw-advisory',
      authorHandle: 'FairhavenWater',
    })
  })

  it('bumps the parent reply count by one, as a NEW object with the SAME id', () => {
    const before = byId('post-seed-fw-advisory')
    expect(before.counts.reply).toBe(18)

    postStore.appendPost(reply('post-seed-fw-advisory'))

    const after = byId('post-seed-fw-advisory')
    expect(after.counts.reply).toBe(19)
    expect(after).not.toBe(before)
    expect(after.counts.like).toBe(before.counts.like)
  })

  it('also bumps the parent for a reply that already carries inReplyTo', () => {
    const explicit: Post = {
      ...reply('post-seed-kward-correction'),
      inReplyTo: { postId: 'post-seed-kward-correction', authorHandle: 'kwardFH' },
    }
    const before = byId('post-seed-kward-correction').counts.reply

    postStore.appendPost(explicit)

    expect(byId('post-seed-kward-correction').counts.reply).toBe(before + 1)
  })

  it('leaves a reply to an unknown parent as it was, touching no other post', () => {
    const orphan = reply('post-does-not-exist')
    const snapshot = postStore.getPosts()

    postStore.appendPost(orphan)

    expect(byId(orphan.id).inReplyTo).toBeUndefined()
    for (const post of snapshot) expect(byId(post.id)).toBe(post)
  })

  it('a top-level append changes no existing post', () => {
    const snapshot = postStore.getPosts()

    postStore.appendPost({ ...reply('post-seed-fw-advisory'), parentPostId: undefined })

    for (const post of snapshot) expect(byId(post.id)).toBe(post)
  })

  it('notifies subscribers exactly once per append', () => {
    const listener = vi.fn()
    postStore.subscribe(listener)

    postStore.appendPost(reply('post-seed-fw-advisory'))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('postStore replies and the live streams', () => {
  it('the ARRIVAL stream emits the new reply once and never re-emits the bumped parent', async () => {
    const source = makeMockArrivalSource()
    const seen: string[] = []
    source.subscribe(view => seen.push(view.id))
    await source.start()

    const created = reply('post-seed-fw-advisory')
    postStore.appendPost(created)
    source.stop()

    expect(seen).toEqual([created.id])
  })

  it('the FEED (pill) stream drops the reply, and never re-emits the bumped parent either', async () => {
    const source = makeMockPostStoreSource()
    const seen: string[] = []
    source.subscribe(view => seen.push(view.id))
    await source.start()

    postStore.appendPost(reply('post-seed-fw-advisory'))
    source.stop()

    expect(seen).toEqual([])
  })
})
