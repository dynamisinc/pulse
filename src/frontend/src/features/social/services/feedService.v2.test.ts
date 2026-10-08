/**
 * features/social/services/feedService.v2.test.ts
 * ---------------------------------------------------------------------------
 * The feed read seam under CONTRACT v2 (demo-polish F0, DP-5):
 *  - `assembleFeedView` / `toPostView` CARRY media, inReplyTo, viewer and
 *    linkPreview from the participant view onto the `PostView` (and still strip
 *    provenance — XC-002);
 *  - `resolveFeed(scope, { includeReplies })`: the default request is
 *    byte-identical to before (no `params`), `includeReplies` adds the query
 *    param, the feed is TOP-LEVEL ONLY unless replies are requested (mock and
 *    live agree), and it composes with the Following scope;
 *  - the `isPost` guard accepts well-formed v2 members and fails closed on a
 *    malformed one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import type { Persona } from '@/features/personas'
import { personaIdForHandle, SEEDED_PERSONAS } from '@/features/personas'
import type { Post } from '../types/post'
import {
  assembleFeedView,
  resolveFeed,
  setMockFollowingForTests,
  toPostView,
} from './feedService'
import { DEMO_IDS, listDemoFixturePosts } from './mockFixtures'
import { toParticipantView } from './postService'
import { postStore } from './postStore'

const AUTHOR: Persona = {
  id: 'persona-a',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-a',
  displayName: 'Author A',
  handle: 'authora',
  kind: 'human',
  verified: false,
  avatarColor: '#7c5cd6',
  initials: 'AA',
  audienceBand: 'micro',
  followerCount: 100,
  joinedAt: '2026-01-01T00:00:00.000Z',
}

const V2_POST: Post = {
  id: 'post-v2',
  exerciseId: 'ex-mock-0001',
  authorPersonaId: 'persona-a',
  actingHumanId: 'human-a',
  text: 'a v2 post',
  media: [{ id: 'm1', kind: 'image', url: '/u.png', alt: 'An image', width: 4, height: 3 }],
  inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
  linkPreview: { title: 'T', domain: 'example.news', imageUrl: '/i.png' },
  viewer: { liked: true, reposted: false },
  counts: { reply: 1, repost: 2, like: 3 },
  createdWallClock: '2026-07-01T00:00:00.000Z',
  scenarioTime: '2033-09-04T13:00:00Z',
  origin: 'inject',
  injectId: '042',
}

afterEach(() => {
  vi.restoreAllMocks()
  postStore.resetForTests()
  setMockFollowingForTests(undefined)
})

describe('assembleFeedView / toPostView — carry the v2 members', () => {
  it('carries media, inReplyTo, viewer and linkPreview onto the PostView', () => {
    const [view] = assembleFeedView([V2_POST], [AUTHOR])

    expect(view?.media).toEqual(V2_POST.media)
    expect(view?.inReplyTo).toEqual({ postId: 'post-parent', authorHandle: 'FulcoEM' })
    expect(view?.viewer).toEqual({ liked: true, reposted: false })
    expect(view?.linkPreview).toEqual(V2_POST.linkPreview)
    expect(view?.author).toBe(AUTHOR)
  })

  it('still strips provenance from the assembled view (XC-002)', () => {
    const [view] = assembleFeedView([V2_POST], [AUTHOR])

    for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId', 'exerciseId']) {
      expect(view).not.toHaveProperty(key)
    }
  })

  it('omits absent members instead of emitting undefined keys', () => {
    const stripped: Post = {
      ...V2_POST,
      media: undefined,
      inReplyTo: undefined,
      viewer: undefined,
      linkPreview: undefined,
    }
    const plain = toPostView(toParticipantView(stripped), AUTHOR)

    expect(Object.keys(plain).sort()).toEqual(['author', 'counts', 'id', 'scenarioTime', 'text'])
  })
})

describe('resolveFeed — request shape (byte-identical default, DP-5 param)', () => {
  function configOf(call: unknown[]): { params?: unknown; adapter?: unknown } {
    return (call[1] ?? {}) as { params?: unknown; adapter?: unknown }
  }

  it('sends NO params for the default call (unchanged)', async () => {
    const get = vi.spyOn(api, 'get')

    await resolveFeed()

    expect(get.mock.calls[0]?.[0]).toBe('/feed')
    expect(configOf(get.mock.calls[0] ?? [])).not.toHaveProperty('params')
  })

  it('sends only scope for the Following scope (unchanged)', async () => {
    const get = vi.spyOn(api, 'get')

    await resolveFeed('following')

    expect(configOf(get.mock.calls[0] ?? []).params).toEqual({ scope: 'following' })
  })

  it('adds includeReplies=true, alone or with the Following scope', async () => {
    const get = vi.spyOn(api, 'get')

    await resolveFeed('all', { includeReplies: true })
    await resolveFeed('following', { includeReplies: true })

    expect(configOf(get.mock.calls[0] ?? []).params).toEqual({ includeReplies: true })
    expect(configOf(get.mock.calls[1] ?? []).params).toEqual({
      scope: 'following',
      includeReplies: true,
    })
  })

  it('treats includeReplies: false exactly like omitting it', async () => {
    const get = vi.spyOn(api, 'get')

    await resolveFeed('all', { includeReplies: false })

    expect(configOf(get.mock.calls[0] ?? [])).not.toHaveProperty('params')
  })
})

describe('resolveFeed (mock) — top-level only unless replies are requested', () => {
  const replyCount = listDemoFixturePosts().filter(p => p.inReplyTo !== undefined).length

  it('excludes replies from the default read and includes them with includeReplies', async () => {
    postStore.resetForTests({ withDemoFixtures: true })

    const topLevel = await resolveFeed()
    const withReplies = await resolveFeed('all', { includeReplies: true })

    expect(topLevel.some(p => p.inReplyTo !== undefined)).toBe(false)
    expect(topLevel.map(p => p.id)).toContain(DEMO_IDS.grid1)
    expect(withReplies.filter(p => p.inReplyTo !== undefined)).toHaveLength(replyCount)
    expect(withReplies.length).toBe(topLevel.length + replyCount)
    expect(withReplies.map(p => p.id)).toEqual(
      expect.arrayContaining([DEMO_IDS.threadFocus, DEMO_IDS.replyDreyes]),
    )
  })

  it('never returns a soft-deleted (tombstoned) reply, even with includeReplies', async () => {
    postStore.resetForTests({ withDemoFixtures: true })

    const withReplies = await resolveFeed('all', { includeReplies: true })

    expect(withReplies.map(p => p.id)).not.toContain(DEMO_IDS.threadReplyTakenDown)
  })

  it('composes with the Following scope: only followed authors, replies included on request', async () => {
    postStore.resetForTests({ withDemoFixtures: true })
    setMockFollowingForTests([personaIdForHandle('FulcoEM')])

    const following = await resolveFeed('following')
    const followingWithReplies = await resolveFeed('following', { includeReplies: true })

    const fulcoId = personaIdForHandle('FulcoEM')
    expect(following.every(p => p.authorPersonaId === fulcoId)).toBe(true)
    expect(following.some(p => p.inReplyTo !== undefined)).toBe(false)
    expect(followingWithReplies.every(p => p.authorPersonaId === fulcoId)).toBe(true)
    expect(followingWithReplies.map(p => p.id)).toContain(DEMO_IDS.threadFocus)
  })

  it('keeps the canonical six top-level posts as the default seed', async () => {
    const posts = await resolveFeed()

    expect(posts).toHaveLength(6)
    expect((await resolveFeed('all', { includeReplies: true })).length).toBe(6)
  })

  it('assembles fixture posts for the seeded cast without dropping any author', async () => {
    postStore.resetForTests({ withDemoFixtures: true })

    const posts = await resolveFeed('all', { includeReplies: true })
    const views = assembleFeedView(posts, SEEDED_PERSONAS)

    expect(views).toHaveLength(posts.length)
  })
})

describe('resolveFeed — the isPost guard on v2 members', () => {
  const wire = {
    id: 'p1',
    authorPersonaId: 'persona-a',
    text: 't',
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T13:00:00Z',
  }

  it('accepts well-formed media / inReplyTo / viewer', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [
        {
          ...wire,
          media: [{ id: 'm', kind: 'video', url: '/v.mp4', alt: 'a', durationSec: 4 }],
          inReplyTo: { postId: 'p0', authorHandle: 'h' },
          viewer: { liked: false, reposted: false },
        },
      ],
    })

    await expect(resolveFeed()).resolves.toHaveLength(1)
  })

  it.each([
    ['legacy placeholder media', { media: [{ kind: 'image', alt: 'old' }] }],
    ['media item without a url', { media: [{ id: 'm', kind: 'image', alt: 'a' }] }],
    ['inReplyTo without a postId', { inReplyTo: { authorHandle: 'h' } }],
    ['viewer with non-boolean flags', { viewer: { liked: 1, reposted: 0 } }],
  ])('fails closed on %s', async (_label, extra) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ ...wire, ...extra }] })

    await expect(resolveFeed()).rejects.toThrow(/malformed post set/)
  })
})
