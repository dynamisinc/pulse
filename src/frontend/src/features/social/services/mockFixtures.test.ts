/**
 * features/social/services/mockFixtures.test.ts
 * ---------------------------------------------------------------------------
 * The v2 mock content set (demo-polish F0, implementation.md §5): every numbered
 * item of the fixture checklist is asserted here, so a Wave-2/3 builder can rely
 * on the fixtures by id. Also pins the activation rule (the rich set is OFF under
 * Vitest so the existing suites keep their canonical six-post feed) and that every
 * image/video carries alt text (NFR-001) and a file that actually exists in
 * `public/mock-media`.
 */
import { describe, expect, it } from 'vitest'
import { personaIdForHandle, SEEDED_PERSONAS } from '@/features/personas'
import type { Post } from '../types/post'
import { postStore } from './postStore'
import { listPosts, toParticipantView } from './postService'
import {
  DEMO_FIXTURES_ENABLED,
  DEMO_IDS,
  MOCK_VIEWER_HANDLE,
  demoFixturePost,
  listDemoFixturePosts,
  listDemoTakenDownPosts,
} from './mockFixtures'

/** Every file under `public/mock-media`, as `/public/mock-media/...` keys. */
const MOCK_MEDIA_FILES = new Set(Object.keys(import.meta.glob('/public/mock-media/**/*')))

function fixture(id: string): Post {
  const post = demoFixturePost(id)
  if (post === undefined) throw new Error(`missing fixture ${id}`)
  return post
}

const ALL: readonly Post[] = [...listDemoFixturePosts(), ...listDemoTakenDownPosts()]

describe('activation', () => {
  it('is OFF under Vitest, so the existing suites keep the canonical six-post feed', () => {
    expect(DEMO_FIXTURES_ENABLED).toBe(false)
    postStore.resetForTests()
    expect(postStore.getPosts().map(p => p.id)).toEqual(listPosts().map(p => p.id))
  })

  it('opts in explicitly: the six canonical posts PLUS every visible fixture, never a tombstone', () => {
    postStore.resetForTests({ withDemoFixtures: true })

    const ids = postStore.getPosts().map(p => p.id)
    expect(ids).toEqual([...listPosts(), ...listDemoFixturePosts()].map(p => p.id))
    for (const takenDown of listDemoTakenDownPosts()) expect(ids).not.toContain(takenDown.id)
    postStore.resetForTests()
  })

  it('has unique ids that do not collide with the canonical six', () => {
    const ids = ALL.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const canonical = new Set(listPosts().map(p => p.id))
    expect(ids.some(id => canonical.has(id))).toBe(false)
  })

  it('hands out fresh copies (callers cannot mutate the canonical set)', () => {
    expect(listDemoFixturePosts()).not.toBe(listDemoFixturePosts())
  })
})

describe('§5.1 image grids 1-4 with sizes, one portrait', () => {
  it.each([
    [DEMO_IDS.grid1, 1],
    [DEMO_IDS.grid2, 2],
    [DEMO_IDS.grid3, 3],
    [DEMO_IDS.grid4, 4],
  ])('%s has %i image(s), each with alt and width/height', (id, count) => {
    const media = fixture(id).media ?? []

    expect(media).toHaveLength(count)
    for (const item of media) {
      expect(item.kind).toBe('image')
      expect(item.alt.length).toBeGreaterThan(0)
      expect(item.width).toBeGreaterThan(0)
      expect(item.height).toBeGreaterThan(0)
    }
  })

  it('includes a portrait photo, leading the 3-image post', () => {
    const [first] = fixture(DEMO_IDS.grid3).media ?? []
    expect((first?.height ?? 0)).toBeGreaterThan(first?.width ?? 0)
  })
})

