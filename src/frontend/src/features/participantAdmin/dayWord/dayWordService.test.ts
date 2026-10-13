/**
 * features/participantAdmin/dayWord/dayWordService.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 11: boundary-mocked coverage for the day-word data seam -
 * paths, bodies, runtime guards and error translation.
 *
 * `@/core/services/api` is mocked at the module boundary (as in
 * `exerciseSettingsService.test.ts`) so these tests pin the request shape the
 * live endpoint will see, with no request ever reaching a sink. `axios` itself is
 * NOT mocked - the error tests build real `AxiosError`s so `axios.isAxiosError`
 * recognises them, exactly as a live 400 / 403 would arrive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  DAY_WORD_ENDPOINT,
  DayWordError,
  deleteDayWord,
  getDayWordStatus,
  parseDayWordSetResult,
  parseDayWordStatus,
  putDayWord,
} from './dayWordService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPut = vi.mocked(api.put)
const mockDelete = vi.mocked(api.delete)

const STATUS_BODY = {
  timeZone: 'America/New_York',
  today: '2026-10-13',
  todayEndsAt: '2026-10-14T04:00:00.0000000Z',
  todaySet: true,
  setAt: '2026-10-13T13:02:00.0000000Z',
  setByName: 'Alex Rivera',
  replacedCount: 2,
  upcoming: [{ date: '2026-10-15', setAt: '2026-10-13T13:05:00.0000000Z' }],
}

/** The day the panel shows as "today" in these tests. */
const DAY = '2026-10-13'

const SET_BODY = {
  date: '2026-10-13',
  word: 'harbor-cedar-47',
  generated: true,
  replaced: false,
  setAt: '2026-10-13T13:02:00.0000000Z',
  validUntil: '2026-10-14T04:00:00.0000000Z',
}

/** A real AxiosError carrying a response, as a live 4xx arrives. */
function axiosError(status: number, data: unknown): AxiosError {
  const response = { status, statusText: '', headers: {}, config: {}, data } as AxiosResponse
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_REQUEST,
    undefined,
    null,
    response,
  )
}

/** The `DayWordError` a call rejects with; fails the test if it resolves. */
async function failureOf(promise: Promise<unknown>): Promise<DayWordError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof DayWordError) return error
    throw error
  }
  throw new Error('expected the call to reject')
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('DAY_WORD_ENDPOINT', () => {
  it('is relative to the shared client base URL (/api), under /staff', () => {
    expect(DAY_WORD_ENDPOINT).toBe('/staff/day-word')
  })
})

