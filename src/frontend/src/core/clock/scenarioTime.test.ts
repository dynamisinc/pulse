/**
 * core/clock/scenarioTime.test.ts
 * ---------------------------------------------------------------------------
 * Priority: the cross-cutting scenario-time rule (COR-053) — see
 * docs/features/exercise-clock/04-scenario-time-participant-visible.md
 * ("Acceptance Criteria" + "Tests").
 *
 * Covers, in AC order:
 *  1. scenarioNow() reads through the exercise-clock indirection, never
 *     Date.now()/unadorned new Date() directly.
 *  2. formatScenarioTime renders absolute/dateline/relative in scenario time
 *     using the *passed-in* IANA timeZone (Intl.DateTimeFormat), and never
 *     falls back to wall-clock.
 *  3. Relative strings are computed against scenarioNow(), not the real
 *     clock — proven by driving the real system clock and the fake exercise
 *     clock to deliberately divergent instants.
 *  4. A backdated item and a later-inserted (post-jump) backfill item render
 *     in correct scenario order, independent of insertion order.
 *  5. No wall-clock leak: Date.now() is never touched while formatting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatScenarioTime, MOCK_SCENARIO_TIME_ZONE, scenarioNow } from './scenarioTime'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from './exerciseClock'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('scenarioNow()', () => {
  it('reflects a swapped exercise-clock instant exactly, proving it reads through the clock source', () => {
    const instant = new Date('2026-07-16T18:00:00Z')
    setExerciseClock(fixedClock(instant))

    expect(scenarioNow()).toBe(instant)
  })

  it('never resolves to the real wall clock when the exercise clock disagrees with it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('1999-01-01T00:00:00Z'))

    const scenarioInstant = new Date('2031-06-15T12:00:00Z')
    setExerciseClock(fixedClock(scenarioInstant))

    expect(scenarioNow().toISOString()).toBe(scenarioInstant.toISOString())
    expect(scenarioNow().getTime()).not.toBe(Date.now())
  })
})

describe('formatScenarioTime - absolute', () => {
  it('renders using the passed-in IANA time zone (TZ-correct)', () => {
    const instant = new Date('2026-07-16T04:30:00Z')

    const ny = formatScenarioTime(instant, 'America/New_York', { format: 'absolute' })
    const tokyo = formatScenarioTime(instant, 'Asia/Tokyo', { format: 'absolute' })

    expect(ny).toBe('Jul 16, 2026, 12:30 AM')
    expect(tokyo).toBe('Jul 16, 2026, 1:30 PM')
    expect(ny).not.toBe(tokyo)
  })

  it('defaults to the mock scenario time zone when none is passed', () => {
    const instant = new Date('2026-07-16T04:30:00Z')

    expect(formatScenarioTime(instant)).toBe(
      formatScenarioTime(instant, MOCK_SCENARIO_TIME_ZONE),
    )
  })

  it('accepts an ISO string or epoch-ms instant, not only a Date', () => {
    const iso = '2026-07-16T04:30:00Z'
    const ms = new Date(iso).getTime()

    expect(formatScenarioTime(iso, 'America/New_York')).toBe(
      formatScenarioTime(ms, 'America/New_York'),
    )
  })
})

describe('formatScenarioTime - dateline', () => {
  it('renders an uppercase news-style dateline in the given zone', () => {
    const instant = new Date('2026-07-16T12:00:00Z')

    expect(formatScenarioTime(instant, 'America/New_York', { format: 'dateline' })).toBe(
      'JUL 16, 2026',
    )
  })

  it('reflects a date change across a time-zone boundary for the very same instant', () => {
    const instant = new Date('2026-07-16T23:00:00Z')

    const tokyoDateline = formatScenarioTime(instant, 'Asia/Tokyo', { format: 'dateline' })
    const nyDateline = formatScenarioTime(instant, 'America/New_York', { format: 'dateline' })

    expect(tokyoDateline).toBe('JUL 17, 2026')
    expect(nyDateline).toBe('JUL 16, 2026')
    expect(tokyoDateline).not.toBe(nyDateline)
  })
})

describe('formatScenarioTime - relative', () => {
  it('computes elapsed time against scenarioNow(), rendering "Xh ago" for a past instant', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    const twoHoursBefore = new Date('2026-07-16T12:00:00Z')

    expect(
      formatScenarioTime(twoHoursBefore, 'America/New_York', { format: 'relative' }),
    ).toBe('2h ago')
  })

  it('renders minute-scale gaps as "Xm ago"', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    const thirtyMinutesBefore = new Date('2026-07-16T13:30:00Z')

    expect(
      formatScenarioTime(thirtyMinutesBefore, 'America/New_York', { format: 'relative' }),
    ).toBe('30m ago')
  })

  it('renders a future instant as "in Xh"', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    const threeHoursAhead = new Date('2026-07-16T17:00:00Z')

    expect(
      formatScenarioTime(threeHoursAhead, 'America/New_York', { format: 'relative' }),
    ).toBe('in 3h')
  })

  it('renders "just now" for gaps under the just-now threshold', () => {
    const scenarioInstant = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(scenarioInstant))

    const tenSecondsBefore = new Date(scenarioInstant.getTime() - 10_000)

    expect(
      formatScenarioTime(tenSecondsBefore, 'America/New_York', { format: 'relative' }),
    ).toBe('just now')
  })

  it('falls back to an absolute rendering once the gap exceeds ~7 days', () => {
    const scenarioInstant = new Date('2026-07-16T14:00:00Z')
    setExerciseClock(fixedClock(scenarioInstant))

    const fifteenDaysBefore = new Date('2026-07-01T14:00:00Z')

    const relative = formatScenarioTime(fifteenDaysBefore, 'America/New_York', {
      format: 'relative',
    })
    const absolute = formatScenarioTime(fifteenDaysBefore, 'America/New_York', {
      format: 'absolute',
    })

    expect(relative).toBe(absolute)
  })

  it('is computed against scenarioNow(), never the real wall clock', () => {
    // Drive the real system clock to an instant wildly different from the
    // fake scenario clock; if `formatRelative` ever fell through to
    // Date.now()/new Date() this assertion would fail.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('1999-01-01T00:00:00Z'))

    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    const thirtyMinutesBefore = new Date('2026-07-16T13:30:00Z')

    expect(
      formatScenarioTime(thirtyMinutesBefore, 'America/New_York', { format: 'relative' }),
    ).toBe('30m ago')
  })

  it('never touches Date.now() while formatting, across all three renderings (no wall-clock leak)', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    const dateNowSpy = vi.spyOn(Date, 'now')

    const instant = new Date('2026-07-16T10:00:00Z')
    formatScenarioTime(instant, 'America/New_York', { format: 'absolute' })
    formatScenarioTime(instant, 'America/New_York', { format: 'dateline' })
    formatScenarioTime(instant, 'America/New_York', { format: 'relative' })

    expect(dateNowSpy).not.toHaveBeenCalled()
    dateNowSpy.mockRestore()
  })
})

describe('backdated + backfilled content ordering (COR-023, story 02)', () => {
  it('renders a backdated persona post and a later post-jump backfill in correct scenario order, regardless of insertion order', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    // COR-023: a persona post authored/inserted into the feed LAST, but
    // whose content instant is further back in scenario time.
    const backdated = { id: 'backdated-persona-post', instant: new Date('2026-07-16T10:00:00Z') }
    // Story 02: a post-jump backfill inserted FIRST (before the backdated
    // item lands), but whose content instant is closer to scenarioNow().
    const backfilled = { id: 'post-jump-backfill', instant: new Date('2026-07-16T13:00:00Z') }

    const insertionOrder = [backfilled, backdated]
    const scenarioOrder = [...insertionOrder].sort(
      (a, b) => a.instant.getTime() - b.instant.getTime(),
    )

    // Correct scenario chronology puts the backdated item first, even
    // though it was inserted second.
    expect(scenarioOrder.map(item => item.id)).toEqual([
      'backdated-persona-post',
      'post-jump-backfill',
    ])

    expect(
      formatScenarioTime(backdated.instant, 'America/New_York', { format: 'relative' }),
    ).toBe('4h ago')
    expect(
      formatScenarioTime(backfilled.instant, 'America/New_York', { format: 'relative' }),
    ).toBe('1h ago')
  })
})
