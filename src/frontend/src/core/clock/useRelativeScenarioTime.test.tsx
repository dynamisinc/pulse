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
import { resetExerciseClock, setExerciseClock } from './exerciseClock'

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
})
