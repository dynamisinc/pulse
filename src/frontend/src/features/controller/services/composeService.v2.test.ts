/**
 * features/controller/services/composeService.v2.test.ts
 * ---------------------------------------------------------------------------
 * The v2 publish seam (demo-polish C1, story 17): reply (`parentPostId`), media,
 * the staff engagement baseline, and the LIVE adapter that replaced the
 * fire-and-forget `.catch(() => {})`.
 *
 *  - the baseline is VALIDATED (integer 0..1,000,000), never clamped: the mock throws
 *    the server's own 400 text (so a bug shows on `npm run dev`, not only on UAT);
 *  - MOCK `composeAsPersona` emits exactly one XC-004 event (`post`, or `reply` with
 *    `payload.parentPostId`); LIVE `publishAsPersonaLive` emits NONE (the server is the
 *    sole emitter) and sends no `exerciseId` on the wire;
 *  - the live `Post` is built from the 201 `StaffPostDto` (origin / acting human /
 *    wall clock from the server), and an unreadable 2xx is `unconfirmed`, never success;
 *  - `classifyPublishFailure` says what each failure proves (rejected / failed /
 *    unconfirmed) and carries the SERVER's message.
 */
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { registerMockMedia, resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import { classifyLiveFailure } from '../runSheet/runSheetFire'
import {
  BASELINE_FIELD_MESSAGE,
  BASELINE_RANGE_MESSAGE,
  ComposeRejectedError,
  ComposeUnconfirmedError,
  MAX_ENGAGEMENT_BASELINE,
  classifyPublishFailure,
  composeAsPersona,
  describeOffscreenFailure,
  isValidBaselineValue,
  parseBaselineField,
  postFromCreated,
  publishAsPersonaLive,
  validateEngagementBaseline,
  type ComposeAsPersonaInput,
} from './composeService'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

const BASE: ComposeAsPersonaInput = {
  exerciseId: 'ex-live-0001',
  timeZone: 'America/New_York',
  scenarioTime: '2033-09-04T14:00:00.000Z',
  authorPersonaId: 'persona-fairhavenwater',
  actingHumanId: 'human-ctl-7',
  text: 'Boil-water advisory lifted for Zone 3.',
}

const STAFF_DTO = {
  id: 'post-201',
  exerciseId: 'ex-live-0001',
  authorPersonaId: 'persona-fairhavenwater',
  actingHumanId: 'human-from-server',
  origin: 'controller-as-persona',
  createdWallClock: '2026-10-08T10:00:00.0000000+00:00',
  text: 'Boil-water advisory lifted for Zone 3.',
  scenarioTime: '2033-09-04T14:00:00.0000000+00:00',
  counts: { reply: 86, repost: 340, like: 1200 },
  media: [{ id: 'asset-1', kind: 'image', url: 'https://x.test/a.png', alt: 'Zone map' }],
  inReplyTo: { postId: 'post-parent', authorHandle: 'pio_jones' },
}

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data,
  })
}

/** Only the `/posts` calls (the telemetry mock sink also posts through the same client). */
function postsCalls() {
  return vi.mocked(api.post).mock.calls.filter(([url]) => url === '/posts')
}

beforeEach(() => {
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: STAFF_DTO, status: 201 })
  resetTelemetryBuffer()
  resetMockMediaRegistry()
})

describe('engagement baseline validation', () => {
  it('accepts whole numbers 0..1,000,000 and nothing else', () => {
    expect(isValidBaselineValue(0)).toBe(true)
    expect(isValidBaselineValue(MAX_ENGAGEMENT_BASELINE)).toBe(true)
    for (const bad of [-1, MAX_ENGAGEMENT_BASELINE + 1, 1.5, Number.NaN, Infinity]) {
      expect(isValidBaselineValue(bad)).toBe(false)
    }
  })

  it.each([
    ['', undefined],
    ['   ', undefined],
    ['0', 0],
    ['1200', 1200],
    [' 42 ', 42],
    ['1000000', 1_000_000],
  ])('parses the field %j as %j', (raw, value) => {
    expect(parseBaselineField(raw)).toEqual({ ok: true, value })
  })

  it.each(['1000001', '-1', '1.5', '1e3', '1,200', 'abc', '+5', '0x10', '१२'])(
    'rejects the field %j with the inline message',
    raw => {
      expect(parseBaselineField(raw)).toEqual({ ok: false, error: BASELINE_FIELD_MESSAGE })
    },
  )

  it('validates a baseline object against the server\'s 400 text', () => {
    expect(validateEngagementBaseline(undefined)).toBeUndefined()
    expect(validateEngagementBaseline({})).toBeUndefined()
    expect(validateEngagementBaseline({ like: 1200, repost: 0, reply: 1_000_000 })).toBeUndefined()
    expect(validateEngagementBaseline({ like: 1_000_001 })).toBe(BASELINE_RANGE_MESSAGE)
    expect(validateEngagementBaseline({ repost: -5 })).toBe(BASELINE_RANGE_MESSAGE)
    expect(validateEngagementBaseline({ reply: 2.5 })).toBe(BASELINE_RANGE_MESSAGE)
    expect(BASELINE_RANGE_MESSAGE).toBe('engagementBaseline values must be between 0 and 1000000.')
  })
})