describe('§5.2 video with and without a poster', () => {
  it('has a video with posterUrl + durationSec', () => {
    const [video] = fixture(DEMO_IDS.videoPoster).media ?? []

    expect(video).toMatchObject({ kind: 'video' })
    expect(video?.posterUrl).toBeTruthy()
    expect(video?.durationSec).toBeGreaterThan(0)
    expect(video?.alt.length).toBeGreaterThan(0)
  })

  it('has a video with NO poster (the fallback path)', () => {
    const [video] = fixture(DEMO_IDS.videoNoPoster).media ?? []

    expect(video).toMatchObject({ kind: 'video' })
    expect(video).not.toHaveProperty('posterUrl')
    expect(video?.alt.length).toBeGreaterThan(0)
  })
})

describe('§5.3 the thread (see also hooks/useThread.v2.test.ts)', () => {
  it('chains root -> question -> focus through inReplyTo, every reply carrying it', () => {
    expect(fixture(DEMO_IDS.threadRoot).inReplyTo).toBeUndefined()
    expect(fixture(DEMO_IDS.threadQuestion).inReplyTo?.postId).toBe(DEMO_IDS.threadRoot)
    expect(fixture(DEMO_IDS.threadFocus).inReplyTo?.postId).toBe(DEMO_IDS.threadQuestion)
  })

  it('gives the focused post three direct replies: one tombstone, one with media', () => {
    const direct = ALL.filter(p => p.inReplyTo?.postId === DEMO_IDS.threadFocus)

    expect(direct).toHaveLength(3)
    expect(direct.some(p => (p.media ?? []).length > 0)).toBe(true)
    expect(listDemoTakenDownPosts().map(p => p.id)).toEqual([DEMO_IDS.threadReplyTakenDown])
    expect(direct.map(p => p.id)).toContain(DEMO_IDS.threadReplyTakenDown)
  })
})

describe('§5.4 viewer states', () => {
  it('has liked-only, reposted-only and both', () => {
    expect(fixture(DEMO_IDS.grid1).viewer).toEqual({ liked: true, reposted: false })
    expect(fixture(DEMO_IDS.countsModest).viewer).toEqual({ liked: false, reposted: true })
    expect(fixture(DEMO_IDS.videoPoster).viewer).toEqual({ liked: true, reposted: true })
  })
})

describe('§5.5 count boundaries 0, 9, 999, 1 000, 1 450, 12 300', () => {
  it('covers every boundary value somewhere in the engagement counts', () => {
    const present = new Set<number>()
    for (const post of [...listPosts(), ...ALL]) {
      present.add(post.counts.reply)
      present.add(post.counts.repost)
      present.add(post.counts.like)
    }

    for (const boundary of [0, 9, 999, 1000, 1450, 12300]) {
      expect(present.has(boundary)).toBe(true)
    }
  })

  it('has an all-zero post', () => {
    expect(fixture(DEMO_IDS.countsZero).counts).toEqual({ reply: 0, repost: 0, like: 0 })
  })
})

