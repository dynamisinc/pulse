/**
 * features/participant-shell/brandTokens.test.tsx
 * ---------------------------------------------------------------------------
 * Story 07 (brand-theming hooks) — pure NFR-001/D0 §4.1 contrast coverage for
 * the screened default tokens, fail-closed consumer-hook coverage
 * (`useBrandTokens`/`useBrand`), exercise-scoping coverage (XC-001), and
 * boundary-mocked branch coverage for the `useBrandConfig` mock seam
 * (COR-066/030, WAVE0-REVIEW precedent 19). The sibling
 * `brandTokens.default.test.tsx` covers the SHIPPED path through the real
 * axios client + canned adapter.
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `fetchBrandTokens`'s own validation/fallback logic and
 * `useBrandConfig`'s request-shape contract directly (mirrors
 * `chromeConfig.test.tsx`).
 *
 * `@/core/exerciseContext` is mocked too - exercise-context resolution is a
 * different seam's own concern; only the exerciseId VALUE matters here, for
 * the query key (WAVE0-REVIEW precedent 13: exerciseId keys the cache, it is
 * never sent to the server as a client-supplied scoping parameter). It is
 * mocked as a `vi.fn()` (not a fixed arrow) so the isolation suite below can
 * swap the resolved exercise mid-file.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrandTokensContext,
  useBrand,
  useBrandConfig,
  useBrandTokens,
  type BrandTokens,
} from './brandTokens'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockGet = vi.mocked(api.get)
const mockUseExerciseContext = vi.mocked(useExerciseContext)

const EXERCISE_A = {
  exerciseId: 'ex-test-brand-tokens-0001',
  exerciseName: 'Brand Tokens Test Exercise',
  timeZone: 'UTC',
  status: 'active' as const,
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  mockGet.mockReset()
  mockUseExerciseContext.mockReset()
  mockUseExerciseContext.mockReturnValue(EXERCISE_A)
})

describe('useBrandConfig (boundary-mocked branch)', () => {
  it('resolves a non-default brand (incl. logo) from a valid mocked response - not the screened default fallback', async () => {
    const mockedTokens: BrandTokens = {
      name: 'Millbrook Community Feed',
      colors: { primary: '#7a1f3d', accent: '#f2b632', surface: '#101418', onSurface: '#f5f5f5' },
      logo: { src: 'https://cdn.example/millbrook-logo.png', alt: 'Millbrook Community Feed logo' },
    }
    mockGet.mockResolvedValue({ data: mockedTokens } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.name).toBe('Millbrook Community Feed'))
    expect(result.current).toEqual(mockedTokens)
    // A component that ever ignored the resolved config and fell back to the
    // screened demo default anyway would still pass a test built around that
    // default (precedent 17) - this fixture is a distinct exercise's brand.
    expect(result.current.name).not.toBe('Sample Exercise Network')
  })

  it('falls back to the screened default tokens - never partial/undefined - while the query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    expect(result.current.name).toBe('Sample Exercise Network')
    expect(result.current.colors).toEqual({
      primary: '#2b5f75',
      accent: '#d97706',
      surface: '#ffffff',
      onSurface: '#1c1c1c',
    })
    expect(result.current.logo).toBeUndefined()
  })

  it('falls back to the screened default once a response missing `colors` settles to error (never a colorless brand)', async () => {
    mockGet.mockResolvedValue(
      { data: { name: 'No Colors Network' } } as unknown as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    // Confirm the query actually SETTLES to an error (the runtime guard
    // rejecting the malformed body), not merely that the default shows
    // because the query is still pending - a removed guard would instead
    // settle to a SUCCESS state carrying the colorless body.
    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.name).toBe('Sample Exercise Network')
  })

  it('falls back to the screened default once a response with a malformed (present-but-invalid) logo settles', async () => {
    mockGet.mockResolvedValue({
      data: {
        name: 'Bad Logo Network',
        colors: { primary: '#000000', accent: '#111111', surface: '#ffffff', onSurface: '#000000' },
        logo: { src: 12345, alt: 'not a string src' },
      },
    } as unknown as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.name).toBe('Sample Exercise Network')
  })

  it('never sends the exerciseId as a request URL substring or a params key (COR-001, XC-002, precedent 13)', async () => {
    mockGet.mockResolvedValue({
      data: {
        name: 'Any Network',
        colors: { primary: '#000000', accent: '#111111', surface: '#ffffff', onSurface: '#000000' },
      },
    } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/brand-tokens')
    expect(call?.[0]).not.toContain(EXERCISE_A.exerciseId)

    const config = call?.[1] as Record<string, unknown> | undefined
    // No `params`/`query` object at all on this call - the exerciseId is read
    // only to key the React Query cache (see brandTokens.ts header), never to
    // scope the request itself.
    expect(config).not.toHaveProperty('params')
  })

  it('scopes brand tokens per exercise - two exercises get distinct cache entries and never leak one brand into the other (XC-001)', async () => {
    const brandA: BrandTokens = {
      name: 'Exercise A Network',
      colors: { primary: '#111111', accent: '#222222', surface: '#ffffff', onSurface: '#000000' },
    }
    const brandB: BrandTokens = {
      name: 'Exercise B Network',
      colors: { primary: '#333333', accent: '#444444', surface: '#ffffff', onSurface: '#000000' },
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    mockUseExerciseContext.mockReturnValue({ ...EXERCISE_A, exerciseId: 'ex-brand-isolation-aaa' })
    mockGet.mockResolvedValueOnce({ data: brandA } as Awaited<ReturnType<typeof api.get>>)
    const { result: resultA } = renderHook(
      () => useBrandConfig(), { wrapper: makeWrapper(queryClient) },
    )
    await waitFor(() => expect(resultA.current.name).toBe(brandA.name))

    mockUseExerciseContext.mockReturnValue({ ...EXERCISE_A, exerciseId: 'ex-brand-isolation-bbb' })
    mockGet.mockResolvedValueOnce({ data: brandB } as Awaited<ReturnType<typeof api.get>>)
    const { result: resultB } = renderHook(
      () => useBrandConfig(), { wrapper: makeWrapper(queryClient) },
    )
    await waitFor(() => expect(resultB.current.name).toBe(brandB.name))

    // Both cache entries co-exist under distinct exerciseId-keyed queries - if
    // exerciseId were ever dropped from the query key, these would collapse
    // into a single shared entry instead of two.
    const keys = queryClient.getQueryCache().findAll().map(q => q.queryKey)
    expect(keys).toContainEqual(['participant-shell', 'brand-tokens', 'ex-brand-isolation-aaa'])
    expect(keys).toContainEqual(['participant-shell', 'brand-tokens', 'ex-brand-isolation-bbb'])

    // Re-mounting exercise A's hook against the SAME queryClient must still
    // resolve exercise A's own cached brand, never exercise B's - a second
    // surface/session can never inherit another exercise's leaked brand.
    mockUseExerciseContext.mockReturnValue({ ...EXERCISE_A, exerciseId: 'ex-brand-isolation-aaa' })
    const { result: resultA2 } = renderHook(
      () => useBrandConfig(), { wrapper: makeWrapper(queryClient) },
    )
    expect(resultA2.current.name).toBe(brandA.name)
    expect(resultA2.current.name).not.toBe(brandB.name)
  })
})

describe('useBrandTokens / useBrand (fail-closed consumer hooks)', () => {
  it('useBrandTokens() throws when called outside a <BrandThemeProvider> (no default brand to render against)', () => {
    // Suppress the expected React error-boundary console noise for this one
    // deliberately-throwing render.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => renderHook(() => useBrandTokens()))
        .toThrow(/must be called within a <BrandThemeProvider>/)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('useBrand() resolves the exact tokens provided by the nearest BrandTokensContext, same as useBrandTokens()', () => {
    const providedTokens: BrandTokens = {
      name: 'Context Fixture Network',
      colors: { primary: '#abcdef', accent: '#123456', surface: '#ffffff', onSurface: '#000000' },
    }

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <BrandTokensContext.Provider value={providedTokens}>
          {children}
        </BrandTokensContext.Provider>
      )
    }

    const { result: viaBrand } = renderHook(() => useBrand(), { wrapper: Wrapper })
    const { result: viaTokens } = renderHook(() => useBrandTokens(), { wrapper: Wrapper })

    expect(viaBrand.current).toEqual(providedTokens)
    expect(viaTokens.current).toEqual(providedTokens)
  })
})

describe('Screened default tokens meet WCAG AA contrast (NFR-001, D0 §4.1)', () => {
  /**
   * Standard WCAG 2.1 relative-luminance / contrast-ratio formulas
   * (independent of this feature's code), applied to whatever the seam
   * actually hands out as its default - so a future edit to the default
   * palette that regresses contrast fails this test rather than silently
   * shipping an inaccessible channel skin.
   */
  function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.replace('#', '')
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    }
  }

  function srgbChannelToLinear(channel8bit: number): number {
    const c = channel8bit / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  function relativeLuminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex)
    const rl = srgbChannelToLinear(r)
    const gl = srgbChannelToLinear(g)
    const bl = srgbChannelToLinear(b)
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
  }

  function contrastRatio(hexA: string, hexB: string): number {
    const lumA = relativeLuminance(hexA)
    const lumB = relativeLuminance(hexB)
    const lighter = Math.max(lumA, lumB)
    const darker = Math.min(lumA, lumB)
    return (lighter + 0.05) / (darker + 0.05)
  }

  it('computes an onSurface/surface contrast ratio at or above the WCAG AA 4.5:1 normal-text threshold', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    const ratio = contrastRatio(result.current.colors.onSurface, result.current.colors.surface)

    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
