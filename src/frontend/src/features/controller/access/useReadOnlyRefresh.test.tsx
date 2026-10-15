/**
 * features/controller/access/useReadOnlyRefresh.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 11, Gate-1 M-3 / L-D: a read-only console re-reads the pause tier and the
 * engine settings every 15 s while it is mounted and the tab is visible, reads at once when the
 * tab comes back, and stops on unmount. (Whether it is mounted at all - never for a controller,
 * L-A - is asserted on the real console in `readOnlyConsole.test.tsx`.) Fake timers; the two
 * reads are mocked so each tick is counted exactly.
 */
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshPauseTierFromServer } from '../hooks/usePauseState'
import { ReadOnlyRefresh } from './ReadOnlyRefresh'
import { READ_ONLY_REFRESH_MS, useReadOnlyRefresh } from './useReadOnlyRefresh'

const { refetchEngineSettings } = vi.hoisted(() => ({ refetchEngineSettings: vi.fn() }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-1', timeZone: 'America/New_York' }),
}))
vi.mock('../engine/hooks/useEngineSettings', () => ({
  useEngineSettings: () => ({ refetch: refetchEngineSettings }),
}))
vi.mock('../hooks/usePauseState', () => ({
  refreshPauseTierFromServer: vi.fn(() => Promise.resolve()),
}))

const mockedRefreshPause = vi.mocked(refreshPauseTierFromServer)

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  refetchEngineSettings.mockClear()
  mockedRefreshPause.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useReadOnlyRefresh (story 11 M-3)', () => {
  it('polls every 15 s', () => {
    expect(READ_ONLY_REFRESH_MS).toBe(15_000)
  })

  it('re-reads the pause tier and the engine settings on each tick', () => {
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
    setVisibility('visible')
    expect(refetchEngineSettings).toHaveBeenCalledTimes(1)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(1)
  })

  it('<ReadOnlyRefresh /> runs the same polling and renders nothing', () => {
    const { container } = render(<ReadOnlyRefresh />)
    expect(container).toBeEmptyDOMElement()
    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS)
    expect(refetchEngineSettings).toHaveBeenCalledTimes(1)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(1)
  })
})

describe('useReadOnlyRefresh and tab visibility (story 11 L-D)', () => {
  it('skips the ticks while the tab is hidden', () => {
    renderHook(() => useReadOnlyRefresh())
    setVisibility('hidden')
    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS * 3)
    expect(refetchEngineSettings).not.toHaveBeenCalled()
    expect(mockedRefreshPause).not.toHaveBeenCalled()
  })

  it('reads at once when the tab becomes visible again, then keeps ticking', () => {
    renderHook(() => useReadOnlyRefresh())
    setVisibility('hidden')
    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS * 2)

    setVisibility('visible')
    expect(refetchEngineSettings).toHaveBeenCalledTimes(1)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(READ_ONLY_REFRESH_MS)
    expect(refetchEngineSettings).toHaveBeenCalledTimes(2)
    expect(mockedRefreshPause).toHaveBeenCalledTimes(2)
  })
})