describe('getDayWordStatus', () => {
  it('GETs /staff/day-word with no query and no exercise id', async () => {
    mockGet.mockResolvedValue({ data: STATUS_BODY } as AxiosResponse)

    await getDayWordStatus()

    expect(mockGet).toHaveBeenCalledTimes(1)
    const [url, config] = mockGet.mock.calls[0] ?? []
    expect(url).toBe('/staff/day-word')
    expect(config).not.toHaveProperty('params')
  })

  it('returns the status as a clean typed copy', async () => {
    mockGet.mockResolvedValue({ data: STATUS_BODY } as AxiosResponse)
    await expect(getDayWordStatus()).resolves.toEqual(STATUS_BODY)
  })

  it('accepts a not-set status (setAt / setByName omitted, never null)', async () => {
    const unset = {
      timeZone: 'America/New_York',
      today: '2026-10-13',
      todayEndsAt: '2026-10-14T04:00:00Z',
      todaySet: false,
      replacedCount: 0,
      upcoming: [],
    }
    mockGet.mockResolvedValue({ data: unset } as AxiosResponse)
    const status = await getDayWordStatus()
    expect(status.todaySet).toBe(false)
    expect(status).not.toHaveProperty('setAt')
    expect(status).not.toHaveProperty('setByName')
  })

  it('never lets a word through, even if a buggy server sent one', async () => {
    mockGet.mockResolvedValue({
      data: { ...STATUS_BODY, word: 'leaked-word-99', todayWord: 'leaked-word-99' },
    } as AxiosResponse)

    const status = await getDayWordStatus()

    expect(JSON.stringify(status)).not.toContain('leaked-word-99')
    expect(status).not.toHaveProperty('word')
  })

  it.each([
    ['not an object', 'oops'],
    ['missing timeZone', { ...STATUS_BODY, timeZone: undefined }],
    ['bad today', { ...STATUS_BODY, today: 'tuesday' }],
    ['non-boolean todaySet', { ...STATUS_BODY, todaySet: 'yes' }],
    ['non-numeric replacedCount', { ...STATUS_BODY, replacedCount: '2' }],
    ['upcoming not an array', { ...STATUS_BODY, upcoming: {} }],
    ['an upcoming row with a bad date', { ...STATUS_BODY, upcoming: [{ date: 'x', setAt: 'y' }] }],
    ['null todaySet', { ...STATUS_BODY, todaySet: null }],
    ['null replacedCount', { ...STATUS_BODY, replacedCount: null }],
    ['null timeZone', { ...STATUS_BODY, timeZone: null }],
    ['null today', { ...STATUS_BODY, today: null }],
    ['null todayEndsAt', { ...STATUS_BODY, todayEndsAt: null }],
    ['null upcoming', { ...STATUS_BODY, upcoming: null }],
    ['an upcoming row with a null setAt', {
      ...STATUS_BODY,
      upcoming: [{ date: '2026-10-15', setAt: null }],
    }],
  ])('fails closed on a malformed body: %s', async (_name, data) => {
    mockGet.mockResolvedValue({ data } as AxiosResponse)
    await expect(getDayWordStatus()).rejects.toBeInstanceOf(DayWordError)
  })

  it('gives a malformed 2xx its OWN kind, not a connection or HTTP error', async () => {
    mockGet.mockResolvedValue({ data: { nope: true }, status: 200 } as AxiosResponse)

    const error = await failureOf(getDayWordStatus())

    expect(error).toBeInstanceOf(DayWordError)
    expect(error.kind).toBe('malformed')
    expect(error.status).toBeUndefined()
    expect(error.message).toMatch(/malformed/)
    expect(error.message).not.toMatch(/connection|network/i)
  })

  it('reads a null setAt / setByName (display-only) as absent, and still parses the rest', async () => {
    mockGet.mockResolvedValue({
      data: { ...STATUS_BODY, todaySet: false, setAt: null, setByName: null },
    } as AxiosResponse)

    const status = await getDayWordStatus()

    expect(status).not.toHaveProperty('setAt')
    expect(status).not.toHaveProperty('setByName')
    expect(status.todaySet).toBe(false)
    expect(status.upcoming).toEqual(STATUS_BODY.upcoming)
  })

  it('translates a 403 into a DayWordError carrying the status', async () => {
    mockGet.mockRejectedValue(axiosError(403, { title: 'Forbidden', detail: 'Wrong role.' }))
    await expect(getDayWordStatus()).rejects.toMatchObject({
      name: 'DayWordError',
      status: 403,
      serverMessage: 'Wrong role.',
    })
  })

  it('translates a network failure into a DayWordError with no status', async () => {
    mockGet.mockRejectedValue(new Error('Network Error'))
    const error = await getDayWordStatus().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DayWordError)
    expect((error as DayWordError).status).toBeUndefined()
    expect((error as DayWordError).kind).toBe('unknown')
  })

  it('classifies "no response at all" as a network error and a 4xx as http', async () => {
    mockGet.mockRejectedValueOnce(new AxiosError('Network Error', AxiosError.ERR_NETWORK))
    const network = await failureOf(getDayWordStatus())
    expect(network.kind).toBe('network')
    expect(network.status).toBeUndefined()

    mockGet.mockRejectedValueOnce(axiosError(403, { detail: 'No.' }))
    const http = await failureOf(getDayWordStatus())
    expect(http.kind).toBe('http')
    expect(http.status).toBe(403)
  })
})

