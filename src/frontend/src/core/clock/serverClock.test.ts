/**
 * core/clock/serverClock.test.ts
 * The server-synced clock's three states and its optimistic override
 * (fix/noise-new-posts-clock): frozen, running with offset (incl. latency and a skewed
 * client clock), not started, push applied (notifies), optimistic freeze/resume/clear.
 */
import { describe, expect, it, vi } from 'vitest'
import { createServerExerciseClock, parseScenarioClockState } from './serverClock'
import type { ScenarioClockState } from './serverClock'

function state(overrides: Partial<ScenarioClockState> = {}): ScenarioClockState {
  return {
    started: true,
    frozen: false,
    scenarioTime: '2026-10-21T14:00:00.000Z',
    serverTime: '2026-10-21T15:00:00.000Z',
    ...overrides,
  }
}

function harness(startMs = Date.parse('2026-10-21T15:00:00.000Z')) {
  let wall = startMs
  const clock = createServerExerciseClock({ wallNowMs: () => wall })
  return { clock, advance: (ms: number) => { wall += ms } }
}

describe('server exercise clock', () => {
  it('is the wall clock and mirrorsWallClock before anything is applied (unreachable)', () => {
    const { clock } = harness()
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T15:00:00.000Z')
    expect(clock.mirrorsWallClock).toBe(true)
    expect(clock.isSynced).toBe(false)
  })

  it('stays the wall clock when the server says not started', () => {
    const { clock } = harness()
    clock.apply(state({ started: false, scenarioTime: null }))
    expect(clock.mirrorsWallClock).toBe(true)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T15:00:00.000Z')
  })

  it('RUNNING: advances with the wall clock from the server scenario instant', () => {
    const { clock, advance } = harness()
    clock.apply(state())
    expect(clock.mirrorsWallClock).toBe(false)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.000Z')
    advance(90_000)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:01:30.000Z')
  })

  it('RUNNING: adds half the round trip for a read', () => {
    const { clock } = harness()
    clock.apply(state(), 200)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.200Z')
  })

  it('RUNNING: is right even when the client wall clock is skewed from the server', () => {
    const { clock, advance } = harness(Date.parse('2026-10-21T15:07:00.000Z')) // 7 min ahead
    clock.apply(state())
    advance(1_000)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:01.000Z')
  })

  it('FROZEN: holds the scenario instant while the wall clock moves', () => {
    const { clock, advance } = harness()
    clock.apply(state({ frozen: true }))
    advance(600_000)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.000Z')
    expect(clock.isFrozen).toBe(true)
    expect(clock.mirrorsWallClock).toBe(false)
  })

  it('notifies subscribers on every applied change, and not after unsubscribe', () => {
    const { clock } = harness()
    const listener = vi.fn()
    const off = clock.subscribe(listener)
    clock.apply(state())
    clock.apply(state({ frozen: true }))
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    clock.apply(state())
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a push replaces an optimistic freeze', () => {
    const { clock, advance } = harness()
    clock.apply(state())
    clock.optimisticFreeze()
    advance(5_000)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.000Z')
    clock.apply(state({ frozen: true, scenarioTime: '2026-10-21T14:00:03.000Z' }))
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:03.000Z')
  })

  it('optimisticResume undoes a refused freeze onto the SERVER running time', () => {
    const { clock, advance } = harness()
    clock.apply(state())
    clock.optimisticFreeze()
    advance(30_000)
    clock.optimisticResume()
    expect(clock.isFrozen).toBe(false)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:30.000Z')
  })

  it('optimisticResume on a server-frozen clock runs from the held instant', () => {
    const { clock, advance } = harness()
    clock.apply(state({ frozen: true }))
    clock.optimisticResume()
    advance(10_000)
    expect(clock.scenarioNow().toISOString()).toBe('2026-10-21T14:00:10.000Z')
  })

  it('an unchanged re-applied state (the periodic resync) does not notify', () => {
    const { clock, advance } = harness()
    clock.apply(state())
    const listener = vi.fn()
    clock.subscribe(listener)
    advance(60_000)
    clock.apply(state({ scenarioTime: '2026-10-21T14:01:00.010Z' }), 5) // jitter only
    expect(listener).not.toHaveBeenCalled()
    clock.apply(state({ scenarioTime: '2026-10-21T14:05:00.000Z' })) // a real jump
    expect(listener).toHaveBeenCalledTimes(1)
    clock.apply(state({ frozen: true, scenarioTime: '2026-10-21T14:05:00.000Z' }))
    clock.apply(state({ frozen: true, scenarioTime: '2026-10-21T14:05:00.020Z' }))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('clearOptimistic drops the override; reset returns to the wall clock', () => {
    const { clock } = harness()
    clock.apply(state())
    clock.optimisticFreeze()
    clock.clearOptimistic()
    expect(clock.isFrozen).toBe(false)
    clock.reset()
    expect(clock.mirrorsWallClock).toBe(true)
  })
})

describe('parseScenarioClockState', () => {
  it('accepts a started and a not-started body', () => {
    expect(parseScenarioClockState(state())).not.toBeNull()
    expect(
      parseScenarioClockState({
        started: false, frozen: false, scenarioTime: null, serverTime: '2026-10-21T15:00:00Z',
      }),
    ).not.toBeNull()
  })

  it('rejects malformed bodies', () => {
    expect(parseScenarioClockState(null)).toBeNull()
    expect(parseScenarioClockState({})).toBeNull()
    expect(parseScenarioClockState({ ...state(), scenarioTime: 'nope' })).toBeNull()
    expect(parseScenarioClockState({ ...state(), scenarioTime: null })).toBeNull() // started + null
  })
})
