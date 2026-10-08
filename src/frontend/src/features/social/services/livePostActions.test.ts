/**
 * features/social/services/livePostActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE post-publish action, CONTRACT v2 (demo-polish F0;
 * implementation.md §1.5.2; posts / persona-operation; COR-001, COR-018,
 * COR-053, XC-002):
 *  - `publishPost` POSTs `/posts` with the wire body mapped off
 *    `CreatePostInput` — NO client `exerciseId` (COR-001) — for both sanctioned
 *    origins (`participant`, `controller-as-persona`);
 *  - `media[]` is exactly `{ mediaId, alt, posterMediaId? }` (the legacy
 *    `{ kind, alt }` placeholder is never sent), `parentPostId` makes a reply,
 *    and `engagementBaseline` is sent for STAFF origins only (dropped for a
 *    participant);
 *  - fields that are not part of the wire contract (`linkPreview`, `counts`)
 *    never ride along;
 *  - the promise RESOLVES with the parsed 201 view (participant or staff shape)
 *    and REJECTS on a non-2xx or a malformed 2xx body — nothing is swallowed.
 *
 * `api.post` is mocked (`vi.mock('@/core/services/api')`, hoisted above imports
 * by Vitest) so no real network call is made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput } from './postService'

const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

import { publishPost } from './livePostActions'

const PARTICIPANT_INPUT: CreatePostInput = {
  exerciseId: 'ex-live-0001',
  timeZone: 'America/New_York',
  scenarioTime: '2033-09-04T14:00:00.000Z',
  authorPersonaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  text: 'Zones 2-4 are clear now.',
  origin: 'participant',
}

const CONTROLLER_AS_PERSONA_INPUT: CreatePostInput = {
  exerciseId: 'ex-live-0001',
  timeZone: 'America/New_York',
  scenarioTime: '2033-09-04T14:05:00.000Z',
  authorPersonaId: 'persona-fairhavenwater',
  actingHumanId: 'human-ctl-7',
  text: 'Boil-water advisory lifted for Zone 3.',
  origin: 'controller-as-persona',
}

/** A well-formed 201 body in the PARTICIPANT shape (`ParticipantPostDto`). */
const PARTICIPANT_VIEW = {
  id: 'b8a1f6f2-0000-4000-8000-000000000001',
  authorPersonaId: 'persona-dreyes_fh',
  text: 'Zones 2-4 are clear now.',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00.0000000+00:00',
}

/** A well-formed 201 body in the STAFF shape (`StaffPostDto`, provenance included). */
const STAFF_VIEW = {
  ...PARTICIPANT_VIEW,
  id: 'b8a1f6f2-0000-4000-8000-000000000002',
  authorPersonaId: 'persona-fairhavenwater',
  exerciseId: 'ex-live-0001',
  actingHumanId: 'human-ctl-7',
  origin: 'controller-as-persona',
  createdWallClock: '2026-10-08T01:00:00.0000000+00:00',
}

function lastBody(): Record<string, unknown> {
  const call = postMock.mock.calls.at(-1)
  if (call === undefined) throw new Error('api.post was not called')
  return call[1] as Record<string, unknown>
}

beforeEach(() => {
  postMock.mockReset()
  postMock.mockResolvedValue({ data: PARTICIPANT_VIEW })
})

