/**
 * features/participantAdmin/dayWord/dayWordDates.test.ts
 * ---------------------------------------------------------------------------
 * Pure date helpers for the day-word panel: calendar-date arithmetic that cannot
 * drift across DST or the browser's zone, the 14-day pre-set window, and labels
 * that always name the EXERCISE zone (never the browser's).
 */
import { describe, expect, it } from 'vitest'
import {
  addDaysToDate,
  formatDateLabel,
  formatInstant,
  isDateString,
  isPresetDateInRange,
  lastPresetDate,
  presetDateRange,
} from './dayWordDates'

describe('isDateString', () => {
  it('accepts a real yyyy-MM-dd date', () => {
    expect(isDateString('2026-10-13')).toBe(true)
    expect(isDateString('2028-02-29')).toBe(true)
  })

  it('rejects the wrong shape or an impossible date', () => {
    expect(isDateString('2026-13-01')).toBe(false)
    expect(isDateString('2026-02-30')).toBe(false)
    expect(isDateString('2027-02-29')).toBe(false)
    expect(isDateString('10/13/2026')).toBe(false)
    expect(isDateString('2026-10-13T00:00:00Z')).toBe(false)
    expect(isDateString(undefined)).toBe(false)
    expect(isDateString(20261013)).toBe(false)
  })
})

describe('addDaysToDate', () => {
  it('adds days within a month', () => {
    expect(addDaysToDate('2026-10-13', 1)).toBe('2026-10-14')
  })

  it('rolls over months and years', () => {
    expect(addDaysToDate('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('handles leap years', () => {
    expect(addDaysToDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysToDate('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('is exact across a DST change (calendar days, not 24 h blocks)', () => {
    // US spring forward 2026-03-08, fall back 2026-11-01.
    expect(addDaysToDate('2026-03-07', 2)).toBe('2026-03-09')
    expect(addDaysToDate('2026-10-31', 2)).toBe('2026-11-02')
  })

  it('goes backwards with a negative count', () => {
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('the 14-day pre-set window', () => {
  it('ends 14 days after today', () => {
    expect(lastPresetDate('2026-10-13')).toBe('2026-10-27')
  })

  it('lists today plus 14 later dates, in order', () => {
    const range = presetDateRange('2026-10-13')
    expect(range).toHaveLength(15)
    expect(range[0]).toBe('2026-10-13')
    expect(range[14]).toBe('2026-10-27')
    expect([...range].sort()).toEqual(range)
  })

  it('accepts today and the last day, rejects the day before and the day after', () => {
    expect(isPresetDateInRange('2026-10-13', '2026-10-13')).toBe(true)
    expect(isPresetDateInRange('2026-10-27', '2026-10-13')).toBe(true)
    expect(isPresetDateInRange('2026-10-12', '2026-10-13')).toBe(false)
    expect(isPresetDateInRange('2026-10-28', '2026-10-13')).toBe(false)
  })

  it('rejects an empty or malformed value', () => {
    expect(isPresetDateInRange('', '2026-10-13')).toBe(false)
    expect(isPresetDateInRange('soon', '2026-10-13')).toBe(false)
  })
})

describe('formatDateLabel', () => {
  it('writes a long label with the weekday', () => {
    expect(formatDateLabel('2026-10-13')).toBe('Tuesday, October 13, 2026')
  })

  it('writes a short label', () => {
    expect(formatDateLabel('2026-10-13', 'short')).toBe('Tue, Oct 13')
  })

  it('falls back to the raw value for a non-date', () => {
    expect(formatDateLabel('nope')).toBe('nope')
  })
})

describe('formatInstant', () => {
  it('renders in the EXERCISE zone and names it', () => {
    // 04:00Z is midnight in New York (EDT, UTC-4) on 2026-10-14.
    expect(formatInstant('2026-10-14T04:00:00.000Z', 'America/New_York')).toMatch(
      /Oct 14, 2026.*12:00.AM.EDT/,
    )
  })

  it('shows a different wall time for a different zone', () => {
    expect(formatInstant('2026-10-14T04:00:00.000Z', 'America/Los_Angeles')).toMatch(
      /Oct 13, 2026.*9:00.PM.PDT/,
    )
  })

  it('falls back to the raw string for a bad instant or zone instead of throwing', () => {
    expect(formatInstant('not-a-date', 'America/New_York')).toBe('not-a-date')
    expect(formatInstant('2026-10-14T04:00:00.000Z', 'Mars/Olympus')).toBe(
      '2026-10-14T04:00:00.000Z',
    )
  })
})