describe('putDayWord', () => {
  it('ALWAYS sends the date, even for today and even when generating (Gate-2 W-1)', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)

    await putDayWord({ date: DAY })

    const [url, body] = mockPut.mock.calls[0] ?? []
    expect(url).toBe('/staff/day-word')
    // A generated word omits `word`, but the date the panel displays is always named.
    expect(body).toEqual({ date: DAY })
    expect(body).not.toHaveProperty('word')
  })

  it('does not turn an undefined word into a key, but keeps the date', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)
    await putDayWord({ word: undefined, date: DAY })
    expect(mockPut.mock.calls[0]?.[1]).toEqual({ date: DAY })
  })

  it('sends a typed word and a pre-set date', async () => {
    mockPut.mockResolvedValue({ data: { ...SET_BODY, generated: false } } as AxiosResponse)

    await putDayWord({ word: 'Pine Cone 42', date: '2026-10-15' })

    expect(mockPut.mock.calls[0]?.[1]).toEqual({ word: 'Pine Cone 42', date: '2026-10-15' })
  })

  it('sends the date on every call, whatever the word', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)

    await putDayWord({ date: DAY })
    await putDayWord({ word: 'Pine Cone 42', date: DAY })
    await putDayWord({ word: 'Pine Cone 42', date: '2026-10-20' })

    expect(mockPut.mock.calls).toHaveLength(3)
    for (const call of mockPut.mock.calls) {
      expect(call[1]).toHaveProperty('date')
      expect((call[1] as { date: unknown }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('returns the one-time result', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)
    await expect(putDayWord({ date: DAY })).resolves.toEqual(SET_BODY)
  })

  it.each([
    ['not an object', null],
    ['an empty word', { ...SET_BODY, word: '' }],
    ['a missing word', { ...SET_BODY, word: undefined }],
    ['non-boolean generated', { ...SET_BODY, generated: 'yes' }],
    ['non-boolean replaced', { ...SET_BODY, replaced: 1 }],
    ['a bad date', { ...SET_BODY, date: 'today' }],
    ['a missing validUntil', { ...SET_BODY, validUntil: undefined }],
  ])('fails closed on a malformed result: %s', async (_name, data) => {
    mockPut.mockResolvedValue({ data } as AxiosResponse)
    await expect(putDayWord({ date: DAY })).rejects.toMatchObject({
      name: 'DayWordError',
      kind: 'malformed',
    })
  })

  it('does not accept a null in a result field (only the status\' display-only fields)', async () => {
    mockPut.mockResolvedValue({ data: { ...SET_BODY, setAt: null } } as AxiosResponse)
    await expect(putDayWord({ date: DAY })).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('carries the server reason on a 400 (ProblemDetails detail)', async () => {
    mockPut.mockRejectedValue(
      axiosError(400, { title: 'Bad Request', detail: 'The word must be 6 to 64 letters.' }),
    )
    await expect(putDayWord({ word: 'abc', date: DAY })).rejects.toMatchObject({
      status: 400,
      serverMessage: 'The word must be 6 to 64 letters.',
    })
  })

  it('never puts the word into an error message', async () => {
    mockPut.mockRejectedValue(axiosError(400, { detail: 'No.' }))
    const error = await putDayWord({ word: 'super-secret-77', date: DAY }).catch((e: unknown) => e)
    expect(String((error as DayWordError).message)).not.toContain('super-secret-77')
    expect(String((error as DayWordError).serverMessage)).not.toContain('super-secret-77')
  })
})

describe('deleteDayWord', () => {
  it('ALWAYS passes ?date=, including for today (Gate-2 W-1)', async () => {
    mockDelete.mockResolvedValue({ status: 204 } as AxiosResponse)

    await expect(deleteDayWord(DAY)).resolves.toBeUndefined()

    const [url, config] = mockDelete.mock.calls[0] ?? []
    expect(url).toBe('/staff/day-word')
    expect(config).toMatchObject({ params: { date: DAY } })
  })

  it('passes ?date= for a later day', async () => {
    mockDelete.mockResolvedValue({ status: 204 } as AxiosResponse)

    await deleteDayWord('2026-10-15')

    expect(mockDelete.mock.calls[0]?.[1]).toMatchObject({ params: { date: '2026-10-15' } })
  })

  it('translates a 400 / 403', async () => {
    mockDelete.mockRejectedValue(axiosError(403, { detail: 'Nope.' }))
    await expect(deleteDayWord(DAY)).rejects.toMatchObject({ status: 403, serverMessage: 'Nope.' })
  })
})

describe('parsers', () => {
  it('parseDayWordStatus returns null for non-objects', () => {
    expect(parseDayWordStatus(undefined)).toBeNull()
    expect(parseDayWordStatus([])).toBeNull()
  })

  it('parseDayWordSetResult returns a fresh object with exactly the contract fields', () => {
    const parsed = parseDayWordSetResult({ ...SET_BODY, extra: 'x' })
    expect(parsed).toEqual(SET_BODY)
    expect(parsed).not.toHaveProperty('extra')
  })
})

describe('the error never carries the request body (the word)', () => {
  const WORD = 'granite-harbor-4417-SECRET'

  /** A real AxiosError whose config / request / response all contain the word. */
  function errorWithWordEverywhere(status: number | null): AxiosError {
    const config = {
      url: '/staff/day-word',
      method: 'put',
      data: JSON.stringify({ word: WORD }),
      headers: {},
    } as never
    const response = status === null
      ? undefined
      : ({ status, statusText: '', headers: {}, config, data: { detail: 'Not accepted.' } } as AxiosResponse)
    return new AxiosError(
      `Request failed with status code ${status ?? 0}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      { responseURL: `/staff/day-word?w=${WORD}` },
      response,
    )
  }

  /** Every own property (enumerable or not) of the error, serialised. */
  function everythingOn(error: Error): string {
    return Object.getOwnPropertyNames(error)
      .map(key => {
        const value = (error as unknown as Record<string, unknown>)[key]
        return `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`
      })
      .join('\n')
  }

  it.each([
    ['a 400', 400],
    ['a 500', 500],
    ['no response at all', null],
  ])('drops the AxiosError (and its config.data) for %s', async (_name, status) => {
    mockPut.mockRejectedValue(errorWithWordEverywhere(status))

    const error = await failureOf(putDayWord({ word: WORD, date: DAY }))

    expect(error).toBeInstanceOf(DayWordError)
    expect(JSON.stringify(error)).not.toContain(WORD)
    expect(String(error)).not.toContain(WORD)
    expect(everythingOn(error)).not.toContain(WORD)
    expect(JSON.stringify(error.cause)).not.toContain(WORD)
  })

  it('keeps only a sanitised { code, status } as the cause', async () => {
    mockPut.mockRejectedValue(errorWithWordEverywhere(400))

    const error = await failureOf(putDayWord({ word: WORD, date: DAY }))

    expect(error.cause).toEqual({ code: 'ERR_BAD_REQUEST', status: 400 })
    expect(error.cause).not.toBeInstanceOf(Error)
  })

  it('does not keep a non-axios error as the cause either', async () => {
    mockPut.mockRejectedValue(new TypeError(`bad ${WORD}`))

    const error = await failureOf(putDayWord({ word: WORD, date: DAY }))

    expect(error.cause).toBeUndefined()
  })
})

describe('server messages (S-7)', () => {
  it('shows a string body on a 400, trimmed', async () => {
    mockPut.mockRejectedValue(axiosError(400, '  The word is too short.  '))
    await expect(putDayWord({ word: 'abc', date: DAY })).rejects.toMatchObject({
      serverMessage: 'The word is too short.',
    })
  })

  it.each([401, 403, 404, 500, 502, 503])(
    'ignores a string body on a %i (a proxy page, not a reason)',
    async status => {
      mockGet.mockRejectedValue(axiosError(status, '<html><body>Bad Gateway</body></html>'))
      const error = await failureOf(getDayWordStatus())
      expect(error.status).toBe(status)
      expect(error.serverMessage).toBeUndefined()
    },
  )

  it('still reads a ProblemDetails detail on any status', async () => {
    mockGet.mockRejectedValue(axiosError(503, { title: 'Unavailable', detail: 'Back soon.' }))
    await expect(getDayWordStatus()).rejects.toMatchObject({ serverMessage: 'Back soon.' })
  })

  it('caps a very long reason', async () => {
    mockPut.mockRejectedValue(axiosError(400, { detail: 'x'.repeat(2000) }))
    const error = await failureOf(putDayWord({ word: 'abc', date: DAY }))
    expect((error.serverMessage ?? '').length).toBeLessThanOrEqual(301)
  })
})
