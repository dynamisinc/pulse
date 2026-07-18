/**
 * features/participant-shell/components/OverlayLayer/overlayState.default.test.tsx
 * ---------------------------------------------------------------------------
 * Story 05 (overlay layer) — coverage for the SHIPPED default path of
 * `useOverlayState`: the real shared axios client plus the canned
 * `mockAdapter` (`MOCK_OVERLAY_STATE`). The sibling `overlayState.test.tsx`
 * mocks `@/core/services/api` to exercise the fallback/validation branches;
 * this is the only test that runs what the app actually executes until a
 * real `/overlay-state` endpoint lands (mirrors
 * `chromeConfig.default.test.tsx`, WAVE0-REVIEW precedent 19).
 *
 * Deliberately does NOT mock `@/core/services/api` - the request goes
 * through the real axios request pipeline and is short-circuited by the
 * adapter, so no network is touched.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useOverlayState } from './overlayState'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-overlay-state-default-0001',
    exerciseName: 'Overlay State Default Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useOverlayState (default mock adapter, shipped path)', () => {
  it('resolves the canned safe "none" state through the real axios request pipeline', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useOverlayState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('success')
    })
    expect(result.current.state).toBe('none')
    expect(result.current.register).toBe('in-fiction')
    expect(result.current.message).toBe('')
  })
})
