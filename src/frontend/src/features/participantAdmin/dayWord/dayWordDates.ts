/**
 * features/participantAdmin/dayWord/dayWordDates.ts
 * ---------------------------------------------------------------------------
 * Pure date helpers for the day-word panel (easy-login story 11).
 *
 * TWO KINDS OF VALUE, kept apart on purpose:
 *
 *  - a CALENDAR DATE (`yyyy-MM-dd`, the contract's `today` / `date`): a label for
 *    a day in the EXERCISE time zone. It has no instant and no zone of its own,
 *    so arithmetic on it (`addDaysToDate`) and its labels (`formatDateLabel`)
 *    run in UTC at noon - that cannot drift across a DST change or the browser's
 *    zone. The server decides what "today" is; this file never computes it from
 *    the browser's clock.
 *  - an INSTANT (an ISO-8601 string, the contract's `setAt` / `todayEndsAt` /
 *    `validUntil`): rendered with `formatInstant` IN THE EXERCISE ZONE with the
 *    zone abbreviation shown, never the browser's zone.
 *
 * STAFF WORLD: these are real wall-clock dates in the exercise zone. Scenario
 * time is never used for "today" (EL-9, COR-053 is a participant rule).
 *
 * No React, no network - unit-tested in `dayWordDates.test.ts`.
 */

import { DAY_WORD_MAX_DAYS_AHEAD } from './types'

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written `yyyy-MM-dd`. */
export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = YMD.exec(value)
  if (!match) return false
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12))
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  )
}

/** `date` plus `days` calendar days (negative allowed), as `yyyy-MM-dd`. */
export function addDaysToDate(date: string, days: number): string {
  const match = YMD.exec(date)
  if (!match) return date
  const [, y, m, d] = match
  const shifted = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days, 12))
  const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0')
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** The last date a word may be pre-set for, given the exercise's `today`. */
export function lastPresetDate(today: string): string {
  return addDaysToDate(today, DAY_WORD_MAX_DAYS_AHEAD)
}

/** Today plus the next 14 days, in order (15 entries). */
export function presetDateRange(today: string): string[] {
  const dates: string[] = []
  for (let offset = 0; offset <= DAY_WORD_MAX_DAYS_AHEAD; offset += 1) {
    dates.push(addDaysToDate(today, offset))
  }
  return dates
}

/** True when `date` is `today` or a later date within the 14-day window. */
export function isPresetDateInRange(date: string, today: string): boolean {
  // `yyyy-MM-dd` sorts lexically, so string comparison is date comparison.
  return isDateString(date) && date >= today && date <= lastPresetDate(today)
}

/**
 * A calendar date as a label, e.g. `Tuesday, October 13, 2026` (`long`) or
 * `Tue, Oct 13` (`short`). Falls back to the raw string for anything that is not
 * a real date.
 */
export function formatDateLabel(date: string, style: 'long' | 'short' = 'long'): string {
  const match = YMD.exec(date)
  if (!match || !isDateString(date)) return date
  const [, y, m, d] = match
  const noonUtc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12))
  const options: Intl.DateTimeFormatOptions = style === 'long'
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
    : { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
  return new Intl.DateTimeFormat('en-US', options).format(noonUtc)
}

/**
 * An instant as `Oct 13, 2026, 9:02 AM EDT` IN THE EXERCISE ZONE (the zone
 * abbreviation is part of the string, so the zone is always named). An
 * unparseable instant or an unknown zone falls back to the raw string rather
 * than throwing mid-render.
 */
export function formatInstant(iso: string, timeZone: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('en-US', {
      // Explicit fields: `dateStyle`/`timeStyle` cannot be combined with
      // `timeZoneName`, and the zone abbreviation is the point of this label.
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone,
    }).format(instant)
  } catch {
    return iso
  }
}
