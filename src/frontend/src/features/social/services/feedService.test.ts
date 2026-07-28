/**
 * features/social/services/feedService.test.ts
 * ---------------------------------------------------------------------------
 * Covers story 01's read seam + convergence (SOC-080, COR-053, XC-002) and
 * story 02's Following scope (SOC-081):
 *  - `assembleFeedView` sorts newest-first by scenarioTime, resolves each
 *    post's author persona, SKIPS a post whose author is absent (no crash),
 *    and structurally strips provenance (XC-002 — no `origin`/`actingHumanId`
 *    on the participant-safe view);
 *  - `resolveFeed` (the shipped mock-adapter path, USE_MOCK_DATA on in test)
 *    resolves the seeded posts through the real axios pipeline;
 *  - `resolveFeed('following')` filters to the mock following set, and an
 *    empty follow set resolves an empty array — never an All-Posts fallback.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Persona } from '@/features/personas'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import {
  assembleFeedView,
  compareNewestFirst,
  resolveFeed,
  setMockFollowingForTests,
} from './feedService'
import { postStore } from './postStore'

function buildPersona(overrides: Partial<Persona> = {}): Persona {
  return {
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

describe('compareNewestFirst — the shared newest-first comparator (COR-053)', () => {
  // Now a public export shared by assembleFeedView + Feed's live-arrivals sort
  // (Copilot #301 round-2). Ordering is covered via assembleFeedView above;
  // this pins the newer-instant-first sign and the unparseable-sorts-last edge.
  it('orders a newer scenario instant before an older one', () => {
    expect(
      compareNewestFirst('2033-09-04T14:00:00Z', '2033-09-04T12:00:00Z'),
    ).toBeLessThan(0)
    expect(
      compareNewestFirst('2033-09-04T12:00:00Z', '2033-09-04T14:00:00Z'),
    ).toBeGreaterThan(0)
  })

  it('treats an unparseable instant as oldest (sorts last) rather than throwing', () => {
    // -Infinity for the bad one → it always sorts AFTER a real instant.
    expect(compareNewestFirst('not-a-date', '2033-09-04T12:00:00Z')).toBeGreaterThan(0)
    expect(compareNewestFirst('2033-09-04T12:00:00Z', 'not-a-date')).toBeLessThan(0)
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

describe('resolveFeed(\'following\') — mock-adapter scope filtering (SOC-081)', () => {
  afterEach(() => {
    postStore.resetForTests()
    setMockFollowingForTests(undefined)
  })

  it('resolves ONLY posts from the mock following set, never every seeded author', async () => {
    setMockFollowingForTests([personaIdForHandle('FairhavenWater')])

    const posts = await resolveFeed('following')

    expect(posts.length).toBeGreaterThan(0)
    expect(posts.every(p => p.authorPersonaId === personaIdForHandle('FairhavenWater'))).toBe(true)
    // A seeded author NOT in the follow set never leaks through.
    expect(posts.some(p => p.authorPersonaId === personaIdForHandle('Newsline7'))).toBe(false)
  })

  it('resolves an empty array for an empty follow set — never an All-Posts fallback', async () => {
    setMockFollowingForTests([])

    const posts = await resolveFeed('following')

    expect(posts).toEqual([])
  })

  it('does not affect the default (\'all\') scope — the two calls stay independent', async () => {
    setMockFollowingForTests([])

    const allPosts = await resolveFeed()
    const followingPosts = await resolveFeed('following')

    expect(allPosts.length).toBeGreaterThan(0)
    expect(followingPosts).toEqual([])
  })
})
