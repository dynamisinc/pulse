/**
 * features/social/services/feedService.test.ts
 * ---------------------------------------------------------------------------
 * Covers story 01's read seam + convergence (SOC-080, COR-053, XC-002):
 *  - `assembleFeedView` sorts newest-first by scenarioTime, resolves each
 *    post's author persona, SKIPS a post whose author is absent (no crash),
 *    and structurally strips provenance (XC-002 — no `origin`/`actingHumanId`
 *    on the participant-safe view);
 *  - `resolveFeed` (the shipped mock-adapter path, USE_MOCK_DATA on in test)
 *    resolves the seeded posts through the real axios pipeline.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Persona } from '@/features/personas'
import type { Post } from '@/features/social'
import { assembleFeedView, resolveFeed } from './feedService'
import { postStore } from './postStore'

function buildPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-a',
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-a',
    displayName: 'Author A',
    handle: 'authora',
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#7c5cd6',
    initials: 'AA',
    audienceBand: 'micro',
    followerCount: 100,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-a',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-a',
    actingHumanId: 'human-a',
    text: 'hello',
    counts: { reply: 1, repost: 2, like: 3 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T13:00:00Z',
    origin: 'participant',
    ...overrides,
  }
}

describe('assembleFeedView — ordering (SOC-080, COR-053)', () => {
  it('sorts posts newest-first by scenarioTime regardless of input order', () => {
    const personas = [buildPersona()]
    const posts = [
      buildPost({ id: 'mid', scenarioTime: '2033-09-04T13:30:00Z' }),
      buildPost({ id: 'oldest', scenarioTime: '2033-09-04T12:00:00Z' }),
      buildPost({ id: 'newest', scenarioTime: '2033-09-04T14:00:00Z' }),
    ]

    const views = assembleFeedView(posts, personas)

    expect(views.map(v => v.id)).toEqual(['newest', 'mid', 'oldest'])
  })
})

describe('assembleFeedView — author resolution & missing-author skip', () => {
  it('resolves each post to its author persona', () => {
    const author = buildPersona({ id: 'persona-a', displayName: 'Keisha Ward' })
    const views = assembleFeedView([buildPost({ authorPersonaId: 'persona-a' })], [author])

    expect(views).toHaveLength(1)
    expect(views[0]?.author).toBe(author)
  })

  it('skips a post whose author persona is absent, without crashing', () => {
    const personas = [buildPersona({ id: 'persona-a' })]
    const posts = [
      buildPost({ id: 'kept', authorPersonaId: 'persona-a' }),
      buildPost({ id: 'orphan', authorPersonaId: 'persona-missing' }),
    ]

    const views = assembleFeedView(posts, personas)

    expect(views.map(v => v.id)).toEqual(['kept'])
  })
})

describe('assembleFeedView — provenance stays absent (XC-002)', () => {
  it('produces a view with no origin/actingHumanId fields even though the Post carried them', () => {
    const view = assembleFeedView(
      [buildPost({ origin: 'inject', actingHumanId: 'human-simcell' })],
      [buildPersona()],
    )[0]

    expect(view).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(view, 'origin')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(view, 'actingHumanId')).toBe(false)
  })
})

describe('resolveFeed — shipped mock-adapter path (NFR-003 seam)', () => {
  afterEach(() => {
    postStore.resetForTests()
  })

  it('resolves the seeded posts through the real axios pipeline', async () => {
    const posts = await resolveFeed()

    expect(Array.isArray(posts)).toBe(true)
    expect(posts.length).toBeGreaterThan(0)
    // A known seeded post from the Fairhaven arc came back through the adapter.
    expect(posts.some(p => p.id === 'post-seed-fw-advisory')).toBe(true)
  })

  it('resolves through postStore.getPosts() — a just-appended post is included (feeds-discovery/07)', async () => {
    postStore.appendPost(buildPost({ id: 'post-live-appended' }))

    const posts = await resolveFeed()

    // Proof the mock adapter reads the live store, not listPosts() directly:
    // the appended post rides through the same axios pipeline as the baseline.
    expect(posts.some(p => p.id === 'post-live-appended')).toBe(true)
    expect(posts.some(p => p.id === 'post-seed-fw-advisory')).toBe(true)
  })
})
