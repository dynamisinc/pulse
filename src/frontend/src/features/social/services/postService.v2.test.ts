/**
 * features/social/services/postService.v2.test.ts
 * ---------------------------------------------------------------------------
 * The MOCK analog of `POST /api/posts` under CONTRACT v2 (demo-polish F0,
 * implementation.md §1.5.2 / §5): `createPost` resolves `CreatePostMedia`
 * through the mock media registry, mirrors the server's 400s for an unknown media
 * id / missing alt, records `parentPostId` for replies (and emits a `reply`
 * telemetry event, §1.8), honours `engagementBaseline` for STAFF origins only,
 * and `toParticipantView` / `hasWellFormedV2Members` carry and validate the new
 * members. (XC-002 absence is pinned in `types/post.provenance.test.ts`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { registerMockMedia, resetMockMediaRegistry } from '@/core/media'
import {
  createPost,
  hasWellFormedV2Members,
  toParticipantView,
  type CreatePostInput,
} from './postService'

// createPost routes through buildAndEmit, which best-effort POSTs via the shared
// axios client - mock it so these tests never touch the network.
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

function input(overrides: Partial<CreatePostInput> = {}): CreatePostInput {
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

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetTelemetryBuffer()
  resetMockMediaRegistry()
})

describe('createPost (mock) — media[] resolution', () => {
  it('resolves a canned library image into the full PostMedia, with sanitized alt', () => {
    const post = createPost(
      input({ media: [{ mediaId: 'mock-media-canned-flood', alt: ' <b>Flooded</b> Main Street ' }] }),
    )

    expect(post.media).toEqual([
      {
        id: 'mock-media-canned-flood',
        kind: 'image',
        url: '/mock-media/photos/flood-main-street.svg',
        alt: 'Flooded Main Street',
        width: 1600,
        height: 900,
      },
    ])
  })

  it('resolves a video with its poster and duration', () => {
    const post = createPost(
      input({ media: [{ mediaId: 'mock-media-canned-video', alt: 'Briefing clip' }] }),
    )

    expect(post.media?.[0]).toMatchObject({
      kind: 'video',
      url: '/mock-media/video/water-update.mp4',
      posterUrl: '/mock-media/video/water-update.poster.svg',
      durationSec: 4,
    })
  })

  it('lets posterMediaId override the asset poster', () => {
    registerMockMedia({
      id: 'mock-media-custom-poster',
      kind: 'image',
      url: 'blob:custom-poster',
      fileName: 'p.jpg',
      uploadedAtScenario: '2033-09-04T12:00:00.000Z',
    })

    const post = createPost(
      input({
        media: [
          {
            mediaId: 'mock-media-canned-video',
            alt: 'Clip',
            posterMediaId: 'mock-media-custom-poster',
          },
        ],
      }),
    )

    expect(post.media?.[0]?.posterUrl).toBe('blob:custom-poster')
  })

  it('resolves an asset uploaded this session', () => {
    registerMockMedia({
      id: 'mock-media-uploaded',
      kind: 'image',
      url: 'blob:uploaded',
      width: 800,
      height: 600,
      fileName: 'u.png',
      uploadedAtScenario: '2033-09-04T12:00:00.000Z',
    })

    const post = createPost(input({ media: [{ mediaId: 'mock-media-uploaded', alt: 'Mine' }] }))

    expect(post.media?.[0]).toMatchObject({ id: 'mock-media-uploaded', url: 'blob:uploaded' })
  })

  it('mirrors the server 400 for an unknown media id (and emits no telemetry)', () => {
    expect(() =>
      createPost(input({ media: [{ mediaId: 'does-not-exist', alt: 'x' }] })),
    ).toThrow(/not available/)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it.each(['', '   ', '<i></i>'])('mirrors the server 400 for alt text %j (alt is required)', alt => {
    expect(() =>
      createPost(input({ media: [{ mediaId: 'mock-media-canned-flood', alt }] })),
    ).toThrow(/alt text/)
  })

  it('leaves media undefined when there are no attachments', () => {
    expect(createPost(input()).media).toBeUndefined()
    expect(createPost(input({ media: [] })).media).toBeUndefined()
  })
})

describe('createPost (mock) — replies', () => {
  it('records parentPostId and emits one "reply" event naming the parent', () => {
    const post = createPost(input({ parentPostId: 'post-parent-1' }))

    expect(post.parentPostId).toBe('post-parent-1')
    const events = getEmittedTelemetryEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('reply')
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: post.id })
    expect(events[0]?.payload).toEqual({ parentPostId: 'post-parent-1' })
  })

  it('a top-level post carries no parentPostId and still emits "post"', () => {
    const post = createPost(input())

    expect(post).not.toHaveProperty('parentPostId')
    expect(getEmittedTelemetryEvents()[0]?.eventType).toBe('post')
  })
})

describe('createPost (mock) — engagementBaseline is staff-only', () => {
  const baseline = { like: 290, repost: 150, reply: 64 }

  it('seeds counts from the baseline for a controller-as-persona post', () => {
    const post = createPost(input({ origin: 'controller-as-persona', engagementBaseline: baseline }))

    expect(post.counts).toEqual({ reply: 64, repost: 150, like: 290 })
  })

  it('IGNORES the baseline for a participant', () => {
    const post = createPost(input({ origin: 'participant', engagementBaseline: baseline }))

    expect(post.counts).toEqual({ reply: 0, repost: 0, like: 0 })
  })

  it('applies only the keys given, clamping to 0..1,000,000 whole numbers', () => {
    const post = createPost(
      input({
        origin: 'controller-as-persona',
        engagementBaseline: { like: 2_500_000, repost: -5, reply: undefined },
      }),
    )

    expect(post.counts).toEqual({ reply: 0, repost: 0, like: 1_000_000 })
  })

  it('layers over explicit counts', () => {
    const post = createPost(
      input({
        origin: 'controller-as-persona',
        counts: { like: 5, reply: 2 },
        engagementBaseline: { like: 100 },
      }),
    )

    expect(post.counts).toEqual({ reply: 2, repost: 0, like: 100 })
  })
})

describe('toParticipantView — v2 members', () => {
  it('carries media, inReplyTo and viewer onto the view', () => {
    const post = createPost(
      input({ media: [{ mediaId: 'mock-media-canned-plant', alt: 'The plant' }] }),
    )
    const view = toParticipantView({
      ...post,
      inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
      viewer: { liked: false, reposted: true },
    })

    expect(view.media).toEqual(post.media)
    expect(view.inReplyTo).toEqual({ postId: 'post-parent', authorHandle: 'FulcoEM' })
    expect(view.viewer).toEqual({ liked: false, reposted: true })
  })
})

describe('hasWellFormedV2Members', () => {
  const media = { id: 'm', kind: 'image', url: '/u', alt: 'a' }

  it('accepts a post with no v2 members at all (every pre-v2 body)', () => {
    expect(hasWellFormedV2Members({})).toBe(true)
  })

  it('accepts well-formed media / inReplyTo / viewer', () => {
    expect(
      hasWellFormedV2Members({
        media: [media, { ...media, id: 'v', kind: 'video', posterUrl: '/p', durationSec: 4 }],
        inReplyTo: { postId: 'p', authorHandle: 'h' },
        viewer: { liked: true, reposted: false },
      }),
    ).toBe(true)
  })

  it.each([
    ['media not an array', { media: 'x' }],
    ['media item missing url', { media: [{ id: 'm', kind: 'image', alt: 'a' }] }],
    ['media item missing id', { media: [{ kind: 'image', url: '/u', alt: 'a' }] }],
    ['media item bad kind', { media: [{ ...media, kind: 'audio' }] }],
    ['media item missing alt', { media: [{ id: 'm', kind: 'image', url: '/u' }] }],
    ['media item non-numeric width', { media: [{ ...media, width: '10' }] }],
    ['legacy placeholder media', { media: [{ kind: 'image', alt: 'old' }] }],
    ['inReplyTo missing postId', { inReplyTo: { authorHandle: 'h' } }],
    ['inReplyTo not an object', { inReplyTo: 'p' }],
    ['viewer missing reposted', { viewer: { liked: true } }],
    ['viewer non-boolean', { viewer: { liked: 'yes', reposted: false } }],
  ])('rejects %s', (_label, body) => {
    expect(hasWellFormedV2Members(body)).toBe(false)
  })
})
