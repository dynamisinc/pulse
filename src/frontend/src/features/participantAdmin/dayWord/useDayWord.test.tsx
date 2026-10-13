/**
 * features/participantAdmin/dayWord/useDayWord.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 11, cross-cutting AC "Isolation (XC-001 / COR-001)": the panel
 * sends NO exercise id, and its React Query key INCLUDES the active exercise id
 * from `useExerciseContext()`, so switching exercise can never paint another
 * exercise's status.
 *
 * The id is for cache separation only. Query isolation itself is server-side:
 * the endpoints take no exercise parameter, so nothing here could send one.
 */
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { dayWordMockControls } from './dayWordMocks'
import {
  dayWordQueryKey,
  msUntilRolloverRefetch,
  ROLLOVER_RECHECK_MS,
  ROLLOVER_SLACK_MS,
  useClearDayWord,
  useDayWordStatus,
  useSetDayWord,
} from './useDayWord'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockContext = vi.mocked(useExerciseContext)

function useAs(exerciseId: string) {
  mockContext.mockReturnValue({
    exerciseId,
    exerciseName: `Exercise ${exerciseId}`,
    timeZone: 'America/New_York',
    status: 'live',
  })
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

beforeEach(() => {
  dayWordMockControls.reset()
  dayWordMockControls.setNow(new Date('2026-10-13T16:00:00.000Z'))
  vi.restoreAllMocks()
})

describe('dayWordQueryKey', () => {
  it('includes the exercise id and differs per exercise', () => {
    expect(dayWordQueryKey('ex-A')).toEqual(['staff', 'day-word', 'ex-A'])
    expect(dayWordQueryKey('ex-A')).not.toEqual(dayWordQueryKey('ex-B'))
  })
})

describe('useDayWordStatus', () => {
  it('caches the status under a key that carries the active exercise id', async () => {
    useAs('ex-A')
    const { queryClient, wrapper } = setup()

    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(queryClient.getQueryCache().find({ queryKey: dayWordQueryKey('ex-A') })).toBeDefined()
    expect(queryClient.getQueryCache().find({ queryKey: dayWordQueryKey('ex-B') })).toBeUndefined()
  })

  it('sends no exercise id: not in the URL, the query string or the body', async () => {
    useAs('ex-A-secret-id')
    const get = vi.spyOn(api, 'get')
    const { wrapper } = setup()

    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(get).toHaveBeenCalledTimes(1)
    const [url, config] = get.mock.calls[0] ?? []
    expect(url).toBe('/staff/day-word')
    expect(JSON.stringify(config)).not.toContain('ex-A-secret-id')
    expect(config).not.toHaveProperty('params')
  })

  it('does not serve one exercise\'s status under another exercise\'s key', async () => {
    useAs('ex-A')
    dayWordMockControls.seedWord('2026-10-13', { setByName: 'Set In A' })
    const { queryClient, wrapper } = setup()
    const { result, rerender } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.data?.setByName).toBe('Set In A'))

    // Switch exercise. The server's answer for B is different (nothing set).
    dayWordMockControls.reset()
    dayWordMockControls.setNow(new Date('2026-10-13T16:00:00.000Z'))
    useAs('ex-B')
    rerender()

    // A's status must not be shown for B while B loads...
    expect(result.current.data).toBeUndefined()
    expect(result.current.isPending).toBe(true)
    // ...and B's own answer replaces it.
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.todaySet).toBe(false)
    expect(queryClient.getQueryCache().find({ queryKey: dayWordQueryKey('ex-A') })).toBeDefined()
    expect(queryClient.getQueryCache().find({ queryKey: dayWordQueryKey('ex-B') })).toBeDefined()
  })

  it('does not retry a malformed 2xx either: asking again gets the same answer', async () => {
    useAs('ex-A')
    dayWordMockControls.malformNext()
    const get = vi.spyOn(api, 'get')
    const { wrapper } = setup()

    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(get).toHaveBeenCalledTimes(1)
    expect(result.current.error?.kind).toBe('malformed')
  })

  it('does retry a 5xx (twice), because it may clear', async () => {
    useAs('ex-A')
    dayWordMockControls.failNext(503, 'Down.', { method: 'get', times: 2 })
    const get = vi.spyOn(api, 'get')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(get).toHaveBeenCalledTimes(3)
  })

  it('does not retry a definite 4xx answer', async () => {
    useAs('ex-A')
    dayWordMockControls.forbid()
    const get = vi.spyOn(api, 'get')
    const { wrapper } = setup()

    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(get).toHaveBeenCalledTimes(1)
    expect(result.current.error?.status).toBe(403)
  })
})

