/**
 * core/clock/exerciseClock.test.ts
 * ---------------------------------------------------------------------------
 * Covers the Wave-0 mock `IExerciseClock` source itself: the swap/reset seam
 * that `scenarioTime.ts` (and its tests) rely on to prove `scenarioNow()`
 * reads through this indirection rather than reaching for wall-clock time
 * directly (docs/features/exercise-clock/04-scenario-time-participant-
 * visible.md, COR-053).
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  getExerciseClock,
  isWallMirroringExerciseClock,
  resetExerciseClock,
  setExerciseClock,
  type IExerciseClock,
} from './exerciseClock'

afterEach(() => {
  resetExerciseClock()
})

describe('exerciseClock', () => {
  it('defaults to a clock whose scenarioNow() tracks real time (Wave-0 mock behavior)', () => {
    const before = Date.now()
    const reading = getExerciseClock().scenarioNow().getTime()
    const after = Date.now()

    expect(reading).toBeGreaterThanOrEqual(before)
    expect(reading).toBeLessThanOrEqual(after)
  })

  it('setExerciseClock swaps the active clock so scenarioNow() reflects the fake instant', () => {
    const fixedInstant = new Date('2031-01-01T00:00:00Z')
    const fake: IExerciseClock = { scenarioNow: () => fixedInstant }

    setExerciseClock(fake)

    expect(getExerciseClock().scenarioNow()).toBe(fixedInstant)
    expect(getExerciseClock().scenarioNow().getTime()).not.toBe(Date.now())
  })

  it('resetExerciseClock restores the default wall-clock-mirroring mock', () => {
    setExerciseClock({ scenarioNow: () => new Date('2031-01-01T00:00:00Z') })
    resetExerciseClock()

    const reading = getExerciseClock().scenarioNow().getTime()
    expect(Math.abs(reading - Date.now())).toBeLessThan(5000)
  })

  it('isWallMirroringExerciseClock is true only while the wall-mirroring default is active (story 17)', () => {
    expect(isWallMirroringExerciseClock()).toBe(true)
    setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
    expect(isWallMirroringExerciseClock()).toBe(false)
    resetExerciseClock()
    expect(isWallMirroringExerciseClock()).toBe(true)
  })

  it('treats any clock flagged mirrorsWallClock (e.g. the pausable clock) as wall-mirroring', () => {
    setExerciseClock({ scenarioNow: () => new Date(), mirrorsWallClock: true })
    expect(isWallMirroringExerciseClock()).toBe(true)
  })
})
