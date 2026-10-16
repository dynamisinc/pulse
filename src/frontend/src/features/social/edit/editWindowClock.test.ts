/**
 * features/social/edit/editWindowClock.test.ts
 * ---------------------------------------------------------------------------
 * The edit window keeps the EARLIEST deadline per post and never extends it (story 20, Copilot
 * #558): reading 30s, then 10s, then 30s again (thread -> cached feed) ends at the original
 * deadline, not a re-granted 30s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { remainingWindowMs, resetEditWindowReads } from './editWindowClock'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] })
  resetEditWindowReads()
})

afterEach(() => {
  vi.useRealTimers()
  resetEditWindowReads()
})

describe('remainingWindowMs', () => {
  it('counts down from the first read', () => {
    expect(remainingWindowMs('p', 30)).toBe(30_000)
    vi.advanceTimersByTime(12_000)
    expect(remainingWindowMs('p', 30)).toBe(18_000)
  })

  it('never re-grants the window on 30 -> 10 -> 30', () => {
    expect(remainingWindowMs('p', 30)).toBe(30_000) // deadline t=30
    vi.advanceTimersByTime(5_000)
    expect(remainingWindowMs('p', 10)).toBe(10_000) // implied t=15: pulls the deadline in
    vi.advanceTimersByTime(2_000)
    expect(remainingWindowMs('p', 30)).toBe(8_000) // cached 30 again: still the t=15 deadline
    vi.advanceTimersByTime(8_000)
    expect(remainingWindowMs('p', 30)).toBe(0)
  })

  it('keeps posts independent and treats 0 / absent as closed', () => {
    remainingWindowMs('a', 10)
    expect(remainingWindowMs('b', 30)).toBe(30_000)
    expect(remainingWindowMs('a', 0)).toBe(0)
    expect(remainingWindowMs('a', undefined)).toBe(0)
  })
})