describe('composeAsPersona (MOCK adapter)', () => {
  it('throws the same 400 as the server for an out-of-range baseline - it never clamps', () => {
    let thrown: unknown
    try {
      composeAsPersona({ ...BASE, engagementBaseline: { like: 1_000_001 } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ComposeRejectedError)
    expect((thrown as ComposeRejectedError).status).toBe(400)
    expect((thrown as ComposeRejectedError).message).toBe(BASELINE_RANGE_MESSAGE)
    // Nothing was created and nothing was emitted.
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('seeds the starting engagement from a valid baseline', () => {
    const post = composeAsPersona({
      ...BASE,
      engagementBaseline: { like: 2300, repost: 340, reply: 86 },
    })
    expect(post.counts).toMatchObject({ like: 2300, repost: 340, reply: 86 })
  })

  it('makes a reply: records parentPostId and emits ONE reply event carrying it', () => {
    const post = composeAsPersona({ ...BASE, parentPostId: 'post-parent' })

    expect(post.parentPostId).toBe('post-parent')
    const events = getEmittedTelemetryEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('reply')
    expect(events[0]?.payload).toEqual({ parentPostId: 'post-parent' })
    expect(events[0]?.origin).toBe('controller-as-persona')
  })

  it('emits exactly ONE post event for a plain post, and none of them is a double count', () => {
    composeAsPersona(BASE)
    expect(getEmittedTelemetryEvents().map(e => e.eventType)).toEqual(['post'])
  })

  it('resolves media through the mock registry and refuses an unknown id like the server\'s 400', () => {
    registerMockMedia({
      id: 'mock-media-x',
      kind: 'image',
      url: '/mock-media/photos/x.svg',
      fileName: 'x.svg',
      uploadedAtScenario: '2033-09-04T12:00:00.000Z',
    })

    const post = composeAsPersona({ ...BASE, media: [{ mediaId: 'mock-media-x', alt: 'Zone map' }] })
    expect(post.media).toMatchObject([{ id: 'mock-media-x', alt: 'Zone map' }])

    expect(() =>
      composeAsPersona({ ...BASE, media: [{ mediaId: 'nope', alt: 'Zone map' }] }),
    ).toThrow(/not available/)
  })
})

describe('publishAsPersonaLive (LIVE adapter)', () => {
  it('POSTs /api/posts once with the v2 body and NO exerciseId', async () => {
    const post = await publishAsPersonaLive({
      ...BASE,
      media: [{ mediaId: 'asset-1', alt: 'Zone map' }],
      parentPostId: 'post-parent',
      engagementBaseline: { like: 1200 },
    })

    const calls = postsCalls()
    expect(calls).toHaveLength(1)
    const body = calls[0]?.[1] as Record<string, unknown>
    expect(body).toEqual({
      authorPersonaId: 'persona-fairhavenwater',
      actingHumanId: 'human-ctl-7',
      text: 'Boil-water advisory lifted for Zone 3.',
      scenarioTime: '2033-09-04T14:00:00.000Z',
      timeZone: 'America/New_York',
      origin: 'controller-as-persona',
      media: [{ mediaId: 'asset-1', alt: 'Zone map' }],
      parentPostId: 'post-parent',
      engagementBaseline: { like: 1200 },
    })
    expect(JSON.stringify(body)).not.toMatch(/exerciseId/i)
    expect(post.id).toBe('post-201')
  })

  it('emits NO frontend telemetry - the server is the sole emitter (no double count)', async () => {
    await publishAsPersonaLive({ ...BASE, parentPostId: 'post-parent' })
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('omits media / parentPostId / baseline when there are none', async () => {
    await publishAsPersonaLive({ ...BASE, media: [] })
    const body = postsCalls()[0]?.[1] as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(
      ['actingHumanId', 'authorPersonaId', 'origin', 'scenarioTime', 'text', 'timeZone'],
    )
  })

  it('builds the Post from the 201 StaffPostDto: the server\'s provenance, counts and reply link', async () => {
    const post = await publishAsPersonaLive(BASE)

    expect(post).toMatchObject({
      id: 'post-201',
      exerciseId: 'ex-live-0001',
      actingHumanId: 'human-from-server',
      origin: 'controller-as-persona',
      createdWallClock: '2026-10-08T10:00:00.0000000+00:00',
      scenarioTime: '2033-09-04T14:00:00.0000000+00:00',
      counts: { reply: 86, repost: 340, like: 1200 },
      inReplyTo: { postId: 'post-parent', authorHandle: 'pio_jones' },
    })
    expect(post.media).toEqual([
      { id: 'asset-1', kind: 'image', url: 'https://x.test/a.png', alt: 'Zone map' },
    ])
  })

  it('falls back to what was sent when the body carries no staff provenance', () => {
    const { exerciseId, actingHumanId, origin, createdWallClock, ...participantShape } = STAFF_DTO
    void [exerciseId, actingHumanId, origin, createdWallClock]

    const post = postFromCreated(participantShape as never, BASE)

    expect(post.origin).toBe('controller-as-persona')
    expect(post.actingHumanId).toBe('human-ctl-7')
    expect(post.exerciseId).toBe('ex-live-0001')
    expect(typeof post.createdWallClock).toBe('string')
  })

  it('refuses an out-of-range baseline before any request', async () => {
    await expect(
      publishAsPersonaLive({ ...BASE, engagementBaseline: { reply: -1 } }),
    ).rejects.toBeInstanceOf(ComposeRejectedError)
    expect(postsCalls()).toHaveLength(0)
  })

  it('passes a non-2xx through as the axios error (nothing swallowed)', async () => {
    const failure = httpError(400, 'engagementBaseline values must be between 0 and 1000000.')
    vi.mocked(api.post).mockRejectedValueOnce(failure)

    await expect(publishAsPersonaLive(BASE)).rejects.toBe(failure)
  })

  it('rejects an unreadable 2xx as UNCONFIRMED - the post may already exist', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { not: 'a post' }, status: 201 })

    await expect(publishAsPersonaLive(BASE)).rejects.toBeInstanceOf(ComposeUnconfirmedError)
  })
})

describe('classifyPublishFailure', () => {
  it('a 4xx is REJECTED and shows the server\'s own plain-string message', () => {
    expect(classifyPublishFailure(httpError(400, 'text is required.'))).toEqual({
      kind: 'rejected',
      status: 400,
      message: 'text is required.',
    })
  })

  it('reads a ProblemDetails detail and an { error } code', () => {
    expect(classifyPublishFailure(httpError(403, { detail: 'Exercise is not live.' })).message)
      .toBe('Exercise is not live.')
    expect(classifyPublishFailure(httpError(429, { error: 'rate_limited' }))).toMatchObject({
      kind: 'failed',
      status: 429,
    })
  })

  it('falls back to a status message when the body has none', () => {
    expect(classifyPublishFailure(httpError(403, undefined)).message).toBe(
      'The server refused the post (HTTP 403).',
    )
  })

  it('429 is FAILED (rate limited before any work: a retry is reasonable)', () => {
    expect(classifyPublishFailure(httpError(429, { error: 'rate_limited' }))).toMatchObject({
      kind: 'failed',
      status: 429,
      message: 'Too many requests right now. Wait a moment and try again.',
    })
    expect(classifyPublishFailure(httpError(429, undefined)).message)
      .toBe('The server could not take the post (HTTP 429).')
  })

  // Gate-2 A M-3: the SAME rule as the run sheet's (`runSheetFire.classifyFailure`). The server
  // can commit a post and still answer 5xx (the post-commit broadcast, a lost commit
  // acknowledgement, a gateway recycling mid-request), so a 5xx never proves nothing was created.
  it('408 and EVERY 5xx are UNCONFIRMED (the post may be live) - not a plain Retry', () => {
    for (const status of [408, 500, 502, 503, 504, 599]) {
      const result = classifyPublishFailure(httpError(status, { error: 'unavailable' }))
      expect(result).toEqual({
        kind: 'unconfirmed',
        status,
        message: 'The post may already be live - check the feed before posting again.',
      })
    }
  })

  // Gate-2 B S-4: the banner shows at most 300 UTF-16 units of the server's text; cutting it
  // between the halves of an emoji would leave a lone surrogate, which renders as U+FFFD.
  it('cuts a long server message without splitting a surrogate pair', () => {
    const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
    // 299 letters + an astral character: the 300-unit cut would fall INSIDE the pair.
    const splitting = `${'a'.repeat(299)}\u{1F600}${'b'.repeat(40)}`
    const cut = classifyPublishFailure(httpError(400, splitting)).message
    expect(cut).toBe(`${'a'.repeat(299)}...`)
    expect(LONE_SURROGATE.test(cut)).toBe(false)

    // The cut right AFTER a whole pair keeps it.
    const whole = `${'a'.repeat(298)}\u{1F600}${'b'.repeat(40)}`
    const kept = classifyPublishFailure(httpError(400, whole)).message
    expect(kept).toBe(`${'a'.repeat(298)}\u{1F600}...`)
    expect(LONE_SURROGATE.test(kept)).toBe(false)

    // A short message is untouched.
    expect(classifyPublishFailure(httpError(400, 'text is required.')).message)
      .toBe('text is required.')
  })

  it('NO response is UNCONFIRMED: a connection that drops after the send looks like one that never connected', () => {
    const dropped = new AxiosError('Network Error', 'ERR_NETWORK')
    const timedOut = new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED')
    for (const failure of [dropped, timedOut]) {
      const result = classifyPublishFailure(failure)
      expect(result.kind).toBe('unconfirmed')
      expect(result.status).toBeUndefined()
      expect(result.message).toMatch(/may have gone out/)
      expect(result.message).toMatch(/check the feed/i)
    }
  })

  it('agrees with the run sheet on every status: 408 / 5xx unconfirmed, 429 and other 4xx not', () => {
    const unconfirmedBoth = (status: number) => {
      const composer = classifyPublishFailure(httpError(status, undefined)).kind === 'unconfirmed'
      const sheet = classifyLiveFailure(httpError(status, undefined)).kind === 'unconfirmed'
      return [composer, sheet]
    }
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(unconfirmedBoth(status)).toEqual([false, false])
    }
    for (const status of [408, 500, 502, 503, 504]) {
      expect(unconfirmedBoth(status)).toEqual([true, true])
    }
  })

  it('a 504, a 2xx the client could not use, and ComposeUnconfirmedError are UNCONFIRMED', () => {
    expect(classifyPublishFailure(httpError(504, undefined)).kind).toBe('unconfirmed')
    expect(classifyPublishFailure(httpError(201, 'garbage')).kind).toBe('unconfirmed')
    expect(classifyPublishFailure(new ComposeUnconfirmedError()).kind).toBe('unconfirmed')
  })

  it('the mock\'s 400 and a plain Error from the mock pipeline are REJECTED with their message', () => {
    expect(classifyPublishFailure(new ComposeRejectedError(BASELINE_RANGE_MESSAGE))).toEqual({
      kind: 'rejected',
      status: 400,
      message: BASELINE_RANGE_MESSAGE,
    })
    expect(classifyPublishFailure(new Error('createPost: that media attachment is not available.')))
      .toMatchObject({ kind: 'rejected' })
  })

  it('strips the engineering "createPost: " prefix from a mock pipeline message', () => {
    expect(classifyPublishFailure(new Error('createPost: that media attachment is not available.')))
      .toEqual({ kind: 'rejected', message: 'that media attachment is not available.' })
    expect(classifyPublishFailure(new Error('createPost:   spaced'))).toMatchObject({
      message: 'spaced',
    })
    // A message with no prefix is left alone; an empty one falls back to a sentence.
    expect(classifyPublishFailure(new Error('plain'))).toMatchObject({ message: 'plain' })
    expect(classifyPublishFailure(new Error('createPost: '))).toMatchObject({
      message: 'The post was not accepted.',
    })
  })

  it('strips control characters and caps an over-long server message', () => {
    const message = classifyPublishFailure(httpError(400, `bad\u0000\u0007 text ${'x'.repeat(500)}`)).message
    // eslint-disable-next-line no-control-regex
    expect(message).not.toMatch(/[\u0000-\u001f]/)
    expect(message.length).toBeLessThanOrEqual(304)
  })
})

describe('describeOffscreenFailure (the toast for a failure nobody was watching)', () => {
  it('names the persona, the status and the reason, and says the draft was restored', () => {
    const text = describeOffscreenFailure('FairhavenWater', {
      kind: 'rejected',
      status: 400,
      message: 'media is not yours.',
    })
    expect(text).toBe('Post as @FairhavenWater failed (HTTP 400): media is not yours. Draft restored.')
  })

  it('does not double the @ or the full stop, and omits a missing status', () => {
    expect(
      describeOffscreenFailure('@Other', { kind: 'failed', message: 'Server busy..' }),
    ).toBe('Post as @Other failed: Server busy. Draft restored.')
  })

  it('says "status unknown - check the feed" for an unconfirmed outcome, never "failed"', () => {
    const text = describeOffscreenFailure('FairhavenWater', {
      kind: 'unconfirmed',
      status: 504,
      message: 'The post may already be live - check the feed before posting again.',
    })
    expect(text).toBe('Post as @FairhavenWater: status unknown - check the feed. Draft restored.')
    expect(text).not.toMatch(/failed/)
  })
})