describe('freshness of the status', () => {
  it('is never served stale and is re-read when the window regains focus', async () => {
    useAs('ex-A')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = queryClient
      .getQueryCache()
      .find({ queryKey: dayWordQueryKey('ex-A') })?.observers[0]?.options

    expect(options?.staleTime).toBe(0)
    expect(options?.refetchOnWindowFocus).toBe(true)
  })

  describe('msUntilRolloverRefetch', () => {
    const NOW = Date.parse('2026-10-14T03:00:00.000Z')

    it('waits until the rollover instant plus a second of slack', () => {
      expect(msUntilRolloverRefetch('2026-10-14T04:00:00.000Z', NOW)).toBe(
        60 * 60 * 1000 + ROLLOVER_SLACK_MS,
      )
    })

    it('re-checks on a fixed cadence when the instant is already past (never spins)', () => {
      expect(msUntilRolloverRefetch('2026-10-14T02:00:00.000Z', NOW)).toBe(ROLLOVER_RECHECK_MS)
      expect(msUntilRolloverRefetch('2026-10-14T03:00:00.000Z', NOW)).toBe(ROLLOVER_RECHECK_MS)
    })

    it('re-checks on a fixed cadence for an unparseable instant', () => {
      expect(msUntilRolloverRefetch('later', NOW)).toBe(ROLLOVER_RECHECK_MS)
    })

    it('never exceeds the browser timer cap', () => {
      expect(msUntilRolloverRefetch('2099-01-01T00:00:00.000Z', NOW)).toBe(2_147_483_647)
    })
  })

  it('schedules a re-read at todayEndsAt, and that timer re-reads the status', async () => {
    useAs('ex-A')
    // The mock exercise's day ends 2026-10-14T04:00:00Z; pretend it is one hour before.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T03:00:00.000Z'))
    const timers = vi.spyOn(window, 'setTimeout')
    const get = vi.spyOn(api, 'get')
    const { wrapper } = setup()

    const { result } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const expectedDelay = 60 * 60 * 1000 + ROLLOVER_SLACK_MS
    const scheduled = timers.mock.calls.find(([, delay]) => delay === expectedDelay)
    expect(scheduled).toBeDefined()
    expect(get).toHaveBeenCalledTimes(1)

    // Fire it: the status is read again.
    act(() => {
      const [callback] = scheduled ?? []
      if (typeof callback === 'function') callback()
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('cancels the rollover timer on unmount', async () => {
    useAs('ex-A')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T03:00:00.000Z'))
    const clear = vi.spyOn(window, 'clearTimeout')
    const { wrapper } = setup()
    const { result, unmount } = renderHook(() => useDayWordStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    unmount()

    expect(clear).toHaveBeenCalled()
  })
})

describe('useSetDayWord / useClearDayWord', () => {
  it('invalidates the status under the active exercise\'s key after a set', async () => {
    useAs('ex-A')
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useSetDayWord(), { wrapper })

    await result.current.setWord({})

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: dayWordQueryKey('ex-A') }))
  })

  it('invalidates the status under the active exercise\'s key after a clear', async () => {
    useAs('ex-A')
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useClearDayWord(), { wrapper })

    await result.current.mutateAsync(undefined)

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: dayWordQueryKey('ex-A') }))
  })

  it('also invalidates the status when the set FAILS (a 4xx / 5xx can follow a commit)', async () => {
    useAs('ex-A')
    dayWordMockControls.failNext(500, 'Gateway timed out.', { method: 'put' })
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useSetDayWord(), { wrapper })

    await expect(result.current.setWord({})).rejects.toMatchObject({ status: 500 })

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: dayWordQueryKey('ex-A') }))
  })

  it('also invalidates the status when the set answers a malformed 2xx', async () => {
    useAs('ex-A')
    dayWordMockControls.malformNext()
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useSetDayWord(), { wrapper })

    await expect(result.current.setWord({})).rejects.toMatchObject({ kind: 'malformed' })

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: dayWordQueryKey('ex-A') }))
  })

  it('also invalidates the status when the clear FAILS', async () => {
    useAs('ex-A')
    dayWordMockControls.failNext(502, 'Bad gateway.', { method: 'delete' })
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useClearDayWord(), { wrapper })

    await expect(result.current.mutateAsync(undefined)).rejects.toMatchObject({ status: 502 })

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: dayWordQueryKey('ex-A') }))
  })

  it('setWord resolves with the word and leaves no mutation (and no word) in the cache', async () => {
    useAs('ex-A')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useSetDayWord(), { wrapper })

    const saved = await result.current.setWord({ word: 'Granite Harbor 4417' })

    expect(saved.word).toBe('Granite Harbor 4417')
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map(q => q.state))).not.toContain(
      'Granite Harbor 4417',
    )
  })

  it('setWord rejects with the DayWordError and also leaves nothing behind', async () => {
    useAs('ex-A')
    dayWordMockControls.failNext(400, 'Nope.')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useSetDayWord(), { wrapper })

    await expect(result.current.setWord({ word: 'Granite Harbor 4417' })).rejects.toMatchObject({
      status: 400,
      serverMessage: 'Nope.',
    })

    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
  })
})
