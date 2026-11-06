/**
 * features/participant-shell/components/AlertBar/useAlerts.live.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation story 11 (#707): the LIVE path of `useAlerts()` and
 * `useAlertsHistory()` — `USE_MOCK_DATA` off, `api` mocked at the module
 * boundary, and the shared `realtimeConnection` replaced by a fake the test
 * drives (`liveAlertsTestUtils.ts`).
 *
 * Pins: the real `GET /alerts` with no mock adapter; fail-closed on an
 * out-of-shape body (incl. a non-host-relative `href`); `AlertsChanged`
 * REPLACES the set (never merges); an identical push changes nothing; a
 * malformed push is dropped and the set refetched; a push beats a GET still
 * in flight; a hub resync refetches; severity-then-recency order; the history
 * read, its cursor, de-duplication, and refresh on push.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { HubConnectionState } from '@microsoft/signalr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { useAlerts } from './useAlerts'
import { useAlertsHistory } from './useAlertsHistory'
import { alertsHistoryQueryKey, alertsQueryKey } from './alertsSource'
import {
  makeQueryClient,
  makeWrapper,
  ok,
  wireAlert,
  type FakeConnection,
} from './liveAlertsTestUtils'

const fake = vi.hoisted(() => ({ connection: null as FakeConnection | null }))

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({ api: { get: vi.fn() } }))
vi.mock('@/core/auth/tokenStore', () => ({ getAccessToken: () => 'token' }))
vi.mock('@/core/realtime/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/realtime/connection')>()
  const { createFakeConnection: create } = await import('./liveAlertsTestUtils')
  fake.connection = create()
  return { ...actual, realtimeConnection: fake.connection }
})
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-live-alerts-0001',
    exerciseName: 'Live Alerts Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockGet = vi.mocked(api.get)
const KEY = alertsQueryKey('ex-live-alerts-0001')
const HISTORY_KEY = alertsHistoryQueryKey('ex-live-alerts-0001')

function connection(): FakeConnection {
  if (fake.connection === null) throw new Error('fake connection not created')
  return fake.connection
}

/** Lets the push's cancel → set chain and React Query's notify batching run. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  connection().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAlerts — live read (GET /alerts)', () => {
  it('reads the real route with no mock adapter and no exercise id, and returns the active set', async () => {
    const alert = wireAlert({ severity: 'advisory', href: '/weather/nws-metro/flood-watch' })
    mockGet.mockResolvedValue(ok({ alerts: [alert] }))
    const client = makeQueryClient()

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(client) })

    await waitFor(() => expect(result.current).toEqual([alert]))
    expect(mockGet).toHaveBeenCalledWith('/alerts', undefined)
  })

  it('returns the set severity-then-recency, whatever order the server used', async () => {
    const infoNew = wireAlert({ id: 'info-new', severity: 'info', scenarioTime: '2026-12-02T15:00:00Z' })
    const watch = wireAlert({ id: 'watch', severity: 'advisory', scenarioTime: '2026-12-02T14:30:00Z' })
    const warning = wireAlert({ id: 'warning', severity: 'emergency', scenarioTime: '2026-12-02T14:00:00Z' })
    mockGet.mockResolvedValue(ok({ alerts: [infoNew, watch, warning] }))

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(makeQueryClient()) })

    await waitFor(() => expect(result.current.map(a => a.id)).toEqual(['warning', 'watch', 'info-new']))
  })

  it.each([
    ['an out-of-enum severity', { severity: 'critical' }],
    ['an absolute href', { href: 'https://evil.example/phish' }],
    ['a protocol-relative href', { href: '//evil.example/phish' }],
    ['an empty message', { message: '' }],
  ])('fails closed to [] (the bar stays hidden) on %s', async (_label, bad) => {
    mockGet.mockResolvedValue(ok({ alerts: [wireAlert(), { ...wireAlert(), ...bad }] }))
    const client = makeQueryClient()

    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(client) })

    await waitFor(() => expect(client.getQueryState(KEY)?.status).toBe('error'))
    expect(result.current).toEqual([])
  })
})

describe('useAlerts — live push (AlertsChanged)', () => {
  it('subscribes on the shared connection, starts it, and unsubscribes on unmount', async () => {
    mockGet.mockResolvedValue(ok({ alerts: [] }))
    const { unmount } = renderHook(() => useAlerts(), { wrapper: makeWrapper(makeQueryClient()) })

    expect(connection().handlerCount('AlertsChanged')).toBe(1)
    expect(connection().startCalls()).toBe(1)
    unmount()
    expect(connection().handlerCount('AlertsChanged')).toBe(0)
  })

  it('REPLACES the active set with each frame (never merges), so a reconnecting client converges', async () => {
    const a = wireAlert({ id: 'a', severity: 'advisory' })
    const b = wireAlert({ id: 'b', severity: 'info' })
    mockGet.mockResolvedValue(ok({ alerts: [a, b] }))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(makeQueryClient()) })
    await waitFor(() => expect(result.current).toHaveLength(2))

    const c = wireAlert({ id: 'c', severity: 'emergency' })
    act(() => connection().emit('AlertsChanged', { alerts: [c] }))

    await waitFor(() => expect(result.current.map(alert => alert.id)).toEqual(['c']))

    act(() => connection().emit('AlertsChanged', { alerts: [] }))
    await waitFor(() => expect(result.current).toEqual([]))
  })

  it('keeps the SAME array for a frame that changes nothing (no re-render, nothing to announce)', async () => {
    const a = wireAlert({ id: 'a', severity: 'advisory' })
    mockGet.mockResolvedValue(ok({ alerts: [a] }))
    const client = makeQueryClient()
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(client) })
    await waitFor(() => expect(result.current).toHaveLength(1))
    const before = result.current
    const cached = client.getQueryData(KEY)

    act(() => connection().emit('AlertsChanged', { alerts: [{ ...a }] }))
    await flush()
    await flush()

    expect(client.getQueryData(KEY)).toBe(cached)

    expect(result.current).toBe(before)
  })

  it('drops a malformed frame and reads the set again instead', async () => {
    const a = wireAlert({ id: 'a' })
    mockGet.mockResolvedValue(ok({ alerts: [a] }))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(makeQueryClient()) })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(mockGet).toHaveBeenCalledTimes(1)

    act(() => connection().emit('AlertsChanged', { alerts: [{ id: 'x', severity: 'critical' }] }))
    await flush()

    expect(result.current.map(alert => alert.id)).toEqual(['a'])
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })

  it('queues a refetch behind a frame still being applied, so its read starts after the set lands', async () => {
    mockGet.mockResolvedValue(ok({ alerts: [] }))
    const client = makeQueryClient()
    renderHook(() => useAlerts(), { wrapper: makeWrapper(client) })
    await waitFor(() => expect(client.getQueryState(KEY)?.status).toBe('success'))

    const seenAtRead: unknown[] = []
    mockGet.mockImplementation(() => {
      seenAtRead.push(client.getQueryData(KEY))
      return Promise.resolve(ok({ alerts: [] })) as ReturnType<typeof api.get>
    })
    const pushed = wireAlert({ id: 'pushed' })
    // A valid frame, then (in the same tick) a malformed one that asks for a refetch.
    act(() => {
      connection().emit('AlertsChanged', { alerts: [pushed] })
      connection().emit('AlertsChanged', { alerts: 'not-an-array' })
    })

    await waitFor(() => expect(seenAtRead).toHaveLength(1))
    expect(seenAtRead[0]).toEqual([pushed])
  })

  it('lets a frame beat a GET still in flight: the older response never overwrites the push', async () => {
    let resolveGet: (value: unknown) => void = () => {}
    const pending = new Promise(resolve => { resolveGet = resolve })
    mockGet.mockReturnValueOnce(pending as ReturnType<typeof api.get>)
    const client = makeQueryClient()
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(client) })

    const pushed = wireAlert({ id: 'pushed', severity: 'emergency' })
    act(() => connection().emit('AlertsChanged', { alerts: [pushed] }))
    await waitFor(() => expect(result.current.map(alert => alert.id)).toEqual(['pushed']))
    resolveGet(ok({ alerts: [wireAlert({ id: 'stale' })] }))
    await flush()

    expect(result.current.map(alert => alert.id)).toEqual(['pushed'])
  })

  it('refetches when the hub comes back after a gap (missed pushes), but not on a plain Connected', async () => {
    connection().state = HubConnectionState.Connected
    mockGet.mockResolvedValue(ok({ alerts: [] }))
    renderHook(() => useAlerts(), { wrapper: makeWrapper(makeQueryClient()) })
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    act(() => connection().transition(HubConnectionState.Connected))
    await flush()
    expect(mockGet).toHaveBeenCalledTimes(1)

    act(() => connection().transition(HubConnectionState.Reconnecting))
    act(() => connection().transition(HubConnectionState.Connected))
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })

  it('restarts the shared connection after a deliberate stop while a session token is stored', async () => {
    mockGet.mockResolvedValue(ok({ alerts: [] }))
    renderHook(() => useAlerts(), { wrapper: makeWrapper(makeQueryClient()) })
    expect(connection().startCalls()).toBe(1)

    act(() => connection().transition(HubConnectionState.Disconnected, 'stopped'))

    expect(connection().startCalls()).toBe(2)
  })
})

describe('useAlertsHistory — GET /alerts/history', () => {
  it('reads the first page with no cursor, then the next page by its cursor, de-duplicating by id', async () => {
    const newest = wireAlert({ id: 'h3', scenarioTime: '2026-12-02T16:00:00Z' })
    const middle = wireAlert({ id: 'h2', scenarioTime: '2026-12-02T15:00:00Z' })
    const oldest = wireAlert({ id: 'h1', scenarioTime: '2026-12-02T14:00:00Z' })
    mockGet
      .mockResolvedValueOnce(ok({ alerts: [newest, middle], nextCursor: 'c-1' }))
      .mockResolvedValueOnce(ok({ alerts: [middle, oldest], nextCursor: null }))

    const { result } = renderHook(() => useAlertsHistory(), {
      wrapper: makeWrapper(makeQueryClient()),
    })

    await waitFor(() => expect(result.current.alerts.map(a => a.id)).toEqual(['h3', 'h2']))
    expect(mockGet).toHaveBeenNthCalledWith(1, '/alerts/history', {})
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.loadMore())

    await waitFor(() => expect(result.current.alerts.map(a => a.id)).toEqual(['h3', 'h2', 'h1']))
    expect(mockGet).toHaveBeenNthCalledWith(2, '/alerts/history', { params: { cursor: 'c-1' } })
    expect(result.current.hasMore).toBe(false)
  })

  it('fails closed (no alerts, an error) on an out-of-shape page', async () => {
    mockGet.mockResolvedValue(ok({ alerts: [{ id: 'x' }], nextCursor: null }))

    const { result } = renderHook(() => useAlertsHistory(), {
      wrapper: makeWrapper(makeQueryClient()),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.alerts).toEqual([])
  })

  it('is refreshed by every AlertsChanged push', async () => {
    mockGet.mockImplementation(url =>
      Promise.resolve(ok(url === '/alerts' ? { alerts: [] } : { alerts: [], nextCursor: null })) as ReturnType<
        typeof api.get
      >,
    )
    const client = makeQueryClient()
    renderHook(() => ({ active: useAlerts(), history: useAlertsHistory() }), {
      wrapper: makeWrapper(client),
    })
    await waitFor(() => expect(client.getQueryState(HISTORY_KEY)?.status).toBe('success'))
    const historyReads = () => mockGet.mock.calls.filter(call => call[0] === '/alerts/history').length
    expect(historyReads()).toBe(1)

    act(() => connection().emit('AlertsChanged', { alerts: [wireAlert({ severity: 'advisory' })] }))

    await waitFor(() => expect(historyReads()).toBe(2))
  })
})
