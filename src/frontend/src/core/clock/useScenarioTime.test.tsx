/**
 * core/clock/useScenarioTime.test.tsx
 * ---------------------------------------------------------------------------
 * Component-facing wrapper (docs/features/exercise-clock/04-scenario-time-
 * participant-visible.md, AC 3): a `useScenarioTime()` hook wraps the
 * utility for consumption, binding `timeZone` so callers don't thread it
 * through every call, and re-reading `scenarioNow()` from the exercise-clock
 * source (never the real clock) on an interval - or immediately, when the
 * active clock supports change-notification (`subscribe`).
 *
 * Also covers, per the Wave-0 remediation:
 *  - The hook only re-renders (produces a new `now` reference) when the
 *    scenario instant actually changes - a paused/fixed clock must not
 *    thrash a 120-posts/min feed (NFR-002).
 *  - `clearInterval` (and any `subscribe` unsubscribe) runs on unmount - no
 *    leaked interval/listener.
 *  - `format()` anchors relative rendering to the hook's single `now`
 *    snapshot for the whole render (two calls agree); `opts.now` overrides.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SCENARIO_TIME_ZONE,
  MOCK_SCENARIO_TIME_ZONE,
  useScenarioTime,
} from './scenarioTime'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from './exerciseClock'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** A fake clock that notifies subscribers immediately when pushed a new instant. */
function subscribableClock(initial: Date): IExerciseClock & { push: (next: Date) => void } {
  let current = initial
  let listener: (() => void) | undefined

  return {
    scenarioNow: () => current,
    subscribe: listenerFn => {
      listener = listenerFn
      return () => {
        listener = undefined
      }
    },
    push(next: Date) {
      current = next
      listener?.()
    },
  }
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

  it('defaults to UTC (DEFAULT_SCENARIO_TIME_ZONE) when no time zone is passed', () => {
    const { result: bound } = renderHook(() => useScenarioTime())
    const { result: explicit } = renderHook(() => useScenarioTime(DEFAULT_SCENARIO_TIME_ZONE))
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

  // -------------------------------------------------------------------------
  // Poll only re-renders on change (NFR-002: a paused/fixed clock must not
  // thrash a 120-posts/min feed).
  // -------------------------------------------------------------------------

  it('does NOT produce a new `now` reference across a poll when the clock instant is unchanged', () => {
    const fixed = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(fixed))

    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 1000))
    const firstNow = result.current.now

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Same instant every tick -> the hook's updater keeps the previous Date
    // reference rather than producing a new one, so consumers memoized on
    // `now` don't re-render needlessly.
    expect(result.current.now).toBe(firstNow)
  })

  it('DOES produce a new `now` reference across a poll when the clock instant changes', () => {
    const first = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(first))

    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 1000))
    const firstNow = result.current.now

    setExerciseClock(fixedClock(new Date('2026-07-16T15:00:00Z')))

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.now).not.toBe(firstNow)
    expect(result.current.now).toEqual(new Date('2026-07-16T15:00:00Z'))
  })

  it('clears the poll interval on unmount (no leaked interval)', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { unmount } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 1000))
    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Clock change-notification (subscribe) vs. the default polling mock.
  // -------------------------------------------------------------------------

  it('updates immediately on a subscribe() notification, without waiting for the poll interval', () => {
    const clock = subscribableClock(new Date('2026-07-16T14:00:00Z'))
    setExerciseClock(clock)

    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 30_000))
    expect(result.current.now).toEqual(new Date('2026-07-16T14:00:00Z'))

    act(() => {
      clock.push(new Date('2026-07-16T20:00:00Z'))
    })

    // No timer advanced at all - the update arrived via the notification,
    // not the (30s, unelapsed) poll.
    expect(result.current.now).toEqual(new Date('2026-07-16T20:00:00Z'))
  })

  it('unsubscribes from the clock on unmount when the clock supports subscribe()', () => {
    const clock = subscribableClock(new Date('2026-07-16T14:00:00Z'))
    setExerciseClock(clock)

    const { unmount } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 30_000))
    unmount()

    // A post-unmount notification must not throw or resurrect the hook state -
    // proves the returned unsubscribe function was actually invoked.
    expect(() => {
      act(() => {
        clock.push(new Date('2031-01-01T00:00:00Z'))
      })
    }).not.toThrow()
  })

  it('the default mock (no subscribe) still updates only via polling', () => {
    const first = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(first))

    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 1000))
    setExerciseClock(fixedClock(new Date('2026-07-16T15:00:00Z')))

    // Before the interval elapses, nothing has propagated - there is no
    // subscribe() to shortcut the poll.
    expect(result.current.now).toEqual(first)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.now).toEqual(new Date('2026-07-16T15:00:00Z'))
  })

  // -------------------------------------------------------------------------
  // One "now" per render: format() anchors relative rendering to the hook's
  // single snapshot; opts.now overrides it.
  // -------------------------------------------------------------------------

  it('anchors format() relative rendering to a single "now" snapshot - two calls in one render agree', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 30_000))

    const twoHoursBefore = new Date('2026-07-16T12:00:00Z')
    const thirtyMinutesBefore = new Date('2026-07-16T13:30:00Z')

    expect(result.current.format(twoHoursBefore, { format: 'relative' })).toBe('2h ago')
    expect(result.current.format(thirtyMinutesBefore, { format: 'relative' })).toBe('30m ago')
  })

  it('format() opts.now overrides the hook-anchored snapshot when explicitly supplied', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    const { result } = renderHook(() => useScenarioTime(MOCK_SCENARIO_TIME_ZONE, 30_000))

    const instant = new Date('2026-07-16T12:00:00Z')
    const overrideNow = new Date('2026-07-16T13:00:00Z')

    expect(result.current.format(instant, { format: 'relative', now: overrideNow })).toBe('1h ago')
  })
})
