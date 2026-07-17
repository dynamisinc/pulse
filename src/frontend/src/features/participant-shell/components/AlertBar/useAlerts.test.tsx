/**
 * features/participant-shell/components/AlertBar/useAlerts.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (alert-bar host) — boundary-mocked branch coverage for the
 * `useAlerts` mock seam (PRT-010/011/012, WAVE0-REVIEW precedent 19).
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `fetchAlerts`'s own validation/fallback logic and `useAlerts`'s
 * request-shape contract directly (mirrors `shellState.test.tsx` /
 * `chromeConfig.test.tsx`). The sibling `useAlerts.default.test.tsx` covers
 * the SHIPPED path through the real axios client + canned adapter.
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
import { useAlerts } from './useAlerts'
import { api } from '@/core/services/api'
import type { Alert } from './alertTypes'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alerts-0001',
    exerciseName: 'Alerts Test Exercise',
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

const VALID_ALERT: Alert = {
  id: 'alert-1',
  severity: 'advisory',
  message: 'Boil-water notice in effect.',
  scenarioTime: '2026-07-16T14:00:00.000Z',
}

describe('useAlerts (boundary-mocked branch)', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves the alerts array from a valid mocked response', async () => {
    mockGet.mockResolvedValue(
      { data: { alerts: [VALID_ALERT] } } as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current).toEqual([VALID_ALERT]))
  })

  it('falls back to an EMPTY array - never a fabricated alert - while the query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    expect(result.current).toEqual([])
  })

  it('falls back to an EMPTY array once a response with an out-of-enum severity settles (fails closed, not partially filtered)', async () => {
    mockGet.mockResolvedValue({
      data: { alerts: [VALID_ALERT, { ...VALID_ALERT, id: 'alert-2', severity: 'critical' }] },
    } as unknown as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    // Confirm the query actually SETTLES to an error (the runtime guard
    // rejecting the malformed entry), not merely that [] shows because the
    // query is still pending - a removed guard would instead settle to a
    // SUCCESS state carrying the whole array, invalid entry included.
    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current).toEqual([])
  })

  it('falls back to an EMPTY array once a response with an unparseable scenarioTime settles', async () => {
    mockGet.mockResolvedValue({
      data: { alerts: [{ ...VALID_ALERT, scenarioTime: 'not-a-date' }] },
    } as unknown as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current).toEqual([])
  })

  it('falls back to an EMPTY array when the response body has no alerts array at all', async () => {
    mockGet.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current).toEqual([])
  })

  it('never sends the exerciseId as a request URL substring or a params key (COR-001, XC-002, precedent 13)', async () => {
    mockGet.mockResolvedValue({ data: { alerts: [] } } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useAlerts(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/alerts')
    expect(call?.[0]).not.toContain('ex-test-alerts-0001')

    const config = call?.[1] as Record<string, unknown> | undefined
    // No `params`/`query` object at all on this call - the exerciseId is read
    // only to key the React Query cache (see useAlerts.ts header), never to
    // scope the request itself.
    expect(config).not.toHaveProperty('params')
  })
})
