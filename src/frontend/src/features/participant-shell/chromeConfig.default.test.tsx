/**
 * features/participant-shell/chromeConfig.default.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (compliance chrome) — coverage for the SHIPPED default path of
 * `useChromeConfig`: the real shared axios client plus the canned
 * `mockAdapter` (`DEFAULT_CHROME_CONFIG`). The sibling `chromeConfig.test.tsx`
 * mocks `@/core/services/api` to exercise the fallback/validation branches;
 * this is the only test that runs what the app actually executes until a
 * real `/chrome-config` endpoint lands (mirrors `shellState.default.test.tsx`,
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
import { useChromeConfig } from './chromeConfig'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-chrome-config-default-0001',
    exerciseName: 'Chrome Config Default Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useChromeConfig (default mock adapter, shipped path)', () => {
  it('resolves the canned AC-canonical config through the real axios request pipeline', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.top.text).toContain('UNCLASSIFIED'))
    expect(result.current.enabled).toBe(true)
    expect(result.current.bottom.text).toContain('PULSE TRAINING ENVIRONMENT')
  })
})
