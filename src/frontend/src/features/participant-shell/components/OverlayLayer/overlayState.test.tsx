/**
 * features/participant-shell/components/OverlayLayer/overlayState.test.tsx
 * ---------------------------------------------------------------------------
 * Story 05 (overlay layer) — boundary-mocked branch coverage for the
 * `useOverlayState` mock seam (COR-065, XC-001; WAVE0-REVIEW precedent 19).
 * The sibling `overlayState.default.test.tsx` covers the SHIPPED path
 * through the real axios client + canned adapter.
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `fetchOverlayState`'s own validation/fallback logic and
 * `useOverlayState`'s request-shape contract directly (mirrors
 * `chromeConfig.test.tsx`).
 *
 * `@/core/exerciseContext` is mocked too - exercise-context resolution is a
 * different seam's own concern; only the exerciseId VALUE matters here, for
 * the query key (precedent 13: exerciseId keys the cache, it is never sent
 * to the server as a client-supplied scoping parameter).
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlayState } from './overlayState'
import { api } from '@/core/services/api'
import type { OverlayState } from './types'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-overlay-state-0001',
    exerciseName: 'Overlay State Test Exercise',
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

describe('useOverlayState (boundary-mocked branch)', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves a non-default overlay state from a valid mocked response (not the DEFAULT_OVERLAY_STATE fallback)', async () => {
    const mockedState: OverlayState = {
      state: 'broadcast',
      register: 'out-of-fiction',
      message: 'Severe weather advisory cancelled; this is a real emergency.',
    }
    mockGet.mockResolvedValue({ data: mockedState } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useOverlayState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.state).toBe('broadcast'))
    expect(result.current).toEqual(mockedState)
  })

  it('falls back to the safe default ("none") while the query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useOverlayState(), { wrapper: makeWrapper(queryClient) })

    expect(result.current.state).toBe('none')
  })

  it('falls back to the safe default ("none") once a response with an out-of-enum state settles (never renders the bogus value)', async () => {
    mockGet.mockResolvedValue(
      { data: { state: 'god-mode', register: 'in-fiction', message: '' } } as unknown as Awaited<
        ReturnType<typeof api.get>
      >,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useOverlayState(), { wrapper: makeWrapper(queryClient) })

    // Confirm the query actually SETTLES to an error (the runtime guard
    // rejecting the malformed body), not merely that the default shows
    // because the query is still pending - a removed guard would instead
    // settle to a SUCCESS state carrying the bogus 'god-mode' value.
    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.state).toBe('none')
  })

  it('falls back to the safe default ("none") when the register is out-of-enum, even though state is valid', async () => {
    mockGet.mockResolvedValue(
      { data: { state: 'pause', register: 'sideways', message: '' } } as unknown as Awaited<
        ReturnType<typeof api.get>
      >,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useOverlayState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.state).toBe('none')
  })

  it('never sends the exerciseId as a request URL substring or a params key (COR-001, XC-002, precedent 13)', async () => {
    mockGet.mockResolvedValue({
      data: { state: 'none', register: 'in-fiction', message: '' },
    } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useOverlayState(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/overlay-state')
    expect(call?.[0]).not.toContain('ex-test-overlay-state-0001')

    const config = call?.[1] as Record<string, unknown> | undefined
    // No `params`/`query` object at all on this call - the exerciseId is read
    // only to key the React Query cache (see overlayState.ts header), never
    // to scope the request itself.
    expect(config).not.toHaveProperty('params')
  })
})
