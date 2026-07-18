/**
 * features/participant-shell/channelNavConfig.test.tsx
 * ---------------------------------------------------------------------------
 * Story 03 (channel nav) — boundary-mocked branch coverage for the
 * `useChannelNav` mock seam (COR-061/062, D2-005; WAVE0-REVIEW precedent 19).
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `fetchChannelNavConfig`'s own filter/validation/fallback logic and
 * `useChannelNav`'s request-shape contract directly (mirrors
 * `chromeConfig.test.tsx` / `shellState.test.tsx`). The sibling
 * `channelNavConfig.default.test.tsx` covers the SHIPPED path through the
 * real axios client + canned adapter.
 *
 * `@/core/exerciseContext` is mocked too — exercise-context resolution is a
 * different seam's own concern; only the exerciseId VALUE matters here, for
 * the query key (WAVE0-REVIEW precedent 13: exerciseId keys the cache, it is
 * never sent to the server as a client-supplied scoping parameter).
 *
 * Fixtures below are deliberately NOT the shipped `MOCK_CHANNEL_NAV_CONFIG`
 * (only 'social' enabled) — a mixed multi-enabled/multi-disabled catalog, so
 * a resolver that ever stopped filtering (or always returned the shipped
 * single-channel shape regardless of the response body) would still fail
 * these tests (WAVE0-REVIEW precedent 17: no tautological tests).
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChannelNav } from './channelNavConfig'
import { api } from '@/core/services/api'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-channel-nav-0001',
    exerciseName: 'Channel Nav Test Exercise',
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

/** A mixed catalog: some enabled, some disabled, deliberately not the shipped default. */
const MIXED_CATALOG_RESPONSE = {
  channels: [
    { id: 'social', label: 'Social', icon: 'social', enabled: true },
    { id: 'portal', label: 'Neighborhood Portal', icon: 'portal', enabled: false },
    { id: 'news', label: 'Local News', icon: 'news', enabled: true },
    { id: 'weather', label: 'Weather', icon: 'weather', enabled: false },
  ],
  currentChannelId: 'news',
  hideWhenSingleChannel: false,
}

describe('useChannelNav (boundary-mocked branch) — config-driven visibility (D2-005)', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves ONLY the enabled channels from a valid mixed-catalog response — a disabled channel is absent, not merely un-marked', async () => {
    mockGet.mockResolvedValue(
      { data: MIXED_CATALOG_RESPONSE } as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.channels).toHaveLength(2))

    const ids = result.current.channels.map(channel => channel.id)
    expect(ids).toEqual(['social', 'news'])
    expect(ids).not.toContain('portal')
    expect(ids).not.toContain('weather')
  })

  it('resolves initialChannelId to the wire currentChannelId when that channel is enabled', async () => {
    mockGet.mockResolvedValue(
      { data: MIXED_CATALOG_RESPONSE } as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.initialChannelId).toBe('news'))
  })

  it('falls back to the first enabled channel when the wire currentChannelId points at a disabled (or absent) channel', async () => {
    mockGet.mockResolvedValue({
      data: { ...MIXED_CATALOG_RESPONSE, currentChannelId: 'portal' },
    } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    // 'portal' is disabled in this catalog — the resolved config must never
    // point "current" at a channel that isn't in its own enabled-only list.
    await waitFor(() => expect(result.current.initialChannelId).toBe('social'))
    expect(result.current.channels.some(channel => channel.id === 'portal')).toBe(false)
  })

  it('passes hideWhenSingleChannel through from the wire body unchanged', async () => {
    mockGet.mockResolvedValue({
      data: { ...MIXED_CATALOG_RESPONSE, hideWhenSingleChannel: true },
    } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.hideWhenSingleChannel).toBe(true))
  })

  it('falls back to the safe-default config (single "social" channel, strip visible) while the query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.get>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    expect(result.current.channels).toEqual([{ id: 'social', label: 'Social', icon: 'social' }])
    expect(result.current.initialChannelId).toBe('social')
    expect(result.current.hideWhenSingleChannel).toBe(false)
  })

  it('falls back to the safe default once a response with an out-of-shape body settles (never renders the bogus shape)', async () => {
    mockGet.mockResolvedValue({
      data: { channels: [{ id: 'social', label: 'Social', icon: 'not-a-real-icon', enabled: true }] },
    } as unknown as Awaited<ReturnType<typeof api.get>>)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    // Confirm the query actually SETTLES to an error (the runtime guard
    // rejecting the malformed body), not merely that the default shows
    // because the query is still pending — a removed guard would instead
    // settle to a SUCCESS state carrying the bogus icon id.
    await waitFor(() => {
      const cachedState = queryClient.getQueryCache().findAll()[0]?.state
      expect(cachedState?.status).toBe('error')
    })
    expect(result.current.channels).toEqual([{ id: 'social', label: 'Social', icon: 'social' }])
  })

  it('never sends the exerciseId as a request URL substring or a params key (COR-001, XC-002, precedent 13)', async () => {
    mockGet.mockResolvedValue(
      { data: MIXED_CATALOG_RESPONSE } as Awaited<ReturnType<typeof api.get>>,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/channel-nav-config')
    expect(call?.[0]).not.toContain('ex-test-channel-nav-0001')

    const config = call?.[1] as Record<string, unknown> | undefined
    // No `params`/`query` object at all on this call — the exerciseId is read
    // only to key the React Query cache (see channelNavConfig.ts header),
    // never to scope the request itself.
    expect(config).not.toHaveProperty('params')
  })
})
