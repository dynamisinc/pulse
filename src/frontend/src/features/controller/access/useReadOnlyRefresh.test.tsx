/**
 * features/controller/access/useReadOnlyRefresh.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 11, Gate-1 M-3: a read-only console re-reads the pause tier and the engine
 * settings every 15 s while it is mounted, and stops on unmount; a controller's console never
 * polls. Fake timers; the two reads and the gate are mocked so each tick is counted exactly.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshPauseTierFromServer } from '../hooks/usePauseState'
import { useCanControl } from './useCanControl'
import { READ_ONLY_REFRESH_MS, useReadOnlyRefresh } from './useReadOnlyRefresh'

const { refetchEngineSettings } = vi.hoisted(() => ({ refetchEngineSettings: vi.fn() }))

vi.mock('./useCanControl', () => ({ useCanControl: vi.fn(() => false) }))
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-1', timeZone: 'America/New_York' }),
}))
vi.mock('../engine/hooks/useEngineSettings', () => ({
  useEngineSettings: () => ({ refetch: refetchEngineSettings }),
}))
vi.mock('../hooks/usePauseState', () => ({
  refreshPauseTierFromServer: vi.fn(() => Promise.resolve()),
}))

const mockedCanControl = vi.mocked(useCanControl)
const mockedRefreshPause = vi.mocked(refreshPauseTierFromServer)

beforeEach(() => {
  vi.useFakeTimers()
  mockedCanControl.mockReturnValue(false)
  refetchEngineSettings.mockClear()
  mockedRefreshPause.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useReadOnlyRefresh (story 11 M-3)', () => {
  it('polls every 15 s', () => {
    expect(READ_ONLY_REFRESH_MS).toBe(15_000)
  })

  it('re-reads the pause tier and the engine settings for an evaluator on each tick', () => {
    renderHook(() => useReadOnlyRefresh())
    expect(refetchEngineSettings).not.toHaveBeenCalled()
    expect(mockedRefreshPause).not.toHaveBeenCalled()

    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS - 1)
    expect(refetchEngineSettings).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refetchEngineSettings).toHaveBeenCalledTimes(1)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(1)
    expect(mockedRefreshPause).toHaveBeenCalledWith('ex-1')

    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS)
    expect(refetchEngineSettings).toHaveBeenCalledTimes(2)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(2)
  })

  it('stops when the console unmounts', () => {
    const { unmount } = renderHook(() => useReadOnlyRefresh())
    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS)
    expect(refetchEngineSettings).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS * 4)
    expect(refetchEngineSettings).toHaveBeenCalledTimes(1)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(1)
  })

  it('never polls for a controller', () => {
    mockedCanControl.mockReturnValue(true)
    renderHook(() => useReadOnlyRefresh())
    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS * 4)
    expect(refetchEngineSettings).not.toHaveBeenCalled()
    expect(mockedRefreshPause).not.toHaveBeenCalled()
  })
})