describe('publishPost — wire contract (COR-001)', () => {
  it('POSTs /posts with the participant-origin body, no client exerciseId', async () => {
    await publishPost(PARTICIPANT_INPUT)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/posts')
    expect(body).toEqual({
      authorPersonaId: 'persona-dreyes_fh',
      actingHumanId: 'human-dreyes',
      text: 'Zones 2-4 are clear now.',
      scenarioTime: '2033-09-04T14:00:00.000Z',
      timeZone: 'America/New_York',
      origin: 'participant',
    })
    expect(body).not.toHaveProperty('exerciseId')
  })

  it('POSTs /posts with the controller-as-persona-origin body identically shaped', async () => {
    postMock.mockResolvedValue({ data: STAFF_VIEW })

    await publishPost(CONTROLLER_AS_PERSONA_INPUT)

    expect(postMock).toHaveBeenCalledWith('/posts', {
      authorPersonaId: 'persona-fairhavenwater',
      actingHumanId: 'human-ctl-7',
      text: 'Boil-water advisory lifted for Zone 3.',
      scenarioTime: '2033-09-04T14:05:00.000Z',
      timeZone: 'America/New_York',
      origin: 'controller-as-persona',
    })
  })

  it('omits injectId / media / parentPostId / engagementBaseline entirely when absent', async () => {
    await publishPost(PARTICIPANT_INPUT)

    const body = lastBody()
    for (const key of ['injectId', 'media', 'parentPostId', 'engagementBaseline']) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('includes injectId only when supplied', async () => {
    await publishPost({ ...PARTICIPANT_INPUT, injectId: '042' })
    expect(lastBody()).toHaveProperty('injectId', '042')
  })

  it('never sends fields outside the wire contract (linkPreview, counts)', async () => {
    await publishPost({
      ...PARTICIPANT_INPUT,
      linkPreview: { title: 'Title', domain: 'example.news' },
      counts: { like: 99 },
    })

    const body = lastBody()
    expect(body).not.toHaveProperty('linkPreview')
    expect(body).not.toHaveProperty('counts')
  })
})

describe('publishPost — media[] v2 (never the legacy placeholder)', () => {
  it('sends exactly { mediaId, alt, posterMediaId? } per attachment', async () => {
    await publishPost({
      ...PARTICIPANT_INPUT,
      media: [
        { mediaId: 'asset-image-1', alt: 'Flooded street' },
        { mediaId: 'asset-video-1', alt: 'Crew briefing', posterMediaId: 'asset-poster-1' },
      ],
    })

    expect(lastBody().media).toEqual([
      { mediaId: 'asset-image-1', alt: 'Flooded street' },
      { mediaId: 'asset-video-1', alt: 'Crew briefing', posterMediaId: 'asset-poster-1' },
    ])
  })

  it('does not forward stray keys on an attachment (explicit pick, not a spread)', async () => {
    const withExtras = { mediaId: 'asset-1', alt: 'x', kind: 'image', url: '/x.png' }

    await publishPost({
      ...PARTICIPANT_INPUT,
      media: [withExtras],
    })

    const [item] = lastBody().media as Record<string, unknown>[]
    expect(Object.keys(item ?? {}).sort()).toEqual(['alt', 'mediaId'])
  })
})

describe('publishPost — replies and the staff-only baseline', () => {
  it('sends parentPostId for a reply', async () => {
    await publishPost({ ...PARTICIPANT_INPUT, parentPostId: 'post-parent-1' })
    expect(lastBody()).toHaveProperty('parentPostId', 'post-parent-1')
  })

  it('sends engagementBaseline for a controller-as-persona origin', async () => {
    postMock.mockResolvedValue({ data: STAFF_VIEW })

    await publishPost({
      ...CONTROLLER_AS_PERSONA_INPUT,
      engagementBaseline: { like: 290, repost: 150, reply: 64 },
    })

    expect(lastBody().engagementBaseline).toEqual({ like: 290, repost: 150, reply: 64 })
  })

  it('drops engagementBaseline for a participant origin (staff-only)', async () => {
    await publishPost({ ...PARTICIPANT_INPUT, engagementBaseline: { like: 1000 } })
    expect(lastBody()).not.toHaveProperty('engagementBaseline')
  })
})

describe('publishPost — resolves with the parsed 201 view', () => {
  it('resolves with the participant-shaped body', async () => {
    const view = await publishPost(PARTICIPANT_INPUT)

    expect(view.id).toBe(PARTICIPANT_VIEW.id)
    expect(view.text).toBe('Zones 2-4 are clear now.')
    expect(view).not.toHaveProperty('origin')
  })

  it('resolves with the staff-shaped body (provenance retained for the staff caller)', async () => {
    postMock.mockResolvedValue({ data: STAFF_VIEW })

    const view = await publishPost(CONTROLLER_AS_PERSONA_INPUT)

    expect(view).toMatchObject({ id: STAFF_VIEW.id, origin: 'controller-as-persona' })
  })

  it('carries a v2 reply body (inReplyTo) and media through untouched', async () => {
    postMock.mockResolvedValue({
      data: {
        ...PARTICIPANT_VIEW,
        inReplyTo: { postId: 'post-parent-1', authorHandle: 'FulcoEM' },
        media: [
          { id: 'm1', kind: 'image', url: 'https://x/y.jpg', alt: 'Alt', width: 10, height: 5 },
        ],
      },
    })

    const view = await publishPost({ ...PARTICIPANT_INPUT, parentPostId: 'post-parent-1' })

    expect(view.inReplyTo).toEqual({ postId: 'post-parent-1', authorHandle: 'FulcoEM' })
    expect(view.media).toHaveLength(1)
  })
})

describe('publishPost — rejects, swallows nothing', () => {
  it('propagates a rejected request (non-2xx) to the caller', async () => {
    postMock.mockRejectedValueOnce(new Error('network down'))

    await expect(publishPost(PARTICIPANT_INPUT)).rejects.toThrow('network down')
  })

  it('propagates an HTTP error response untouched (e.g. a 400)', async () => {
    const httpError = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: 'Each attachment needs alt text.' },
    })
    postMock.mockRejectedValueOnce(httpError)

    await expect(publishPost(PARTICIPANT_INPUT)).rejects.toBe(httpError)
  })

  it('rejects a 2xx body that is not a post (fail closed)', async () => {
    postMock.mockResolvedValueOnce({ data: {} })

    await expect(publishPost(PARTICIPANT_INPUT)).rejects.toThrow(/malformed/)
  })

  it('rejects a 2xx body whose media is malformed (fail closed)', async () => {
    postMock.mockResolvedValueOnce({
      data: { ...PARTICIPANT_VIEW, media: [{ kind: 'image', alt: 'no id or url' }] },
    })

    await expect(publishPost(PARTICIPANT_INPUT)).rejects.toThrow(/malformed/)
  })
})
