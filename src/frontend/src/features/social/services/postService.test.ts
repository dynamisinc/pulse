/**
 * features/social/services/postService.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-03 ACs (SOC-003, COR-018, COR-053, XC-002, XC-004):
 *   - every post persists author, acting human, wall-clock + scenario time,
 *     and origin;
 *   - origin (+ every other provenance field) NEVER serializes onto a
 *     participant-facing payload (`toParticipantView`) — the keys are
 *     genuinely absent, not merely falsy;
 *   - createPost emits exactly one XC-004 'post' telemetry event carrying the
 *     right envelope, including an inject's injectId;
 *   - originConsoleLabel maps every origin to the R-003 console vocabulary.
 *
 * NOTE: this file lives under `src/features/social/**`, so the participant
 * wall-clock ESLint ban (COR-053) applies here too — never `Date.now()` /
 * `new Date()`; use `wallClockNowIso()` (telemetry-only) or `Date.parse()`
 * (not banned) instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { wallClockNowIso } from '@/core/time/wallClock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  createPost,
  listPosts,
  originConsoleLabel,
  toParticipantView,
  type CreatePostInput,
} from './postService'
import type { Post } from '../types/post'

// createPost routes through buildAndEmit, which best-effort POSTs via the
// shared axios client - mock it so these tests never touch the network
// (mirrors core/telemetry/emitter.test.ts).
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

function validInput(overrides: Partial<CreatePostInput> = {}): CreatePostInput {
  return {
    exerciseId: 'ex-test-1',
    timeZone: 'America/Chicago',
    scenarioTime: '2033-09-04T13:15:00Z',
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-simcell-utility',
    text: 'Boil water advisory remains in effect for Zones 2-4.',
    origin: 'participant',
    ...overrides,
  }
}

describe('createPost', () => {
  beforeEach(() => {
    resetTelemetryBuffer()
  })

  afterEach(() => {
    resetTelemetryBuffer()
  })

  it('persists author, acting human, wall-clock time, scenario time, and origin', () => {
    const before = wallClockNowIso()
    const post = createPost(validInput())
    const after = wallClockNowIso()

    expect(post.authorPersonaId).toBe('persona-fairhavenwater')
    expect(post.actingHumanId).toBe('human-simcell-utility')
    expect(post.origin).toBe('participant')
    expect(post.scenarioTime).toBe('2033-09-04T13:15:00Z')

    expect(Number.isNaN(Date.parse(post.createdWallClock))).toBe(false)
    // ISO-8601 `toISOString()` output is fixed-width, so lexicographic string
    // comparison agrees with chronological order - avoids Date.now() here.
    expect(post.createdWallClock >= before).toBe(true)
    expect(post.createdWallClock <= after).toBe(true)
  })

  it('stores the passed scenarioTime verbatim (never derives/overwrites it)', () => {
    const post = createPost(validInput({ scenarioTime: '2033-09-10T08:00:00Z' }))
    expect(post.scenarioTime).toBe('2033-09-10T08:00:00Z')
  })

  it('carries injectId on the Post when origin is "inject"', () => {
    const post = createPost(validInput({ origin: 'inject', injectId: '042' }))
    expect(post.origin).toBe('inject')
    expect(post.injectId).toBe('042')
  })

  it('sanitizes the post text on ingest (NFR-004)', () => {
    const post = createPost(validInput({ text: '<script>alert(1)</script>' }))
    expect(post.text).not.toContain('<script>')
  })

  it('applies default zero counts when none are supplied', () => {
    const post = createPost(validInput())
    expect(post.counts).toEqual({ reply: 0, repost: 0, like: 0 })
  })

  it('merges partial counts over the zero defaults', () => {
    const post = createPost(validInput({ counts: { like: 5 } }))
    expect(post.counts).toEqual({ reply: 0, repost: 0, like: 5 })
  })

  it('generates a unique id per post', () => {
    const a = createPost(validInput())
    const b = createPost(validInput())
    expect(a.id).not.toBe(b.id)
  })

  // ---------------------------------------------------------------------
  // XC-004 telemetry
  // ---------------------------------------------------------------------

  it('emits exactly one XC-004 "post" telemetry event with the correct envelope', () => {
    const post = createPost(validInput())
    const events = getEmittedTelemetryEvents()

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event).toBeDefined()
    if (!event) return

    expect(event.eventType).toBe('post')
    expect(event.channel).toBe('social')
    expect(event.exerciseId).toBe('ex-test-1')
    expect(event.actor).toEqual({
      kind: 'persona',
      personaId: 'persona-fairhavenwater',
      actingHumanId: 'human-simcell-utility',
    })
    expect(event.origin).toBe('participant')
    expect(event.wallClockTime).toBe(post.createdWallClock)
    expect(event.scenarioTime).toBe('2033-09-04T13:15:00Z')
    expect(event.timeZone).toBe('America/Chicago')
    expect(event.target).toEqual({ entityType: 'post', entityId: post.id })
  })

  it('carries injectId in the telemetry event for an inject-origin post', () => {
    const post = createPost(validInput({ origin: 'inject', injectId: '042' }))
    const events = getEmittedTelemetryEvents()

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event).toBeDefined()
    if (!event) return

    expect(event.origin).toBe('inject')
    expect(event.injectId).toBe('042')
    expect(event.target).toEqual({ entityType: 'post', entityId: post.id })
  })

  it('never throws, and still returns a Post, when telemetry validation would fail', () => {
    // An empty exerciseId fails buildAndEmit's validation; buildAndEmit
    // swallows it (returns null) rather than throwing - createPost must
    // still succeed and hand back a Post.
    expect(() => createPost(validInput({ exerciseId: '' }))).not.toThrow()

    const post = createPost(validInput({ exerciseId: '' }))
    expect(post.exerciseId).toBe('')
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })
})

describe('toParticipantView (XC-002)', () => {
  it('omits origin, actingHumanId, createdWallClock, and injectId entirely', () => {
    const post = createPost(validInput({ origin: 'inject', injectId: '042' }))
    const view = toParticipantView(post)

    expect('origin' in view).toBe(false)
    expect('actingHumanId' in view).toBe(false)
    expect('createdWallClock' in view).toBe(false)
    expect('injectId' in view).toBe(false)
  })

  it('preserves every participant-safe field', () => {
    const post = createPost(
      validInput({
        media: [{ kind: 'image', alt: 'test image' }],
        linkPreview: { title: 'Title', domain: 'example.news' },
      }),
    )
    const view = toParticipantView(post)

    expect(view.id).toBe(post.id)
    expect(view.authorPersonaId).toBe(post.authorPersonaId)
    expect(view.text).toBe(post.text)
    expect(view.media).toEqual(post.media)
    expect(view.linkPreview).toEqual(post.linkPreview)
    expect(view.counts).toEqual(post.counts)
    expect(view.scenarioTime).toBe(post.scenarioTime)
  })

  it('never leaks wall-clock time onto the participant-facing shape', () => {
    const post = createPost(validInput())
    const view = toParticipantView(post)
    expect(JSON.stringify(view)).not.toContain(post.createdWallClock)
  })
})

describe('originConsoleLabel (R-003, staff-only)', () => {
  const base = validInput()

  function postWithOrigin(origin: CreatePostInput['origin'], injectId?: string): Post {
    return createPost({ ...base, origin, injectId })
  }

  it('maps "engine" to ENGINE · AUTO', () => {
    expect(originConsoleLabel(postWithOrigin('engine'))).toBe('ENGINE · AUTO')
  })

  it('maps "controller-as-persona" to SIMCELL · MANUAL', () => {
    expect(originConsoleLabel(postWithOrigin('controller-as-persona'))).toBe('SIMCELL · MANUAL')
  })

  it('maps "participant" to PARTICIPANT', () => {
    expect(originConsoleLabel(postWithOrigin('participant'))).toBe('PARTICIPANT')
  })

  it('maps an "inject" origin to INJ-<injectId>', () => {
    expect(originConsoleLabel(postWithOrigin('inject', '042'))).toBe('INJ-042')
  })
})

describe('listPosts', () => {
  beforeEach(() => {
    resetTelemetryBuffer()
  })

  it('returns a handful of seeded posts referencing real seeded personas', () => {
    const posts = listPosts()
    expect(posts.length).toBeGreaterThanOrEqual(4)
    for (const post of posts) {
      expect(post.authorPersonaId).toMatch(/^persona-/)
    }
  })

  it('includes varied origins, incl. the fired inject (injectId "042")', () => {
    const posts = listPosts()
    const origins = new Set(posts.map(p => p.origin))

    expect(origins.has('participant')).toBe(true)
    expect(origins.has('controller-as-persona')).toBe(true)
    expect(origins.has('engine')).toBe(true)
    expect(origins.has('inject')).toBe(true)

    const injectPost = posts.find(p => p.origin === 'inject')
    expect(injectPost).toBeDefined()
    if (!injectPost) return
    expect(injectPost.injectId).toBe('042')
  })

  it('reflects the rumor-vs-official tension: the impersonator outperforms the utility', () => {
    const posts = listPosts()
    const official = posts.find(p => p.authorPersonaId === 'persona-fairhavenwater')
    const impersonator = posts.find(p => p.authorPersonaId === 'persona-fairhavenwaterupd')

    expect(official).toBeDefined()
    expect(impersonator).toBeDefined()
    if (!official || !impersonator) return

    expect(impersonator.counts.like).toBeGreaterThan(official.counts.like)
  })

  it('never emits telemetry merely by being read (fixtures are pre-existing, not "created")', () => {
    listPosts()
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('returns a fresh copy each call (callers cannot mutate the canonical set)', () => {
    const a = listPosts()
    const b = listPosts()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
