/**
 * features/planner/services/exerciseSettingsService.test.ts
 * ---------------------------------------------------------------------------
 * Story 01b (per-exercise settings — exercise-configuration; #41 / story #67):
 * boundary-mocked coverage for the COR-030 settings data seam.
 *
 * `@/core/services/api` is mocked at the module boundary (mirrors
 * `accountImportService.test.ts`) so these tests exercise the seam's own request
 * shape + fail-closed parsing + error translation directly. Mocking the axios
 * client also honours the repo footgun: no request ever reaches a real sink, so
 * a rejection can never crash Vitest worker teardown.
 *
 * `axios` itself is NOT mocked — the error-translation tests build real
 * `AxiosError`s so `axios.isAxiosError` (used inside the seam) recognises them,
 * exactly as a live 400/401/403 would arrive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  ExerciseSettingsError,
  getExerciseSettings,
  updateExerciseSettings,
  type ExerciseSettings,
  type ExerciseSettingsUpdate,
} from './exerciseSettingsService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPut = vi.mocked(api.put)

/** A representative, PART-CONFIGURED body: several optional fields are `null`. */
const VALID_BODY: ExerciseSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  name: 'Atlanta CIE 2026',
  worldName: 'Metro Atlanta',
  locale: null,
  timeZone: 'America/New_York',
  scheduledStartAt: '2026-03-01T13:00:00.0000000+00:00',
  scheduledEndAt: null,
  channels: [
    { id: 'social', label: 'Social', enabled: true },
    { id: 'portal', label: 'Portal', enabled: false },
    { id: 'news', label: 'News', enabled: false },
    { id: 'press', label: 'Press Room', enabled: false },
    { id: 'weather', label: 'Weather', enabled: false },
  ],
  brandName: null,
  brandPrimary: '#2b5f75',
  brandAccent: null,
  brandSurface: null,
  brandOnSurface: null,
  outletNames: { news: 'WXYZ 9 News' },
}

/** A complete full-replace body (every settable field named). */
const UPDATE: ExerciseSettingsUpdate = {
  name: 'Atlanta CIE 2026',
  worldName: 'Metro Atlanta',
  locale: null,
  timeZone: 'America/New_York',
  scheduledStartAt: '2026-03-01T13:00:00.000Z',
  scheduledEndAt: null,
  enabledChannels: ['social'],
  brandName: null,
  brandPrimary: '#2b5f75',
  brandAccent: null,
  brandSurface: null,
  brandOnSurface: null,
  outletNames: { news: 'WXYZ 9 News' },
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

beforeEach(() => {
  mockGet.mockReset()
  mockPut.mockReset()
})

describe('getExerciseSettings — request shape (COR-001: the exercise is never a parameter)', () => {
  it('GETs the fixed staff route with no exercise id in the URL and no arguments at all', async () => {
    mockGet.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.get>>)

    await getExerciseSettings()

    expect(mockGet).toHaveBeenCalledTimes(1)
    const call = mockGet.mock.calls[0]
    if (!call) throw new Error('getExerciseSettings did not call api.get')
    const [url] = call
    expect(url).toBe('/staff/exercise-settings')
    // Structural isolation: no `/exercises/{id}/` segment and no query string
    // could carry a caller-chosen exercise.
    expect(url).not.toMatch(/exercises\//)
    expect(url).not.toContain('?')
    // The function itself takes no parameters, so nothing can be smuggled in.
    expect(getExerciseSettings).toHaveLength(0)
  })
})

describe('getExerciseSettings — response parsing', () => {
  it('returns the settings block with its nulls intact (a null is "not configured")', async () => {
    mockGet.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.get>>)

    const settings = await getExerciseSettings()

    expect(settings).toEqual(VALID_BODY)
    expect(settings.locale).toBeNull()
    expect(settings.brandName).toBeNull()
    expect(settings.scheduledEndAt).toBeNull()
  })

  it('returns the FULL closed channel catalog in the order the server sent it', async () => {
    mockGet.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.get>>)

    const settings = await getExerciseSettings()

    expect(settings.channels.map(channel => channel.id)).toEqual([
      'social', 'portal', 'news', 'press', 'weather',
    ])
    expect(settings.channels.filter(channel => channel.enabled).map(c => c.id)).toEqual(['social'])
  })

  it.each<[string, unknown]>([
    ['an empty body', undefined],
    ['a null body', null],
    ['a body missing the required timeZone', { ...VALID_BODY, timeZone: undefined }],
    ['a body whose channels are not the catalog shape', { ...VALID_BODY, channels: ['social'] }],
    ['a body whose outletNames is not a string map', { ...VALID_BODY, outletNames: { news: 7 } }],
  ])('fails closed on %s rather than casting it into settings', async (_label, body) => {
    mockGet.mockResolvedValue({ data: body } as Awaited<ReturnType<typeof api.get>>)

    await expect(getExerciseSettings()).rejects.toBeInstanceOf(ExerciseSettingsError)
  })
})

