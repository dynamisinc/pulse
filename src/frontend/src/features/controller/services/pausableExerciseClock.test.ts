/**
 * features/controller/services/pausableExerciseClock.test.ts
 * ---------------------------------------------------------------------------
 * Covers the feature-local pausable `IExerciseClock` (world-steering/03;
 * CTL-023, D5-014/1.3, COR-050/053) — the load-bearing clock-safety property
 * behind tiered pause:
 *  - while running, `scenarioNow()` tracks the injected wall clock 1:1;
 *  - `freeze()` holds `scenarioNow()` at a fixed instant across repeated
 *    calls, however far the (fake) wall clock advances;
 *  - `freeze()` is idempotent — freezing twice does not move the held instant;
 *  - `resume()` restores advancement with the frozen span folded into the
 *    accumulated offset — no scenario time lost, none gained (asserted via
 *    the offset math against a controlled wall source, never real timing);
 *  - `resume()` is a no-op while already running;
 *  - `subscribe()` notifies listeners on freeze and on resume (and only then).
 *
 * The wall-clock source is injected (`wallNowMs`) so every assertion is
 * deterministic — no real sleeps, no flakiness.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPausableExerciseClock } from './pausableExerciseClock'

describe('createPausableExerciseClock — running (unfrozen)', () => {
  it('scenarioNow() tracks the injected wall clock 1:1 while running', () => {
    let wallMs = 1_000_000
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })

    expect(clock.isFrozen).toBe(false)
    expect(clock.scenarioNow().getTime()).toBe(1_000_000)

    wallMs = 1_050_000
    expect(clock.scenarioNow().getTime()).toBe(1_050_000)
  })
})

describe('createPausableExerciseClock — freeze holds scenarioNow() at a fixed instant', () => {
  it('repeated calls after freeze() all return the exact same instant, however far wall time moves', () => {
    let wallMs = 2_000_000
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })

    clock.freeze()
    expect(clock.isFrozen).toBe(true)
    const held = clock.scenarioNow().getTime()
    expect(held).toBe(2_000_000)

    wallMs = 2_500_000
    expect(clock.scenarioNow().getTime()).toBe(held)
    wallMs = 9_000_000
    expect(clock.scenarioNow().getTime()).toBe(held)
  })

  it('freezing twice (already frozen) is a no-op — the held instant does not move', () => {
    let wallMs = 3_000_000
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })

    clock.freeze()
    const held = clock.scenarioNow().getTime()

    wallMs = 3_800_000
    clock.freeze() // already frozen — must not re-capture wallMs
    expect(clock.scenarioNow().getTime()).toBe(held)
  })
})

describe('createPausableExerciseClock — resume preserves the frozen span exactly', () => {
  it('resumes with zero scenario time lost: the accumulated offset absorbs the frozen span', () => {
    let wallMs = 1_000_000
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })

    // Running for 10_000ms of wall time before freezing.
    wallMs = 1_010_000
    expect(clock.scenarioNow().getTime()).toBe(1_010_000)

    clock.freeze() // freeze at wall 1_010_000; scenario holds at 1_010_000
    const frozenAt = clock.scenarioNow().getTime()
    expect(frozenAt).toBe(1_010_000)

    // 50_000ms of wall time elapses WHILE frozen — must not appear in scenario time.
    wallMs = 1_060_000
    expect(clock.scenarioNow().getTime()).toBe(frozenAt) // still held

    clock.resume()
    expect(clock.isFrozen).toBe(false)
    // The instant resume() fires, no further wall time has elapsed yet —
    // scenario time must read exactly where it froze (no time lost, no gain).
    expect(clock.scenarioNow().getTime()).toBe(frozenAt)

    // Advancing wall time post-resume advances scenario time 1:1 again, from
    // the resumed baseline — the 50_000ms frozen span never counts.
    wallMs = 1_065_000
    expect(clock.scenarioNow().getTime()).toBe(frozenAt + 5_000)
  })

  it('resume() is a no-op while already running (nothing to fold)', () => {
    const wallMs = 4_000_000
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })

    clock.resume() // never frozen — must be a no-op, not throw
    expect(clock.isFrozen).toBe(false)
    expect(clock.scenarioNow().getTime()).toBe(4_000_000)
  })

  it('multiple freeze/resume cycles each preserve their own span with no drift', () => {
    let wallMs = 0
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })

    wallMs = 100
    clock.freeze()
    wallMs = 400 // 300ms frozen span #1
    clock.resume()
    expect(clock.scenarioNow().getTime()).toBe(100)

    wallMs = 700 // 300ms of running time elapses
    expect(clock.scenarioNow().getTime()).toBe(400)

    clock.freeze()
    wallMs = 2_000 // 1300ms frozen span #2
    clock.resume()
    expect(clock.scenarioNow().getTime()).toBe(400)
  })
})

describe('createPausableExerciseClock — subscribe() notifies on freeze/resume only', () => {
  it('calls listeners once on freeze() and once on resume()', () => {
    let wallMs = 1_000
    const clock = createPausableExerciseClock({ wallNowMs: () => wallMs })
    const listener = vi.fn()
    clock.subscribe(listener)

    clock.freeze()
    expect(listener).toHaveBeenCalledTimes(1)

    wallMs = 2_000
    clock.resume()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not notify on a redundant freeze()/resume() (already in that state)', () => {
    const clock = createPausableExerciseClock({ wallNowMs: () => 1_000 })
    const listener = vi.fn()
    clock.subscribe(listener)

    clock.resume() // already running — no-op
    expect(listener).not.toHaveBeenCalled()

    clock.freeze()
    expect(listener).toHaveBeenCalledTimes(1)
    clock.freeze() // already frozen — no-op
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops further notifications', () => {
    const clock = createPausableExerciseClock({ wallNowMs: () => 1_000 })
    const listener = vi.fn()
    const unsubscribe = clock.subscribe(listener)

    unsubscribe()
    clock.freeze()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createPausableExerciseClock — independent instances', () => {
  it('each factory call owns its own offset/state (no shared module state)', () => {
    const clockA = createPausableExerciseClock({ wallNowMs: () => 1_000 })
    const clockB = createPausableExerciseClock({ wallNowMs: () => 1_000 })

    clockA.freeze()
    expect(clockA.isFrozen).toBe(true)
    expect(clockB.isFrozen).toBe(false)
  })
})
