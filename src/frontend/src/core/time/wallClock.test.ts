/**
 * core/time/wallClock.test.ts
 * ---------------------------------------------------------------------------
 * `core/time/**` is NOT covered by the participant-surface wall-clock ESLint
 * ban (see `wallClock.ts`'s header) — this file legitimately uses
 * `Date.now()` / `new Date()` to verify the helper reflects real time.
 */
import { describe, expect, it } from 'vitest'
import { wallClockNowIso } from './wallClock'

describe('wallClockNowIso', () => {
  it('returns a well-formed ISO-8601 UTC string', () => {
    const iso = wallClockNowIso()
    expect(typeof iso).toBe('string')
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('parses to a valid instant', () => {
    const iso = wallClockNowIso()
    expect(Number.isNaN(Date.parse(iso))).toBe(false)
  })

  it('reflects the real current time (within tolerance), not a fixed/mock value', () => {
    const before = Date.now()
    const iso = wallClockNowIso()
    const after = Date.now()
    const parsed = Date.parse(iso)

    expect(parsed).toBeGreaterThanOrEqual(before)
    expect(parsed).toBeLessThanOrEqual(after)
  })

  it('returns a fresh value on each call (advances over time)', async () => {
    const first = wallClockNowIso()
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = wallClockNowIso()
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first))
  })
})
