/**
 * features/planner/services/chromeSettingsService.test.ts
 * ---------------------------------------------------------------------------
 * Story 02 (compliance chrome — exercise-configuration; #41 / story #68):
 * boundary-mocked coverage for the COR-031 chrome-config data seam.
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
  ChromeSettingsError,
  getChromeSettings,
  updateChromeSettings,
  violatesWatermarkInvariant,
  type ChromeSettings,
  type ChromeSettingsUpdate,
} from './chromeSettingsService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPut = vi.mocked(api.put)

/** A representative, PART-CONFIGURED body: several banner fields are `null`. */
const VALID_BODY: ChromeSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  chromeEnabled: true,
  watermarkEnabled: true,
  topText: 'UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY',
  topFg: '#eaf5e6',
  topBg: '#2e6b2e',
  bottomText: null,
  bottomFg: null,
  bottomBg: null,
}

/** A complete full-replace body (every settable field named). */
const UPDATE: ChromeSettingsUpdate = {
  chromeEnabled: true,
  watermarkEnabled: true,
  topText: 'UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY',
  topFg: '#eaf5e6',
  topBg: '#2e6b2e',
  bottomText: null,
  bottomFg: null,
  bottomBg: null,
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

// ---------------------------------------------------------------------------

describe('violatesWatermarkInvariant (the NFR-008 mirror)', () => {
  it('is true only when BOTH markings are off', () => {
    expect(violatesWatermarkInvariant(false, false)).toBe(true)
  })

  it('is false when either marking remains on - chrome-off alone is legal (D7-008)', () => {
    expect(violatesWatermarkInvariant(false, true)).toBe(false)
    expect(violatesWatermarkInvariant(true, false)).toBe(false)
    expect(violatesWatermarkInvariant(true, true)).toBe(false)
  })
})

describe('getChromeSettings', () => {
  it('resolves the server body unchanged', async () => {
    mockGet.mockResolvedValue({ data: VALID_BODY } as AxiosResponse)

    await expect(getChromeSettings()).resolves.toEqual(VALID_BODY)
  })

  it('requests the staff chrome route and NEVER names an exercise (COR-001 / XC-002)', async () => {
    mockGet.mockResolvedValue({ data: VALID_BODY } as AxiosResponse)

    await getChromeSettings()

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/staff/chrome-settings')
    expect(call?.[0]).not.toContain(VALID_BODY.exerciseId)
    const config = call?.[1] as Record<string, unknown> | undefined
    expect(config).not.toHaveProperty('params')
  })

  it('fails closed on an out-of-shape body rather than casting it into the editor', async () => {
    mockGet.mockResolvedValue({ data: { chromeEnabled: 'yes' } } as AxiosResponse)

    await expect(getChromeSettings()).rejects.toBeInstanceOf(ChromeSettingsError)
  })

  it('fails closed when a banner field is a number rather than string-or-null', async () => {
    mockGet.mockResolvedValue({ data: { ...VALID_BODY, topText: 42 } } as AxiosResponse)

    await expect(getChromeSettings()).rejects.toBeInstanceOf(ChromeSettingsError)
  })

  it('fails closed on an empty body', async () => {
    mockGet.mockResolvedValue({ data: undefined } as AxiosResponse)

    await expect(getChromeSettings()).rejects.toThrow(/empty or malformed/i)
  })

  it('translates a 401 into a status-carrying ChromeSettingsError', async () => {
    mockGet.mockRejectedValue(axiosErrorWith(401, ''))

    await expect(getChromeSettings()).rejects.toMatchObject({
      name: 'ChromeSettingsError',
      status: 401,
    })
  })

  it('translates a network failure into an error with NO status', async () => {
    mockGet.mockRejectedValue(new Error('Network Error'))

    const error = await getChromeSettings().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChromeSettingsError)
    expect((error as ChromeSettingsError).status).toBeUndefined()
  })
})

describe('updateChromeSettings', () => {
  it('PUTs the full-replace body to the staff chrome route', async () => {
    mockPut.mockResolvedValue({ data: VALID_BODY } as AxiosResponse)

    await updateChromeSettings(UPDATE)

    const call = mockPut.mock.calls[0]
    expect(call?.[0]).toBe('/staff/chrome-settings')
    expect(call?.[1]).toEqual(UPDATE)
  })

  it('resolves the SERVER re-projection, not the submitted body', async () => {
    // The server sanitizes banner text (NFR-004), so its response - not the form
    // state - is the truth about what was stored.
    const sanitized: ChromeSettings = { ...VALID_BODY, topText: 'UNCLASSIFIED' }
    mockPut.mockResolvedValue({ data: sanitized } as AxiosResponse)

    await expect(
      updateChromeSettings({ ...UPDATE, topText: '<script>x</script>UNCLASSIFIED' }),
    ).resolves.toEqual(sanitized)
  })

  it('surfaces the server 400 reason verbatim - the NFR-008 rejection reaches the planner', async () => {
    mockPut.mockRejectedValue(
      axiosErrorWith(
        400,
        'Compliance chrome and the in-content EXERCISE watermark must not both be off (NFR-008).',
      ),
    )

    const error = await updateChromeSettings({
      ...UPDATE,
      chromeEnabled: false,
      watermarkEnabled: false,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ChromeSettingsError)
    expect((error as ChromeSettingsError).status).toBe(400)
    expect((error as ChromeSettingsError).serverMessage).toContain('NFR-008')
  })

  it('reads a reason out of a ProblemDetails-shaped body too', async () => {
    mockPut.mockRejectedValue(axiosErrorWith(400, { detail: 'topFg must be a CSS hex color.' }))

    const error = await updateChromeSettings(UPDATE).catch((e: unknown) => e)
    expect((error as ChromeSettingsError).serverMessage).toBe('topFg must be a CSS hex color.')
  })

  it('translates a 403 (staff not assigned to the resolved exercise)', async () => {
    mockPut.mockRejectedValue(axiosErrorWith(403, ''))

    await expect(updateChromeSettings(UPDATE)).rejects.toMatchObject({ status: 403 })
  })

  it('fails closed on a malformed write response', async () => {
    mockPut.mockResolvedValue({ data: { exerciseId: 'x' } } as AxiosResponse)

    await expect(updateChromeSettings(UPDATE)).rejects.toBeInstanceOf(ChromeSettingsError)
  })
})
