/**
 * core/clock/useScenarioTime.test.tsx
 * ---------------------------------------------------------------------------
 * Component-facing wrapper (docs/features/exercise-clock/04-scenario-time-
 * participant-visible.md, AC 3): a `useScenarioTime()` hook wraps the
 * utility for consumption, binding `timeZone` so callers don't thread it
 * through every call, and re-reading `scenarioNow()` from the exercise-clock
 * source (never the real clock) on an interval.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_SCENARIO_TIME_ZONE, useScenarioTime } from './scenarioTime'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from './exerciseClock'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('useScenarioTime', () => {
  it('returns a format callback pre-bound to the given time zone', () => {
    const { result } = renderHook(() => useScenarioTime('Asia/Tokyo'))
    const instant = new Date('2026-07-16T23:00:00Z')

    expect(result.current.format(instant, { format: 'dateline' })).toBe('JUL 17, 2026')
  })

  it('defaults to the mock scenario time zone when none is passed', () => {
    const { result: bound } = renderHook(() => useScenarioTime())
    const { result: explicit } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE))
    const instant = new Date('2026-07-16T04:30:00Z')

    expect(bound.current.format(instant)).toBe(explicit.current.format(instant))
  })

  it('re-reads scenarioNow() from the exercise-clock source on each refresh tick, never the wall clock', () => {
    vi.setSystemTime(new Date('1999-01-01T00:00:00Z'))

    const first = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(first))

    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 1000))
    expect(result.current.now).toEqual(first)

    // Swap the exercise-clock instant to something wildly different from
    // both the previous scenario reading AND the (also wildly different)
    // real system clock, then advance only the refresh interval.
    const second = new Date('2031-01-01T00:00:00Z')
    setExerciseClock(fixedClock(second))

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.now).toEqual(second)
    expect(result.current.now.getTime()).not.toBe(Date.now())
  })

  it('does not re-read scenarioNow() before the refresh interval elapses', () => {
    const first = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(first))

    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 1000))

    setExerciseClock(fixedClock(new Date('2031-01-01T00:00:00Z')))

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(result.current.now).toEqual(first)
  })
})
