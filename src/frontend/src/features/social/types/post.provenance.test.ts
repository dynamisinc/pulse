/**
 * features/social/types/post.provenance.test.ts
 * ---------------------------------------------------------------------------
 * XC-002 — provenance is STRUCTURALLY ABSENT from the participant shape, and
 * stays so under CONTRACT v2 (demo-polish F0, implementation.md §1.1/§1.5.3).
 *
 * v2 added media / inReplyTo / viewer to `ParticipantPostView` and a `Post` with
 * `parentPostId`; none of that may open a path for `origin`, `actingHumanId`,
 * `createdWallClock`, `injectId` (or the internal `exerciseId`/`parentPostId`) to
 * reach a participant. Three layers are pinned:
 *   1. TYPE — reading a provenance key off `ParticipantPostView` does not compile
 *      (the `@ts-expect-error` lines fail `tsc` if the key ever appears on the type);
 *   2. RUNTIME — `toParticipantView` of a Post that carries EVERY field produces
 *      an object with exactly the participant-safe keys, no more;
 *   3. NARROWING — extra server-side keys smuggled onto a media item / inReplyTo /
 *      viewer are not passed through.
 */
import { describe, expect, it } from 'vitest'
import { toParticipantView } from '../services/postService'
import type { ParticipantPostView, Post } from './post'

/** A Post carrying EVERY field, including all provenance and v2 members. */
const FULL_POST: Post = {
  id: 'post-full',
  exerciseId: 'ex-secret-scope',
  authorPersonaId: 'persona-fairhavenwater',
  actingHumanId: 'human-secret-controller',
  text: 'Full post',
  media: [
    {
      id: 'm1',
      kind: 'video',
      url: '/v.mp4',
      alt: 'A clip',
      posterUrl: '/v.jpg',
      width: 640,
      height: 360,
      durationSec: 4,
    },
  ],
  inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
  linkPreview: { title: 'T', domain: 'example.news', imageLabel: 'L', imageUrl: '/i.png' },
  counts: { reply: 1, repost: 2, like: 3 },
  viewer: { liked: true, reposted: false },
  createdWallClock: '2026-07-01T00:00:00.000Z',
  scenarioTime: '2033-09-04T13:15:00Z',
  origin: 'inject',
  injectId: '042',
  parentPostId: 'post-parent',
}

const PROVENANCE_KEYS = [
  'origin',
  'actingHumanId',
  'createdWallClock',
  'injectId',
  'exerciseId',
  'parentPostId',
] as const

describe('XC-002 under contract v2 — types', () => {
  it('does not let a participant surface even compile a read of a provenance field', () => {
    const view: ParticipantPostView = toParticipantView(FULL_POST)

    // @ts-expect-error `origin` is structurally absent from ParticipantPostView (XC-002)
    void view.origin
    // @ts-expect-error `actingHumanId` is structurally absent (XC-002)
    void view.actingHumanId
    // @ts-expect-error `createdWallClock` is structurally absent (XC-002)
    void view.createdWallClock
    // @ts-expect-error `injectId` is structurally absent (XC-002)
    void view.injectId

    // The v2 participant-safe members ARE readable.
    expect(view.viewer?.liked).toBe(true)
    expect(view.inReplyTo?.authorHandle).toBe('FulcoEM')
    expect(view.media?.[0]?.kind).toBe('video')
  })
})

describe('XC-002 under contract v2 — runtime', () => {
  it('produces exactly the participant-safe keys for a post carrying every field', () => {
    const view = toParticipantView(FULL_POST)

    expect(Object.keys(view).sort()).toEqual(
      [
        'authorPersonaId',
        'counts',
        'id',
        'inReplyTo',
        'linkPreview',
        'media',
        'scenarioTime',
        'text',
        'viewer',
      ].sort(),
    )
    for (const key of PROVENANCE_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(view, key)).toBe(false)
    }
  })

  it('leaks no provenance VALUE into the serialized view either', () => {
    const json = JSON.stringify(toParticipantView(FULL_POST))

    for (const secret of ['inject', '042', 'human-secret-controller', 'ex-secret-scope']) {
      expect(json).not.toContain(secret)
    }
    expect(json).not.toContain(FULL_POST.createdWallClock)
  })

  it('omits v2 members that are absent instead of emitting undefined keys', () => {
    const view = toParticipantView({
      id: 'post-min',
      exerciseId: 'ex-1',
      authorPersonaId: 'persona-x',
      actingHumanId: 'human-x',
      text: 'min',
      counts: { reply: 0, repost: 0, like: 0 },
      createdWallClock: '2026-07-01T00:00:00.000Z',
      scenarioTime: '2033-09-04T13:15:00Z',
      origin: 'participant',
    })

    expect(Object.keys(view).sort()).toEqual(['authorPersonaId', 'counts', 'id', 'scenarioTime', 'text'])
  })
})

describe('XC-002 under contract v2 — narrowing of nested members', () => {
  it('does not pass server-side keys smuggled onto a media item through', () => {
    // A wire object the TYPES forbid (extra server-side keys) — cast through
    // `unknown`, exactly what a hostile or buggy transport could hand the client.
    const smuggled = {
      ...FULL_POST,
      media: [
        {
          ...(FULL_POST.media?.[0] ?? { id: 'm', kind: 'image', url: '/u', alt: 'a' }),
          blobName: 'ex/secret.mp4',
          contentType: 'video/mp4',
          uploadedByHumanId: 'human-secret-controller',
          originalFileName: 'C:\\fakepath\\briefing.mp4',
        },
      ],
    } as unknown as Post

    const [item] = toParticipantView(smuggled).media ?? []

    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['alt', 'durationSec', 'height', 'id', 'kind', 'posterUrl', 'url', 'width'].sort(),
    )
  })

  it('does not pass extra keys on inReplyTo or viewer through', () => {
    const smuggled = {
      ...FULL_POST,
      inReplyTo: { postId: 'p', authorHandle: 'h', parentActingHumanId: 'human-secret' },
      viewer: { liked: true, reposted: true, personaId: 'persona-secret' },
    } as unknown as Post

    const view = toParticipantView(smuggled)

    expect(Object.keys(view.inReplyTo ?? {}).sort()).toEqual(['authorHandle', 'postId'])
    expect(Object.keys(view.viewer ?? {}).sort()).toEqual(['liked', 'reposted'])
  })
})
