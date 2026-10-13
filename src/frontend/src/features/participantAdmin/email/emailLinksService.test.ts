/**
 * features/participantAdmin/email/emailLinksService.test.ts
 * ---------------------------------------------------------------------------
 * The data seam: `{}` for everyone, `{ participantIds }` otherwise, never an exercise id;
 * nothing usable or more than 100 is refused with no request; typed errors with fixed,
 * secret-free messages; the runtime guard; and the shipped mock adapter with the same 400
 * rules as the server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { EMAIL_LINKS_ENDPOINT, EmailLinksError, emailLinksBody, sendEmailLinks } from './emailLinksService'
import {
  mockEmailLinksAdapter,
  mockEveryoneResult,
  resetMockEmailLinks,
  setMockEmailLinksScenario,
} from './emailLinksMocks'
import { okResponse } from './emailTestUtils'

afterEach(() => {
  resetMockEmailLinks()
  vi.restoreAllMocks()
})

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, {
    data: { detail: 'jane@example.org https://x/join/SECRET' },
    status,
    statusText: '',
    headers: {},
    config,
  })
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p-${i}`)
}

describe('emailLinksBody', () => {
  it('is {} for no ids: the only way to ask for everyone', () => {
    expect(emailLinksBody([])).toEqual({})
  })

  it('cleans the ids: blanks and repeats dropped, order kept', () => {
    expect(emailLinksBody(['b', '', 'a', 'b', '  '])).toEqual({ participantIds: ['b', 'a'] })
  })

  it('refuses a non-empty input with nothing usable, never widening it to everyone', () => {
    expect(() => emailLinksBody(['', ' '])).toThrow(EmailLinksError)
    expect(() => emailLinksBody(['', ' '])).toThrow(expect.objectContaining({ kind: 'badRequest' }))
  })

  it('accepts 100 and refuses 101', () => {
    expect(emailLinksBody(ids(100)).participantIds).toHaveLength(100)
    expect(() => emailLinksBody(ids(101))).toThrow(expect.objectContaining({ kind: 'tooMany' }))
  })
})

describe('sendEmailLinks', () => {
  it('POSTs the body to the endpoint and returns clean results (null reason dropped)', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(okResponse({
      results: [
        { participantId: 'p-1', status: 'sent', reason: null },
        { participantId: 'p-2', status: 'skipped', reason: 'noEmail', extra: 'ignored' },
      ],
    }))

    const result = await sendEmailLinks(['p-1', 'p-2'])

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, config] = post.mock.calls[0] ?? []
    expect(url).toBe(EMAIL_LINKS_ENDPOINT)
    expect(body).toEqual({ participantIds: ['p-1', 'p-2'] })
    expect(JSON.stringify(body)).not.toMatch(/exercise/i)
    expect(JSON.stringify(config ?? {})).not.toMatch(/exercise/i)
    expect(result).toEqual({
      results: [
        { participantId: 'p-1', status: 'sent' },
        { participantId: 'p-2', status: 'skipped', reason: 'noEmail' },
      ],
    })
  })

  it('makes no request for an unusable or oversized input', async () => {
    const post = vi.spyOn(api, 'post')
    await expect(sendEmailLinks([' '])).rejects.toMatchObject({ kind: 'badRequest' })
    await expect(sendEmailLinks(ids(101))).rejects.toMatchObject({ kind: 'tooMany' })
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'badRequest'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [413, 'badRequest'],
    [500, 'unavailable'],
    [503, 'notConfigured'],
  ])('maps %i to %s, with a fixed message that carries nothing from the response', async (status, kind) => {
    vi.spyOn(api, 'post').mockRejectedValue(httpError(status))

    const error = await sendEmailLinks(['p-1']).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EmailLinksError)
    expect(error).toMatchObject({ kind, status })
    const text = JSON.stringify({ message: (error as Error).message, ...(error as object) })
    expect(text).not.toMatch(/example\.org|join|SECRET/)
    expect((error as Error).cause).toBeUndefined()
  })

  it('a network failure is unavailable', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('socket hang up'))
    await expect(sendEmailLinks(['p-1'])).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it.each([
    [null],
    [{}],
    [{ results: 'no' }],
    [{ results: [{ participantId: 'p-1', status: 'delivered' }] }],
    [{ results: [{ participantId: 1, status: 'sent' }] }],
    [{ results: [{ participantId: 'p-1', status: 'sent', reason: 7 }] }],
  ])('fails closed on an out-of-shape body %j', async data => {
    vi.spyOn(api, 'post').mockResolvedValue(okResponse(data))
    await expect(sendEmailLinks(['p-1'])).rejects.toMatchObject({ kind: 'malformed' })
  })
})

describe('the mock adapter (through the real client)', () => {
  it('serves every status and reason for {}', async () => {
    await expect(sendEmailLinks([])).resolves.toEqual(mockEveryoneResult())
  })

  it('serves one sent per distinct id', async () => {
    await expect(sendEmailLinks(['a', 'b'])).resolves.toEqual({
      results: [{ participantId: 'a', status: 'sent' }, { participantId: 'b', status: 'sent' }],
    })
  })

  it.each([
    ['notConfigured', 'notConfigured'],
    ['forbidden', 'forbidden'],
    ['unauthorized', 'unauthorized'],
    ['serverError', 'unavailable'],
  ] as const)('scenario %s answers as %s', async (scenario, kind) => {
    setMockEmailLinksScenario(scenario)
    await expect(sendEmailLinks(['a'])).rejects.toMatchObject({ kind })
  })

  it.each([
    ['not json'],
    ['null'],
    ['[]'],
    ['{"participantIds":null}'],
    ['{"participantIds":[]}'],
    ['{"participantIds":[1]}'],
    ['{"all":true}'],
    [JSON.stringify({ participantIds: ids(101) })],
  ])('refuses %s with a 400, like the server', async data => {
    const config = { headers: new AxiosHeaders(), data } as InternalAxiosRequestConfig
    await expect(mockEmailLinksAdapter(config)).rejects.toMatchObject({ response: { status: 400 } })
  })
})