describe('updateExerciseSettings — request shape (full replace)', () => {
  it('PUTs the whole body to the fixed staff route', async () => {
    mockPut.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.put>>)

    await updateExerciseSettings(UPDATE)

    expect(mockPut).toHaveBeenCalledTimes(1)
    const call = mockPut.mock.calls[0]
    if (!call) throw new Error('updateExerciseSettings did not call api.put')
    const [url, body] = call
    expect(url).toBe('/staff/exercise-settings')
    expect(body).toEqual(UPDATE)
  })

  it('never sends an exercise id — the write has nowhere to bind but the resolved scope', async () => {
    mockPut.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.put>>)

    await updateExerciseSettings(UPDATE)

    const call = mockPut.mock.calls[0]
    if (!call) throw new Error('updateExerciseSettings did not call api.put')
    const [, body] = call
    expect(Object.keys(body as Record<string, unknown>)).not.toContain('exerciseId')
    expect(JSON.stringify(body)).not.toContain(VALID_BODY.exerciseId)
  })

  it('returns the server re-projection, not the submitted body (the server normalizes)', async () => {
    const serverProjection: ExerciseSettings = { ...VALID_BODY, worldName: 'Metro Atlanta' }
    mockPut.mockResolvedValue({ data: serverProjection } as Awaited<ReturnType<typeof api.put>>)

    const saved = await updateExerciseSettings({ ...UPDATE, worldName: '<b>Metro Atlanta</b>' })

    expect(saved).toEqual(serverProjection)
    expect(saved.worldName).toBe('Metro Atlanta')
  })

  it('fails closed on a malformed 200 body', async () => {
    mockPut.mockResolvedValue({ data: { nope: true } } as Awaited<ReturnType<typeof api.put>>)

    await expect(updateExerciseSettings(UPDATE)).rejects.toBeInstanceOf(ExerciseSettingsError)
  })
})

describe('error translation', () => {
  it('extracts the 400 reason from the BARE JSON STRING body the endpoint returns', async () => {
    const reason = "'radio' is not a known channel id. Known ids: social, portal, news, press, weather."
    mockPut.mockRejectedValue(axiosErrorWith(400, reason))

    await expect(updateExerciseSettings(UPDATE)).rejects.toMatchObject({
      name: 'ExerciseSettingsError',
      status: 400,
      serverMessage: reason,
    })
  })

  it.each([401, 403, 404])('carries the %s status through with an empty body', async status => {
    mockGet.mockRejectedValue(axiosErrorWith(status, ''))

    await expect(getExerciseSettings()).rejects.toMatchObject({
      name: 'ExerciseSettingsError',
      status,
      serverMessage: undefined,
    })
  })

  it('reports an undefined status when the request never reached a response', async () => {
    mockGet.mockRejectedValue(new AxiosError('Network Error'))

    await expect(getExerciseSettings()).rejects.toMatchObject({
      name: 'ExerciseSettingsError',
      status: undefined,
    })
  })

  it('wraps a non-axios throw rather than leaking it', async () => {
    mockPut.mockRejectedValue('something odd')

    await expect(updateExerciseSettings(UPDATE)).rejects.toBeInstanceOf(ExerciseSettingsError)
  })
})
