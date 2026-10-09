/**
 * features/controller/runSheet/runSheetFire.live.test.ts
 * ---------------------------------------------------------------------------
 * The fire service in LIVE mode (`USE_MOCK_DATA` forced off for the whole file, like
 * `useComposeAsPersona.test.ts`) - demo-polish C3, AC "Fire / Fire next / Skip":
 *  - the request that reaches `POST /api/posts` carries `origin: 'controller-as-persona'`,
 *    the acting human, `scenarioTime`, `media`, `parentPostId` and `engagementBaseline`, and
 *    NO `exerciseId` (COR-001);
 *  - the 201's post id becomes `firedPostId`;
 *  - FAILURE CLASSIFICATION (F4 / #455: post creation is not idempotent yet): a 4xx is
 *    `failed` (Retry is safe); no response, a 5xx / 504 / 408 and an unreadable 2xx are
 *    `unconfirmed` (the post may be live - never a blind retry).
 *
 * `api.post` is mocked, so the real `publishPost` runs (body mapping + malformed-2xx guard).
 */
import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { buildPostInput, classifyLiveFailure, sendBeat } from './runSheetFire'
import { MOCK_ACTING_HUMAN_ID, beatFixture, personaFixture } from './runSheetTestKit'

const fulco = personaFixture('FulcoEM')
const ctx = {
  exerciseId: 'ex-live-0001',
  timeZone: 'America/New_York',
  actingHumanId: MOCK_ACTING_HUMAN_ID,
  persona: fulco,
}

const CREATED = {
  id: 'b8a1f6f2-0000-4000-8000-000000000001',
  authorPersonaId: fulco.id,
  text: 'ok',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00.0000000+00:00',
}

function httpError(status: number, data: unknown = undefined): AxiosError {
  const response = { status, data, statusText: '', headers: {}, config: {} } as AxiosResponse
  return new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, response)
}

beforeEach(() => {
  postMock.mockReset()
})

describe('sendBeat - live: the request', () => {
  it('POSTs /posts as controller-as-persona with the acting human and NO exerciseId', async () => {
    postMock.mockResolvedValue({ data: CREATED })
    const input = buildPostInput(beatFixture(), ctx)
    const result = await sendBeat(input)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/posts')
    expect(body).toMatchObject({
      origin: 'controller-as-persona',
      authorPersonaId: fulco.id,
      actingHumanId: MOCK_ACTING_HUMAN_ID,
      text: beatFixture().text,
      timeZone: 'America/New_York',
    })
    expect(typeof body.scenarioTime).toBe('string')
    expect(body).not.toHaveProperty('exerciseId')
    expect(JSON.stringify(body)).not.toContain('ex-live-0001')
    expect(result).toEqual({
      kind: 'fired',
      postId: CREATED.id,
      scenarioTime: CREATED.scenarioTime,
    })
  })

  it('sends media, parentPostId and engagementBaseline when the beat has them', async () => {
    postMock.mockResolvedValue({ data: CREATED })
    const beat = beatFixture({
      media: [
        { mediaId: 'media-1', alt: 'Brown water from a tap' },
        { mediaId: 'media-2', alt: 'The plant gate' },
      ],
      engagementBaseline: { like: 120, repost: 40, reply: 5 },
    })
    await sendBeat(buildPostInput(beat, { ...ctx, parentPostId: 'post-parent-1' }))
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.media).toEqual([
      { mediaId: 'media-1', alt: 'Brown water from a tap' },
      { mediaId: 'media-2', alt: 'The plant gate' },
    ])
    expect(body.parentPostId).toBe('post-parent-1')
    expect(body.engagementBaseline).toEqual({ like: 120, repost: 40, reply: 5 })
  })

  it('omits media / parentPostId / engagementBaseline when absent', async () => {
    postMock.mockResolvedValue({ data: CREATED })
    await sendBeat(buildPostInput(beatFixture(), ctx))
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('media')
    expect(body).not.toHaveProperty('parentPostId')
    expect(body).not.toHaveProperty('engagementBaseline')
  })

  it('falls back to the instant it sent when the 201 carries an unparseable scenarioTime', async () => {
    postMock.mockResolvedValue({ data: { ...CREATED, scenarioTime: 'not-a-date' } })
    const input = buildPostInput(beatFixture(), ctx)
    const result = await sendBeat(input)
    expect(result).toMatchObject({ kind: 'fired', scenarioTime: input.scenarioTime })
  })
})

describe('sendBeat - live: failures are classified by what they prove', () => {
  it('a 400 is FAILED (the server refused; nothing was created) and carries the server\'s words', async () => {
    postMock.mockRejectedValue(httpError(400, 'Each media item needs a description.'))
    const result = await sendBeat(buildPostInput(beatFixture(), ctx))
    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' && result.message).toContain('HTTP 400')
    expect(result.kind === 'failed' && result.message).toContain('Each media item needs a description.')
    expect(result.kind === 'failed' && result.message).toContain('Nothing was posted')
  })

  it('a 429 is FAILED with rate-limit wording (retry shortly)', async () => {
    postMock.mockRejectedValue(httpError(429, { error: 'rate_limited' }))
    const result = await sendBeat(buildPostInput(beatFixture(), ctx))
    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' && result.message).toContain('429')
  })

  it.each([
    ['a 500', httpError(500)],
    ['a 502', httpError(502)],
    ['a 503', httpError(503, { error: 'unavailable' })],
    ['a 504 gateway timeout', httpError(504)],
    ['a 408 request timeout', httpError(408)],
  ])('%s is UNCONFIRMED: the post may exist, so never a blind retry', async (_name, error) => {
    postMock.mockRejectedValue(error)
    const result = await sendBeat(buildPostInput(beatFixture(), ctx))
    expect(result.kind).toBe('unconfirmed')
    expect(result.kind === 'unconfirmed' && result.message).toContain('check the Live world')
  })

  it('a dropped connection (no response) is UNCONFIRMED', async () => {
    postMock.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    const result = await sendBeat(buildPostInput(beatFixture(), ctx))
    expect(result.kind).toBe('unconfirmed')
    expect(result.kind === 'unconfirmed' && result.message).toContain('No response')
  })

  it('a malformed 2xx body is UNCONFIRMED: the post may already exist (publishPost rejects it)', async () => {
    postMock.mockResolvedValue({ data: { surprise: true } })
    const result = await sendBeat(buildPostInput(beatFixture(), ctx))
    expect(result.kind).toBe('unconfirmed')
    expect(result.kind === 'unconfirmed' && result.message).toContain('could not be read')
  })

  it('never rejects: even a thrown non-Error is classified', async () => {
    postMock.mockRejectedValue('weird')
    await expect(sendBeat(buildPostInput(beatFixture(), ctx))).resolves.toMatchObject({
      kind: 'unconfirmed',
    })
  })

  it('classifyLiveFailure keeps a long server message bounded', () => {
    const failure = classifyLiveFailure(httpError(400, 'x'.repeat(5000)))
    expect(failure.kind).toBe('failed')
    expect(failure.message.length).toBeLessThan(500)
  })
})
