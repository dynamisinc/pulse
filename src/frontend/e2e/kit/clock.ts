/**
 * e2e/kit/clock.ts
 * ---------------------------------------------------------------------------
 * Scenario-time guard for participant pages (COR-053): participants see
 * scenario time only, never the real wall clock.
 *
 * `expectNoWallClock` fails when the page's visible text contains today's REAL
 * date in a common format (e.g. "Oct 16, 2026", "October 16", "10/16/2026",
 * "2026-10-16"). The scenario in the mock exercise is in 2033, so a legitimate
 * stamp can never collide. Dates are computed in the browser's timezone (the
 * config pins America/New_York) from the machine clock.
 */
import { expect, type Page } from '@playwright/test'

/** Formats of "today" a leaked wall-clock date could take. Exported for tests. */
export function wallClockDateStrings(now: Date, timeZone = 'America/New_York'): string[] {
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)
  const year = part({ year: 'numeric' })
  const day = String(Number(part({ day: 'numeric' })))
  const dayPad = day.padStart(2, '0')
  const monthNum = String(Number(part({ month: 'numeric' })))
  const monthPad = monthNum.padStart(2, '0')
  const short = part({ month: 'short' })
  const long = part({ month: 'long' })
  return [
    `${short} ${day}, ${year}`, `${long} ${day}, ${year}`, `${short} ${day} ${year}`,
    `${day} ${short} ${year}`, `${day} ${long} ${year}`,
    `${monthNum}/${day}/${year}`, `${monthPad}/${dayPad}/${year}`,
    `${year}-${monthPad}-${dayPad}`,
  ]
}

/** Fails if any visible text on the page shows today's real date. */
export async function expectNoWallClock(page: Page): Promise<void> {
  const text = (await page.locator('body').innerText()).toLowerCase()
  const leaks = wallClockDateStrings(new Date()).filter(s => text.includes(s.toLowerCase()))
  expect(leaks, 'wall-clock date visible to a participant (COR-053)').toEqual([])
}
