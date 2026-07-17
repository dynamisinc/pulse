/**
 * features/participant-shell/brandTokens.default.test.tsx
 * ---------------------------------------------------------------------------
 * Story 07 (brand-theming hooks) — coverage for the SHIPPED default path of
 * `useBrandConfig`: the real shared axios client plus the canned
 * `mockAdapter` (`DEFAULT_BRAND_TOKENS`). The sibling `brandTokens.test.tsx`
 * mocks `@/core/services/api` to exercise the fallback/validation branches;
 * this is the only test that runs what the app actually executes until a real
 * `/brand-tokens` endpoint lands (mirrors `chromeConfig.default.test.tsx`,
 * WAVE0-REVIEW precedent 19).
 *
 * Deliberately does NOT mock `@/core/services/api` - the request goes
 * through the real axios request pipeline and is short-circuited by the
 * adapter, so no network is touched.
 *
 * `@/core/exerciseContext` is still mocked - exercise-context resolution is a
 * different seam's concern; only the exerciseId VALUE matters here, for the
 * query key.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useBrandConfig } from './brandTokens'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-brand-tokens-default-0001',
    exerciseName: 'Brand Tokens Default Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useBrandConfig (default mock adapter, shipped path)', () => {
  it('resolves the screened, neutral default brand through the real axios request pipeline', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useBrandConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.name).toBe('Sample Exercise Network'))
    expect(result.current.colors).toEqual({
      primary: '#2b5f75',
      accent: '#d97706',
      surface: '#ffffff',
      onSurface: '#1c1c1c',
    })
    // Demo config, not product copy - neither of the mockup's in-fiction
    // brand names ever comes back off this seam.
    expect(result.current.name).not.toMatch(/Fairhaven|BAY SHIELD/i)
    expect(result.current.logo).toBeUndefined()
  })
})
