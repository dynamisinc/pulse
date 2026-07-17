/**
 * core/clock/scenarioTime.test.ts
 * ---------------------------------------------------------------------------
 * Priority: the cross-cutting scenario-time rule (COR-053) — see
 * docs/features/exercise-clock/04-scenario-time-participant-visible.md
 * ("Acceptance Criteria" + "Tests").
 *
 * Covers, in AC order:
 *  1. scenarioNow() reads through the exercise-clock indirection, never
 *     Date.now()/unadorned new Date() directly, and returns a fresh, immutable
 *     Date snapshot each call.
 *  2. formatScenarioTime renders absolute/dateline/relative in scenario time
 *     using the *passed-in* IANA timeZone (Intl.DateTimeFormat), and never
 *     falls back to wall-clock. `timeZone` defaults to UTC
 *     (DEFAULT_SCENARIO_TIME_ZONE), never a plausible-but-wrong regional zone.
 *  3. Relative strings are computed against scenarioNow(), not the real
 *     clock — proven by driving the real system clock and the fake exercise
 *     clock to deliberately divergent instants — and are PURE INSTANT
 *     ARITHMETIC: TZ/DST-independent, and unaffected by an injected `now`
 *     override vs. the ambient scenario clock ("one now per render").
 *  4. A backdated item and a later-inserted (post-jump) backfill item render
 *     in correct scenario order, independent of insertion order.
 *  5. No wall-clock leak: Date.now() is never touched while formatting.
 *  6. An unparseable instant renders as an empty string in every format,
 *     never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SCENARIO_TIME_ZONE,
  formatScenarioTime,
  MOCK_SCENARIO_TIME_ZONE,
  scenarioNow,
} from './scenarioTime'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from './exerciseClock'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('scenarioNow()', () => {
  it('reflects the VALUE of a swapped exercise-clock instant, proving it reads through the clock source', () => {
    const instant = new Date('2026-07-16T18:00:00Z')
    setExerciseClock(fixedClock(instant))

    const reading = scenarioNow()
    // Time-equality, not reference-equality: scenarioNow() returns a fresh
    // Date copy, never the clock's own instant object.
    expect(reading.getTime()).toBe(instant.getTime())
    expect(reading).not.toBe(instant)
  })

  it('returns a fresh Date each call — mutating a previous reading never affects a later one', () => {
    const instant = new Date('2026-07-16T18:00:00Z')
    setExerciseClock(fixedClock(instant))

    const first = scenarioNow()
    first.setFullYear(1999)
    first.setMonth(0)
    first.setDate(1)

    // A later read must be unaffected by mutating the previously-returned
    // Date (immutability) — and the clock's own source instant is untouched.
    const second = scenarioNow()
    expect(second.getTime()).toBe(instant.getTime())
    expect(instant.getTime()).toBe(new Date('2026-07-16T18:00:00Z').getTime())
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

  it('defaults to UTC (DEFAULT_SCENARIO_TIME_ZONE), never a plausible-but-wrong regional zone', () => {
    const instant = new Date('2026-07-16T04:30:00Z')

    expect(DEFAULT_SCENARIO_TIME_ZONE).toBe('UTC')
    expect(formatScenarioTime(instant)).toBe(
      formatScenarioTime(instant, DEFAULT_SCENARIO_TIME_ZONE),
    )
    // And it is NOT the mock regional zone — a forgotten timeZone must fail
    // loud (an odd UTC time), not silently render a plausible NY time.
    expect(formatScenarioTime(instant)).not.toBe(
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

  it('renders day-scale gaps as "Xd ago" (the 1-7-day band)', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    const threeDaysBefore = new Date('2026-07-13T14:00:00Z')

    expect(
      formatScenarioTime(threeDaysBefore, 'America/New_York', { format: 'relative' }),
    ).toBe('3d ago')
  })

  it('renders the boundary exactly at 7 days as "7d ago" - not yet the absolute fallback', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    const exactlySevenDaysBefore = new Date('2026-07-09T14:00:00Z')

    expect(
      formatScenarioTime(exactlySevenDaysBefore, 'America/New_York', { format: 'relative' }),
    ).toBe('7d ago')
  })

  it('falls back to absolute just beyond the 7-day boundary (7 days + 1 minute)', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    const justOverSevenDaysBefore = new Date('2026-07-09T13:59:00Z')

    const relative = formatScenarioTime(justOverSevenDaysBefore, 'America/New_York', {
      format: 'relative',
    })
    const absolute = formatScenarioTime(justOverSevenDaysBefore, 'America/New_York', {
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

describe('formatScenarioTime - relative is a pure instant delta (TZ/DST-independent)', () => {
  it('renders the SAME relative string for the same two instants regardless of the timeZone passed', () => {
    const reference = new Date('2026-07-16T14:00:00Z')
    const fiveHoursBefore = new Date('2026-07-16T09:00:00Z')

    const opts = { format: 'relative' as const, now: reference }
    const inNewYork = formatScenarioTime(fiveHoursBefore, 'America/New_York', opts)
    const inTokyo = formatScenarioTime(fiveHoursBefore, 'Asia/Tokyo', opts)
    const inUtc = formatScenarioTime(fiveHoursBefore, 'UTC', opts)

    expect(inNewYork).toBe('5h ago')
    expect(inTokyo).toBe(inNewYork)
    expect(inUtc).toBe(inNewYork)
  })

  it('renders a 23h real gap across the US spring-forward DST boundary as "23h ago", never "1d ago"', () => {
    // 2026-03-08 is the US spring-forward date: America/New_York clocks jump
    // from 2:00 AM to 3:00 AM at 07:00 UTC, so that calendar day is only 23
    // real hours long. A calendar/local-wall-clock diff of these two instants
    // (same 08:00 local time of day, one calendar day apart) would wrongly
    // read "1 day"; pure instant-ms arithmetic correctly reads "23h ago" -
    // exactly the bug this module's relative-time design fixes.
    const reference = new Date('2026-03-08T12:00:00Z') // 08:00 EDT (post-transition)
    const twentyThreeHoursBefore = new Date('2026-03-07T13:00:00Z') // 08:00 EST (pre-transition)

    expect(reference.getTime() - twentyThreeHoursBefore.getTime()).toBe(23 * 60 * 60 * 1000)

    const opts = { format: 'relative' as const, now: reference }
    const inNewYork = formatScenarioTime(twentyThreeHoursBefore, 'America/New_York', opts)

    expect(inNewYork).toBe('23h ago')
    expect(inNewYork).not.toBe('1d ago')

    // And, as above, the rendering does not depend on which zone is passed.
    expect(formatScenarioTime(twentyThreeHoursBefore, 'Asia/Tokyo', opts)).toBe(inNewYork)
  })
})

describe('formatScenarioTime - invalid instant', () => {
  it('returns an empty string, never throws, for an unparseable instant in every format', () => {
    const formats = ['absolute', 'dateline', 'relative'] as const

    for (const format of formats) {
      expect(() => formatScenarioTime('garbage', 'America/New_York', { format })).not.toThrow()
      expect(formatScenarioTime('garbage', 'America/New_York', { format })).toBe('')
    }
  })

  it('returns an empty string for a NaN epoch-ms instant', () => {
    expect(formatScenarioTime(NaN, 'America/New_York', { format: 'absolute' })).toBe('')
    expect(formatScenarioTime(NaN, 'America/New_York', { format: 'relative' })).toBe('')
  })
})

describe('formatScenarioTime - one "now" per render (opts.now)', () => {
  it('uses the injected `now` for relative rendering rather than re-reading scenarioNow()', () => {
    // The ambient scenario clock disagrees with the injected `now` - the
    // injected reference must win, proving relative rendering does not
    // silently re-read the global clock per call.
    setExerciseClock(fixedClock(new Date('1999-01-01T00:00:00Z')))

    const instant = new Date('2026-07-16T12:00:00Z')
    const injectedNow = new Date('2026-07-16T14:00:00Z')

    expect(
      formatScenarioTime(instant, 'America/New_York', { format: 'relative', now: injectedNow }),
    ).toBe('2h ago')
  })

  it('falls back to scenarioNow() when opts.now is omitted', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    const instant = new Date('2026-07-16T12:00:00Z')

    expect(
      formatScenarioTime(instant, 'America/New_York', { format: 'relative' }),
    ).toBe('2h ago')
  })
})

describe('backdated + backfilled content ordering (COR-023, story 02)', () => {
  // WARN-001 remediation: the previous version of this test hand-rolled an
  // `Array.prototype.sort` over plain objects and asserted the sort result -
  // it exercised the test's own inline comparator, not this module. This
  // version pins the MODULE's own behavior: with a fixed scenarioNow(), the
  // backdated instant must render as OLDER (a larger relative age) than the
  // post-jump backfill instant via formatScenarioTime(..., 'relative') - no
  // hand-rolled sort involved.
  it('renders a backdated persona post as OLDER than a later post-jump backfill, via formatScenarioTime alone', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))

    // COR-023: a persona post authored/inserted into the feed LAST, but
    // whose content instant is further back in scenario time.
    const backdatedInstant = new Date('2026-07-16T10:00:00Z')
    // Story 02: a post-jump backfill inserted FIRST (before the backdated
    // item lands), but whose content instant is closer to scenarioNow().
    const backfilledInstant = new Date('2026-07-16T13:00:00Z')

    const backdatedRelative = formatScenarioTime(backdatedInstant, 'America/New_York', {
      format: 'relative',
    })
    const backfilledRelative = formatScenarioTime(backfilledInstant, 'America/New_York', {
      format: 'relative',
    })

    // The module renders the backdated item as further in the past than the
    // backfill, independent of the order either was inserted into the feed.
    expect(backdatedRelative).toBe('4h ago')
    expect(backfilledRelative).toBe('1h ago')
  })
})
