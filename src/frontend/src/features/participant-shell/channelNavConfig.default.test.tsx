/**
 * features/participant-shell/channelNavConfig.default.test.tsx
 * ---------------------------------------------------------------------------
 * Story 03 (channel nav) — coverage for the SHIPPED default path of
 * `useChannelNav`: the real shared axios client plus the canned `mockAdapter`
 * (`MOCK_CHANNEL_NAV_CONFIG`). The sibling `channelNavConfig.test.tsx` mocks
 * `@/core/services/api` to exercise the filter/validation/fallback branches;
 * this is the only test that runs what the app actually executes until a
 * real `/channel-nav-config` endpoint lands (mirrors
 * `chromeConfig.default.test.tsx` / `shellState.default.test.tsx`,
 * WAVE0-REVIEW precedent 19).
 *
 * Deliberately does NOT mock `@/core/services/api` — the request goes
 * through the real axios request pipeline and is short-circuited by the
 * adapter, so no network is touched.
 *
 * `@/core/exerciseContext` is still mocked — exercise-context resolution is a
 * different seam's concern; only the exerciseId VALUE matters here, for the
 * query key.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useChannelNav } from './channelNavConfig'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-channel-nav-default-0001',
    exerciseName: 'Channel Nav Default Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useChannelNav (default mock adapter, shipped path)', () => {
  it('resolves the Phase-1 pilot catalog through the real axios request pipeline: only "social" enabled', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.channels).toHaveLength(1))

    expect(result.current.channels).toEqual([{ id: 'social', label: 'Social', icon: 'social' }])
    expect(result.current.initialChannelId).toBe('social')
    expect(result.current.hideWhenSingleChannel).toBe(false)
  })

  it('never resolves the disabled catalog entries (portal/news/press/weather) on the real path — D2-005', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useChannelNav(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(result.current.channels.length).toBeGreaterThan(0))

    const ids = result.current.channels.map(channel => channel.id)
    for (const disabled of ['portal', 'news', 'press', 'weather']) {
      expect(ids).not.toContain(disabled)
    }
  })
})
