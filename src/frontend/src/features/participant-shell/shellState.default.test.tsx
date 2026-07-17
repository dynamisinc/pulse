/**
 * features/participant-shell/shellState.default.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (channel-mount contract) — coverage for the SHIPPED default path
 * of `useShellState`: the real shared axios client plus the canned
 * `mockAdapter` (`MOCK_SHELL_STATE`). The sibling `shellState.test.tsx` mocks
 * `@/core/services/api` to exercise the fallback/validation branches; this is
 * the only test that runs what the app actually executes until a real
 * `/shell-state` endpoint lands (mirrors
 * `exerciseContextResolver.default.test.ts`, WAVE0-REVIEW precedent 19).
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
import { useShellState } from './shellState'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-shell-state-default-0001',
    exerciseName: 'Shell State Default Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useShellState (default mock adapter, shipped path)', () => {
  it('resolves the canned "full" variant through the real axios request pipeline', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useShellState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.variant).toBe('full'))
  })
})
