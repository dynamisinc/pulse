/**
 * features/participant-shell/chromeConfig.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (compliance chrome) — pure NFR-008 invariant coverage
 * (`isWatermarkRequired`) plus boundary-mocked branch coverage for the
 * `useChromeConfig` mock seam (AC2/AC3; COR-001/XC-002, WAVE0-REVIEW
 * precedent 19). The sibling `chromeConfig.default.test.tsx` covers the
 * SHIPPED path through the real axios client + canned adapter.
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `fetchChromeConfig`'s own validation/fallback logic and
 * `useChromeConfig`'s request-shape contract directly (mirrors
 * `shellState.test.tsx`).
 *
 * `@/core/exerciseContext` is mocked too - exercise-context resolution is a
 * different seam's own concern; only the exerciseId VALUE matters here, for
 * the query key (WAVE0-REVIEW precedent 13: exerciseId keys the cache, it is
 * never sent to the server as a client-supplied scoping parameter).
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isWatermarkRequired, useChromeConfig } from './chromeConfig'
import { api } from '@/core/services/api'
import type { ChromeConfig } from './mountContract'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-chrome-config-0001',
    exerciseName: 'Chrome Config Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockGet = vi.mocked(api.get)

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('isWatermarkRequired (NFR-008 invariant — chrome and watermark never both off)', () => {
  const banner = { text: 'X', fg: '#000000', bg: '#ffffff' }

  it('is true when chrome is disabled - the watermark becomes the required fallback signal', () => {
    const config: ChromeConfig = { enabled: false, top: banner, bottom: banner }
    expect(isWatermarkRequired(config)).toBe(true)
  })

  it('is false when chrome is enabled - the banners already carry the signal', () => {
    const config: ChromeConfig = { enabled: true, top: banner, bottom: banner }
    expect(isWatermarkRequired(config)).toBe(false)
  })
})

describe('useChromeConfig (boundary-mocked branch)', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves a non-default config from a valid mocked response (not the DEFAULT_CHROME_CONFIG fallback)', async () => {
    const mockedConfig: ChromeConfig = {
      enabled: true,
      top: { text: 'MOCK TOP BANNER', fg: '#101010', bg: '#202020' },
      bottom: { text: 'MOCK BOTTOM BANNER', fg: '#303030', bg: '#404040' },
    }
    mockGet.mockResolvedValue({ data: mockedConfig } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.top.text).toBe('MOCK TOP BANNER'))
    expect(result.current).toEqual(mockedConfig)
  })

  it('falls back to the safe-default config - chrome VISIBLE - while the query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    expect(result.current.enabled).toBe(true)
  })

  it('falls back to the safe-default config once a response with an out-of-shape body settles (never renders the bogus shape)', async () => {
    mockGet.mockResolvedValue(
      { data: { enabled: 'not-a-boolean' } } as unknown as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    // Confirm the query actually SETTLES to an error (the runtime guard
    // rejecting the malformed body), not merely that the default shows
    // because the query is still pending - a removed guard would instead
    // settle to a SUCCESS state carrying the bogus `{ enabled: 'not-a-boolean' }`.
    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.top.text).toContain('UNCLASSIFIED')
  })

  it('never sends the exerciseId as a request URL substring or a params key (COR-001, XC-002, precedent 13)', async () => {
    mockGet.mockResolvedValue({
      data: {
        enabled: true,
        top: { text: 'a', fg: '#000000', bg: '#ffffff' },
        bottom: { text: 'b', fg: '#000000', bg: '#ffffff' },
      },
    } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/chrome-config')
    expect(call?.[0]).not.toContain('ex-test-chrome-config-0001')

    const config = call?.[1] as Record<string, unknown> | undefined
    // No `params`/`query` object at all on this call - the exerciseId is read
    // only to key the React Query cache (see chromeConfig.ts header), never
    // to scope the request itself.
    expect(config).not.toHaveProperty('params')
  })
})
