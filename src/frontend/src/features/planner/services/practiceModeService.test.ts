/**
 * features/planner/services/practiceModeService.test.ts
 * ---------------------------------------------------------------------------
 * Story 04 (practice/sandbox flag — exercise-configuration; #41 / story #70):
 * boundary-mocked coverage for the COR-033 data seam.
 *
 * `@/core/services/api` is mocked at the module boundary (mirrors
 * `exerciseSettingsService.test.ts`) so these tests exercise the seam's own
 * request shape + fail-closed parsing + error translation directly. Mocking the
 * axios client also honours the repo footgun: no request ever reaches a real
 * sink, so a rejection can never crash Vitest worker teardown.
 *
 * `axios` itself is NOT mocked — the error-translation tests build real
 * `AxiosError`s so `axios.isAxiosError` (used inside the seam) recognizes them,
 * exactly as a live 400/401/403 would arrive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  PracticeModeError,
  getPracticeMode,
  setPracticeMode,
  type PracticeModeState,
} from './practiceModeService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPut = vi.mocked(api.put)

/** An unflagged exercise — the shipped default: never flagged means real conduct. */
const UNFLAGGED: PracticeModeState = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  isPracticeMode: false,
  evaluationEligible: true,
}

/** A flagged exercise, as the server projects it. */
const FLAGGED: PracticeModeState = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  isPracticeMode: true,
  evaluationEligible: false,
}

/** Builds a real AxiosError carrying a response (so `axios.isAxiosError` is true). */
function axiosErrorWith(status: number, data: unknown): AxiosError {
  const response = {
    status,
    data,
    statusText: '',
    headers: {},
    config: {},
  } as unknown as AxiosResponse
  return new AxiosError('Request failed', undefined, undefined, undefined, response)
}

/** The URL of the single GET the seam issued (fails loudly if it issued none). */
function requestedGetUrl(): string {
  const call = mockGet.mock.calls[0]
  if (!call) throw new Error('the seam never issued a GET')
  return call[0]
}

/** The URL + body of the single PUT the seam issued (fails loudly if it issued none). */
function requestedPut(): { url: string; body: unknown } {
  const call = mockPut.mock.calls[0]
  if (!call) throw new Error('the seam never issued a PUT')
  return { url: call[0], body: call[1] }
}

beforeEach(() => {
  mockGet.mockReset()
  mockPut.mockReset()
})

// ---------------------------------------------------------------------------

describe('getPracticeMode', () => {
  it('reads the staff route with NO exercise parameter (the scope is server-resolved)', async () => {
    mockGet.mockResolvedValue({ data: UNFLAGGED })

    await expect(getPracticeMode()).resolves.toEqual(UNFLAGGED)

    const url = requestedGetUrl()
    expect(url).toBe('/staff/practice-mode')
    expect(url).not.toContain(UNFLAGGED.exerciseId)
  })

  it('returns the server verdict verbatim for a flagged exercise', async () => {
    mockGet.mockResolvedValue({ data: FLAGGED })

    const state = await getPracticeMode()

    expect(state.isPracticeMode).toBe(true)
    expect(state.evaluationEligible).toBe(false)
  })

  it('fails closed on a malformed body rather than reporting "not a practice exercise"', async () => {
    mockGet.mockResolvedValue({ data: { exerciseId: 'x', isPracticeMode: 'yes' } })

    await expect(getPracticeMode()).rejects.toBeInstanceOf(PracticeModeError)
  })

  it('fails closed on an empty body', async () => {
    mockGet.mockResolvedValue({ data: null })

    await expect(getPracticeMode()).rejects.toBeInstanceOf(PracticeModeError)
  })

  it.each([401, 403, 404])('translates a %s into a PracticeModeError carrying the status', async status => {
    mockGet.mockRejectedValue(axiosErrorWith(status, ''))

    await expect(getPracticeMode()).rejects.toMatchObject({
      name: 'PracticeModeError',
      status,
    })
  })

  it('reports a network failure with no status', async () => {
    mockGet.mockRejectedValue(new Error('Network Error'))

    await expect(getPracticeMode()).rejects.toMatchObject({ status: undefined })
  })
})

describe('setPracticeMode', () => {
  it('PUTs only the flag — the body names no exercise', async () => {
    mockPut.mockResolvedValue({ data: FLAGGED })

    await expect(setPracticeMode({ isPracticeMode: true })).resolves.toEqual(FLAGGED)

    const { url, body } = requestedPut()
    expect(url).toBe('/staff/practice-mode')
    expect(body).toEqual({ isPracticeMode: true })
  })

  it('clears the flag with an explicit false, never by omitting it', async () => {
    mockPut.mockResolvedValue({ data: UNFLAGGED })

    await setPracticeMode({ isPracticeMode: false })

    expect(requestedPut().body).toEqual({ isPracticeMode: false })
  })

  it('surfaces the server reason from a 400 so the panel can show it verbatim', async () => {
    mockPut.mockRejectedValue(axiosErrorWith(400, 'isPracticeMode is required (true or false).'))

    await expect(setPracticeMode({ isPracticeMode: true })).rejects.toMatchObject({
      status: 400,
      serverMessage: 'isPracticeMode is required (true or false).',
    })
  })

  it('fails closed on a malformed write response', async () => {
    mockPut.mockResolvedValue({ data: { isPracticeMode: true } })

    await expect(setPracticeMode({ isPracticeMode: true })).rejects.toBeInstanceOf(
      PracticeModeError,
    )
  })
})
