/**
 * features/social/services/livePostActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE post-publish action (posts / persona-operation; COR-001,
 * COR-018, COR-053):
 *  - `publishPost` POSTs `/posts` with the wire body mapped off
 *    `CreatePostInput` — no client `exerciseId` (COR-001);
 *  - both sanctioned origins (`participant`, `controller-as-persona`) map
 *    through identically — this module carries no origin-specific branching;
 *  - `injectId`/`media` are included only when supplied;
 *  - the returned promise reflects the underlying request (resolves on
 *    success, rejects on failure) — callers own the fire-and-forget
 *    `.catch()`, this module does not swallow anything itself.
 *
 * `api.post` is mocked (`vi.mock('@/core/services/api')`, hoisted above
 * imports by Vitest) so no real network call is made.
 */
import { describe, expect, it, vi } from 'vitest'
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

describe('publishPost — wire contract (COR-001)', () => {
  it('POSTs /posts with the participant-origin body, no client exerciseId', async () => {
    postMock.mockResolvedValueOnce({ data: {} })

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
    postMock.mockResolvedValueOnce({ data: {} })

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

  it('includes injectId and media only when supplied', async () => {
    postMock.mockResolvedValueOnce({ data: {} })

    await publishPost({
      ...PARTICIPANT_INPUT,
      injectId: '042',
      media: [{ kind: 'image', alt: 'flood photo' }],
    })

    expect(postMock).toHaveBeenCalledWith('/posts', expect.objectContaining({
      injectId: '042',
      media: [{ kind: 'image', alt: 'flood photo' }],
    }))
  })

  it('omits injectId/media entirely when absent (never sends them as undefined)', async () => {
    postMock.mockResolvedValueOnce({ data: {} })

    await publishPost(PARTICIPANT_INPUT)

    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body).not.toHaveProperty('injectId')
    expect(body).not.toHaveProperty('media')
  })

  it('propagates a rejected request to the caller (this module does not swallow it)', async () => {
    postMock.mockRejectedValueOnce(new Error('network down'))

    await expect(publishPost(PARTICIPANT_INPUT)).rejects.toThrow('network down')
  })
})
