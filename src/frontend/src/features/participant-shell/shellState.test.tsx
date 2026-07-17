/**
 * features/participant-shell/shellState.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (channel-mount contract) — boundary-mocked branch coverage for the
 * `useShellState` mock seam (AC4; COR-001/XC-002, WAVE0-REVIEW precedent 19).
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `fetchShellState`'s own validation/fallback logic and
 * `useShellState`'s request-shape contract directly (mirrors
 * `exerciseContextResolver.test.ts`). The sibling `shellState.default.test.tsx`
 * covers the SHIPPED path through the real axios client + canned adapter.
 *
 * `@/core/exerciseContext` is mocked too - exercise-context resolution itself
 * is a different seam's concern (exercise-isolation/10's own suite); only the
 * exerciseId VALUE matters here, for the query key.
 *
 * The pending/error-fallback cases below pin CR-W1 (Wave-1 Gate-1, story 06):
 * the least-affordance default is `'readOnly'`, never `'full'` - a loading
 * frame or a fetch failure must never grant interaction the exercise didn't
 * intend. A later refactor that reintroduces the old `'full'` fallback should
 * fail these tests.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useShellState } from './shellState'
import { api } from '@/core/services/api'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-shell-state-0001',
    exerciseName: 'Shell State Test Exercise',
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

describe('useShellState (boundary-mocked branch)', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves the variant from a valid mocked response', async () => {
    mockGet.mockResolvedValue({ data: { variant: 'kiosk' } } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useShellState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.variant).toBe('kiosk'))
  })

  it('falls back to "readOnly" (CR-W1) - never an unresolved/undefined variant, never "full" - while the query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useShellState(), { wrapper: makeWrapper(queryClient) })

    expect(result.current.variant).toBe('readOnly')
  })

  it('falls back to "readOnly" (CR-W1) - never the bogus value, never "full" - once a response with an out-of-enum variant settles', async () => {
    mockGet.mockResolvedValue(
      { data: { variant: 'god-mode' } } as unknown as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useShellState(), { wrapper: makeWrapper(queryClient) })

    // Confirm the query actually SETTLES to an error (the runtime guard
    // rejecting the malformed body), not merely that "readOnly" shows because
    // the query is still loading - a removed guard would instead settle to
    // a SUCCESS state carrying the bogus 'god-mode' value.
    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.variant).toBe('readOnly')
  })

  it('never sends the exerciseId as a request/query param to the server (COR-001, XC-002)', async () => {
    mockGet.mockResolvedValue({ data: { variant: 'full' } } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useShellState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/shell-state')
    expect(call?.[0]).not.toContain('ex-test-shell-state-0001')

    const config = call?.[1] as Record<string, unknown> | undefined
    // No `params`/`query` object at all on this call - the exerciseId is read
    // only to key the React Query cache (see shellState.ts header), never to
    // scope the request itself.
    expect(config).not.toHaveProperty('params')
  })
})
