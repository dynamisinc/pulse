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
    ['null setAt (omitted, never null)', { ...STATUS_BODY, setAt: null }],
  ])('fails closed on a malformed body: %s', async (_name, data) => {
    mockGet.mockResolvedValue({ data } as AxiosResponse)
    await expect(getDayWordStatus()).rejects.toBeInstanceOf(DayWordError)
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
  })
})

describe('putDayWord', () => {
  it('PUTs an EMPTY body to generate for today (word and date omitted)', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)

    await putDayWord({})

    const [url, body] = mockPut.mock.calls[0] ?? []
    expect(url).toBe('/staff/day-word')
    expect(body).toEqual({})
    expect(body).not.toHaveProperty('word')
    expect(body).not.toHaveProperty('date')
  })

  it('does not turn an undefined field into a key', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)
    await putDayWord({ word: undefined, date: undefined })
    expect(mockPut.mock.calls[0]?.[1]).toEqual({})
  })

  it('sends a typed word and a pre-set date', async () => {
    mockPut.mockResolvedValue({ data: { ...SET_BODY, generated: false } } as AxiosResponse)

    await putDayWord({ word: 'Pine Cone 42', date: '2026-10-15' })

    expect(mockPut.mock.calls[0]?.[1]).toEqual({ word: 'Pine Cone 42', date: '2026-10-15' })
  })

  it('returns the one-time result', async () => {
    mockPut.mockResolvedValue({ data: SET_BODY } as AxiosResponse)
    await expect(putDayWord({})).resolves.toEqual(SET_BODY)
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
    await expect(putDayWord({})).rejects.toBeInstanceOf(DayWordError)
  })

  it('carries the server reason on a 400 (ProblemDetails detail)', async () => {
    mockPut.mockRejectedValue(
      axiosError(400, { title: 'Bad Request', detail: 'The word must be 6 to 64 letters.' }),
    )
    await expect(putDayWord({ word: 'abc' })).rejects.toMatchObject({
      status: 400,
      serverMessage: 'The word must be 6 to 64 letters.',
    })
  })

  it('never puts the word into an error message', async () => {
    mockPut.mockRejectedValue(axiosError(400, { detail: 'No.' }))
    const error = await putDayWord({ word: 'super-secret-77' }).catch((e: unknown) => e)
    expect(String((error as DayWordError).message)).not.toContain('super-secret-77')
    expect(String((error as DayWordError).serverMessage)).not.toContain('super-secret-77')
  })
})

describe('deleteDayWord', () => {
  it('DELETEs /staff/day-word with no date for today', async () => {
    mockDelete.mockResolvedValue({ status: 204 } as AxiosResponse)

    await expect(deleteDayWord()).resolves.toBeUndefined()

    const [url, config] = mockDelete.mock.calls[0] ?? []
    expect(url).toBe('/staff/day-word')
    expect(config).not.toHaveProperty('params')
  })

  it('passes ?date= for a later day', async () => {
    mockDelete.mockResolvedValue({ status: 204 } as AxiosResponse)

    await deleteDayWord('2026-10-15')

    expect(mockDelete.mock.calls[0]?.[1]).toMatchObject({ params: { date: '2026-10-15' } })
  })

  it('translates a 400 / 403', async () => {
    mockDelete.mockRejectedValue(axiosError(403, { detail: 'Nope.' }))
    await expect(deleteDayWord()).rejects.toMatchObject({ status: 403, serverMessage: 'Nope.' })
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
