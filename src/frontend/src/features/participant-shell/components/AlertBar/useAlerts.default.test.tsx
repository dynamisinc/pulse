/**
 * features/participant-shell/components/AlertBar/useAlerts.default.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (alert-bar host) — coverage for the SHIPPED default path of
 * `useAlerts`: the real shared axios client plus the canned `mockAdapter`
 * (`MOCK_ALERTS`, an empty list). The sibling `useAlerts.test.tsx` mocks
 * `@/core/services/api` to exercise the fallback/validation branches; this is
 * the only test that runs what the app actually executes until a real
 * `/alerts` endpoint lands (mirrors `shellState.default.test.tsx` /
 * `chromeConfig.default.test.tsx`, WAVE0-REVIEW precedent 19).
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
import { useAlerts } from './useAlerts'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alerts-default-0001',
    exerciseName: 'Alerts Default Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useAlerts (default mock adapter, shipped path)', () => {
  it('resolves the canned empty alerts array through the real axios request pipeline - the correct out-of-the-box "none" state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('success')
    })
    expect(result.current).toEqual([])
  })
})
