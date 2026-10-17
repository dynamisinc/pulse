/**
 * core/clock/useRelativeScenarioTime.test.tsx
 * ---------------------------------------------------------------------------
 * Pins the burst-legibility contract of the shared relative-time ticker (mobile-
 * tablet story 07, NFR-002/SOC-071): a row's "2m ago" text still advances on the
 * 30 s tick (and on a clock jump), but the row re-renders ONLY when that text
 * changes, and every row shares one interval instead of owning one each.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRelativeScenarioTime } from './scenarioTime'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from './exerciseClock'

const POST = '2033-09-04T15:00:00Z'
let nowMs = Date.parse('2033-09-04T15:02:10Z')

beforeEach(() => {
  vi.useFakeTimers()
  nowMs = Date.parse('2033-09-04T15:02:10Z')
  setExerciseClock({ scenarioNow: () => new Date(nowMs) })
})

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('useRelativeScenarioTime', () => {
  it('renders the relative string and advances it on the shared tick', () => {
    const { result } = renderHook(() => useRelativeScenarioTime(POST, 'UTC'))
    expect(result.current).toBe('2m ago')
    nowMs += 60_000
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe('3m ago')
  })

  it('does not re-render when a tick leaves the text unchanged', () => {
    let renders = 0
    renderHook(() => {
      renders += 1
      return useRelativeScenarioTime(POST, 'UTC')
    })
    const settled = renders
    nowMs += 10_000 // 2m20s: still "2m ago"
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(renders).toBe(settled)
  })

  it('shares one interval across many rows', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    const hooks = Array.from({ length: 50 }, () =>
      renderHook(() => useRelativeScenarioTime(POST, 'UTC')))
    expect(spy).toHaveBeenCalledTimes(1)
    hooks.forEach(h => h.unmount())
    spy.mockRestore()
  })

  it('follows a clock jump pushed through the clock subscribe path, with no timer advance', () => {
    let listener: (() => void) | undefined
    const clock: IExerciseClock = {
      scenarioNow: () => new Date(nowMs),
      subscribe: l => {
        listener = l
        return () => { listener = undefined }
      },
    }
    setExerciseClock(clock)
    const { result, unmount } = renderHook(() => useRelativeScenarioTime(POST, 'UTC'))
    expect(result.current).toBe('2m ago')
    nowMs += 58 * 60_000 // jump to 15:00:10 + ... = 1h
    act(() => { listener?.() })
    expect(result.current).toBe('1h ago')
    unmount()
    expect(listener).toBeUndefined()
  })

  it('re-subscribes when the active exercise clock is swapped', () => {
    const { result } = renderHook(() => useRelativeScenarioTime(POST, 'UTC'))
    expect(result.current).toBe('2m ago')
    let listener: (() => void) | undefined
    act(() => {
      setExerciseClock({
        scenarioNow: () => new Date(nowMs + 3_600_000),
        subscribe: l => {
          listener = l
          return () => { listener = undefined }
        },
      })
    })
    expect(result.current).toBe('1h ago')
    expect(listener).toBeDefined()
  })

  it('catches up when the tab becomes visible again', () => {
    const { result } = renderHook(() => useRelativeScenarioTime(POST, 'UTC'))
    nowMs += 3_600_000
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current).toBe('1h ago')
  })

  it('clears the shared interval exactly once, after the last unmount', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const a = renderHook(() => useRelativeScenarioTime(POST, 'UTC'))
    const b = renderHook(() => useRelativeScenarioTime(POST, 'UTC'))
    a.unmount()
    expect(clear).not.toHaveBeenCalled()
    b.unmount()
    expect(clear).toHaveBeenCalledTimes(1)
    clear.mockRestore()
  })

  it('re-renders with the new text when the time zone changes the rendering', () => {
    // Beyond ~7 days the relative text falls back to an absolute, zone-dependent string.
    nowMs = Date.parse('2033-10-04T15:00:00Z')
    const { result, rerender } = renderHook(
      ({ tz }) => useRelativeScenarioTime(POST, tz),
      { initialProps: { tz: 'UTC' } },
    )
    const utc = result.current
    rerender({ tz: 'Pacific/Auckland' })
    expect(result.current).not.toBe(utc)
  })
})