describe('§5.6 the cast: avatars, banners, locations, the impersonation pair', () => {
  const personas = SEEDED_PERSONAS

  it('gives the cast avatars and banners from /mock-media', () => {
    const withAvatar = personas.filter(p => p.avatarUrl !== undefined)
    const withBanner = personas.filter(p => p.bannerUrl !== undefined)

    expect(withAvatar.length).toBeGreaterThanOrEqual(6)
    expect(withBanner.length).toBeGreaterThanOrEqual(3)
    for (const p of withAvatar) expect(p.avatarUrl).toMatch(/^\/mock-media\/avatars\//)
    for (const p of withBanner) expect(p.bannerUrl).toMatch(/^\/mock-media\/banners\//)
  })

  it('leaves exactly one persona without an avatar (the fallback path)', () => {
    expect(personas.filter(p => p.avatarUrl === undefined).map(p => p.handle)).toEqual(['tbrandt41'])
  })

  it('gives exactly two personas a location', () => {
    expect(personas.filter(p => p.location !== undefined)).toHaveLength(2)
  })

  it('shows the verified agency and its UNVERIFIED lookalike side by side, both with avatars', () => {
    const real = personas.find(p => p.handle === 'FairhavenWater')
    const fake = personas.find(p => p.handle === 'FairhavenWaterUpd')

    expect(real?.verified).toBe(true)
    expect(fake?.verified).toBe(false)
    expect(real?.avatarUrl).toBeTruthy()
    expect(fake?.avatarUrl).toBeTruthy()
    expect(real?.avatarUrl).not.toBe(fake?.avatarUrl)

    const realPost = fixture(DEMO_IDS.pairReal)
    const fakePost = fixture(DEMO_IDS.pairFake)
    expect(realPost.authorPersonaId).toBe(personaIdForHandle('FairhavenWater'))
    expect(fakePost.authorPersonaId).toBe(personaIdForHandle('FairhavenWaterUpd'))
    // Posted minutes apart.
    expect(Math.abs(Date.parse(fakePost.scenarioTime) - Date.parse(realPost.scenarioTime)))
      .toBeLessThanOrEqual(10 * 60 * 1000)
  })
})

describe('§5.7 #WaterIssues across the hours, and mentions of the mock viewer', () => {
  it('has several #WaterIssues posts spread over more than two scenario hours', () => {
    const tagged = ALL.filter(p => /#WaterIssues/.test(p.text))
    const times = tagged.map(p => Date.parse(p.scenarioTime))

    expect(tagged.length).toBeGreaterThanOrEqual(8)
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(2 * 60 * 60 * 1000)
  })

  it('has top-level posts that @mention the mock viewer', () => {
    const mentions = listDemoFixturePosts().filter(
      p => p.inReplyTo === undefined && p.text.includes(`@${MOCK_VIEWER_HANDLE}`),
    )
    expect(mentions.length).toBeGreaterThanOrEqual(2)
  })
})

describe('§5.8 replies are in the store: excluded from top-level, returned with includeReplies', () => {
  it('marks replies with inReplyTo and top-level posts without', () => {
    const replies = listDemoFixturePosts().filter(p => p.inReplyTo !== undefined)
    expect(replies.length).toBeGreaterThanOrEqual(5)
    expect(replies.map(p => p.id)).toEqual(
      expect.arrayContaining([DEMO_IDS.threadQuestion, DEMO_IDS.replyDreyes]),
    )
  })
})

describe('§5.9 posts authored by the mock viewer', () => {
  it('has own top-level posts and an own reply', () => {
    const own = ALL.filter(p => p.authorPersonaId === personaIdForHandle(MOCK_VIEWER_HANDLE))

    expect(own.filter(p => p.inReplyTo === undefined).map(p => p.id)).toEqual(
      expect.arrayContaining([DEMO_IDS.own1, DEMO_IDS.own2]),
    )
    expect(own.some(p => p.inReplyTo !== undefined)).toBe(true)
  })
})

describe('integrity (NFR-001, XC-002, assets)', () => {
  it('gives every attachment alt text and a media file that exists', () => {
    for (const post of ALL) {
      for (const item of post.media ?? []) {
        expect(item.alt.trim().length).toBeGreaterThan(0)
        for (const url of [item.url, item.posterUrl]) {
          if (url === undefined) continue
          expect(url.startsWith('/mock-media/')).toBe(true)
          expect(MOCK_MEDIA_FILES.has(`/public${url}`)).toBe(true)
        }
      }
    }
  })

  it('resolves every fixture author, and every persona avatar/banner file, in the seeded cast', () => {
    const ids = new Set(SEEDED_PERSONAS.map(p => p.id))
    for (const post of ALL) expect(ids.has(post.authorPersonaId)).toBe(true)
    for (const persona of SEEDED_PERSONAS) {
      for (const url of [persona.avatarUrl, persona.bannerUrl]) {
        if (url !== undefined) expect(MOCK_MEDIA_FILES.has(`/public${url}`)).toBe(true)
      }
    }
  })

  it('keeps provenance out of every fixture participant view (XC-002)', () => {
    for (const post of ALL) {
      const view = toParticipantView(post)
      for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId', 'exerciseId']) {
        expect(view).not.toHaveProperty(key)
      }
    }
  })
})
