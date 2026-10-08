/**
 * features/social/services/postService.live.test.ts
 * ---------------------------------------------------------------------------
 * `createPost` in LIVE mode (`USE_MOCK_DATA` forced false; demo-polish F0, M-1).
 *
 * The controller builds a LOCAL `Post` through `composeAsPersona` -> `createPost`
 * in live mode too, BEFORE it fires the real `publishPost`. A REAL uploaded
 * asset's id is unknown to the mock media registry, so `createPost` must NOT
 * throw for it in live mode — otherwise the publish would never be sent. The
 * server is the gate: unresolvable (or alt-less) attachments are skipped from the
 * local post. (MOCK mode still throws, mirroring the server's 400 — covered in
 * `postService.v2.test.ts`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { createPost, type CreatePostInput } from './postService'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

function input(overrides: Partial<CreatePostInput> = {}): CreatePostInput {
  return {
    exerciseId: 'ex-live-0001',
    timeZone: 'America/Chicago',
    scenarioTime: '2033-09-04T13:15:00Z',
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-ctl-7',
    text: 'Boil water advisory remains in effect for Zones 2-4.',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

const REAL_ASSET_ID = '7f1c0c0e-0000-4000-8000-000000000001'

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetTelemetryBuffer()
})

describe('createPost (live) — never throws for media; the server is the gate', () => {
  it('does not throw for an asset id the mock registry does not know, and still builds the post', () => {
    const post = createPost(
      input({ media: [{ mediaId: REAL_ASSET_ID, alt: 'Flooded Main Street' }] }),
    )

    expect(post.text).toBe('Boil water advisory remains in effect for Zones 2-4.')
    expect(post.origin).toBe('controller-as-persona')
    expect(post.media).toBeUndefined()
    // The post's single XC-004 event still fires.
    expect(getEmittedTelemetryEvents()).toHaveLength(1)
  })

  it('skips only the unresolvable items and keeps the ones it can resolve', () => {
    const post = createPost(
      input({
        media: [
          { mediaId: REAL_ASSET_ID, alt: 'A real uploaded photo' },
          { mediaId: 'mock-media-canned-flood', alt: 'A canned library photo' },
        ],
      }),
    )

    expect(post.media?.map(item => item.id)).toEqual(['mock-media-canned-flood'])
  })

  it('does not throw for missing alt text either (the server rejects it, not the local copy)', () => {
    expect(() =>
      createPost(input({ media: [{ mediaId: 'mock-media-canned-flood', alt: '   ' }] })),
    ).not.toThrow()
    expect(
      createPost(input({ media: [{ mediaId: 'mock-media-canned-flood', alt: '   ' }] })).media,
    ).toBeUndefined()
  })

  it('emits a reply event for a reply with media, without throwing', () => {
    const post = createPost(
      input({ parentPostId: 'post-parent', media: [{ mediaId: REAL_ASSET_ID, alt: 'x' }] }),
    )

    expect(post.parentPostId).toBe('post-parent')
    expect(getEmittedTelemetryEvents()[0]?.eventType).toBe('reply')
  })
})
