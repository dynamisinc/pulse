/**
 * features/participant-shell/components/OverlayLayer/wallClock.test.ts
 * ---------------------------------------------------------------------------
 * Story 05 (overlay layer) — pure-function coverage for the SOLE COR-053
 * exception (CTL-024/D7-003): `readWallClockNow()` reads the LIVE system
 * clock at call time (never a cached/hardcoded instant), and
 * `formatWallClockNow()` renders a real-world date+time string that changes
 * with the instant passed in (not a static label).
 *
 * This module is the ONE place in `participant-shell/**` allowed to touch
 * `new Date()` (see `wallClock.ts`'s module header) — these tests exercise
 * that read directly rather than the eslint ban itself (mechanical, not
 * unit-testable).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatWallClockNow, readWallClockNow } from './wallClock'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('readWallClockNow (the sole COR-053 exception)', () => {
  it('reads the live system clock at call time, not a cached/fixed instant', () => {
    vi.setSystemTime(new Date('2031-06-15T12:00:00Z'))
    expect(readWallClockNow().getTime()).toBe(new Date('2031-06-15T12:00:00Z').getTime())

    vi.setSystemTime(new Date('2031-06-15T12:05:30Z'))
    expect(readWallClockNow().getTime()).toBe(new Date('2031-06-15T12:05:30Z').getTime())
  })
})

describe('formatWallClockNow', () => {
  it('renders distinct output for two different instants (not a hardcoded string)', () => {
    const first = formatWallClockNow(new Date('2028-01-02T03:04:05Z'))
    const second = formatWallClockNow(new Date('2030-11-22T18:30:00Z'))

    expect(first).not.toBe(second)
  })

  it('renders a real date+time string carrying the instant\'s year and a time component', () => {
    // Mid-day UTC so the assertion holds regardless of the test runner's
    // local time zone offset (no locale/zone flip across a day boundary).
    const formatted = formatWallClockNow(new Date('2029-09-09T12:00:00Z'))

    expect(formatted).toContain('2029')
    // dateStyle + timeStyle both applied - a genuine date+time render, not
    // just a bare year.
    expect(formatted).toContain(':')
  })
})
