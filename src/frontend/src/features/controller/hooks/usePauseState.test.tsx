/**
 * features/controller/hooks/usePauseState.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the tiered-pause state machine (world-steering/03; CTL-023,
 * D5-014/1.3, COR-050/053, XC-004, NFR-001):
 *  - defaults to `running` (RUNNING) — untouched baseline;
 *  - each tier pauses the correct scope value (`injects` / `engine` /
 *    `freeze`), one active at a time — selecting a new tier (or Resume)
 *    replaces the prior one;
 *  - the scenario clock stops ONLY on Freeze: `scenarioNow()` holds at a
 *    fixed instant while frozen and resumes with no time lost; under
 *    Pause-injects / Pause-engine, `scenarioNow()` keeps advancing exactly as
 *    when `running` (asserted via the injected wall clock, not real timing);
 *  - the overlay-register selection is exposed as a value + setter;
 *  - every tier change (including back to `running`) emits exactly ONE
 *    `steering_action` telemetry event with the correct actor/target/payload,
 *    scoped to the active exercise (COR-001).
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `useSwampedMode.test.tsx` /
 * `useEngineControl.test.ts`'s hook-mock precedent) so each test controls the
 * exercise scope + identity (which carries the actor role) deterministically.
 * `@/core/clock`'s real `setExerciseClock`/`resetExerciseClock`/`scenarioNow`
 * are used (not mocked) so the pausable-clock installation is exercised
 * end-to-end, with a controllable wall-clock source substituted underneath.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getExerciseClock, resetExerciseClock, scenarioNow } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity, type ControllerIdentity } from '../identity/controllerIdentity'
import { pausableExerciseClock } from '../services/pausableExerciseClock'
import { resetPauseStateForTest, usePauseState } from './usePauseState'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))
// The real telemetry sink fire-and-forgets a POST through the shared axios
// client; with no backend that rejects ASYNCHRONOUSLY and logs during teardown
// (a vitest "onUserConsoleLog while closing rpc" worker race). Resolve the POST
// so emission stays synchronous — mirrors `core/telemetry/mockSink.test.ts`.
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'America/New_York', status: 'active' }
}

function identity(overrides: Partial<ControllerIdentity> = {}): ControllerIdentity {
  return {
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
    ...overrides,
  }
}

function steeringEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'steering_action')
}

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
  mockedUseControllerIdentity.mockReturnValue(identity())
  resetTelemetryBuffer()
  resetPauseStateForTest()
})

afterEach(() => {
  resetPauseStateForTest()
  resetExerciseClock()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('usePauseState — default state', () => {
  it('defaults to running (RUNNING), unpaused, unfrozen', () => {
    const { result } = renderHook(() => usePauseState())

    expect(result.current.tier).toBe('running')
    expect(result.current.label).toBe('RUNNING')
    expect(result.current.isPaused).toBe(false)
    expect(result.current.isFrozen).toBe(false)
  })
})

describe('usePauseState — tier transitions (one active at a time)', () => {
  it('selecting Pause injects sets tier=injects, label=INJECTS PAUSED', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('injects'))

    expect(result.current.tier).toBe('injects')
    expect(result.current.label).toBe('INJECTS PAUSED')
    expect(result.current.isPaused).toBe(true)
    expect(result.current.isFrozen).toBe(false)
  })

  it('selecting Pause engine sets tier=engine, label=ENGINE PAUSED', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('engine'))

    expect(result.current.tier).toBe('engine')
    expect(result.current.label).toBe('ENGINE PAUSED')
    expect(result.current.isPaused).toBe(true)
    expect(result.current.isFrozen).toBe(false)
  })

  it('selecting Freeze sets tier=freeze, label=WORLD FROZEN, isFrozen=true', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))

    expect(result.current.tier).toBe('freeze')
    expect(result.current.label).toBe('WORLD FROZEN')
    expect(result.current.isPaused).toBe(true)
    expect(result.current.isFrozen).toBe(true)
  })

  it('selecting a new tier replaces the prior one (only one active at a time)', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('injects'))
    expect(result.current.tier).toBe('injects')

    act(() => result.current.setTier('engine'))
    expect(result.current.tier).toBe('engine')
    expect(result.current.isFrozen).toBe(false)

    act(() => result.current.setTier('freeze'))
    expect(result.current.tier).toBe('freeze')
    expect(result.current.isFrozen).toBe(true)
  })

  it('resume()/setTier("running") returns to the unpaused baseline', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))
    act(() => result.current.resume())

    expect(result.current.tier).toBe('running')
    expect(result.current.label).toBe('RUNNING')
    expect(result.current.isPaused).toBe(false)
    expect(result.current.isFrozen).toBe(false)
  })

  it('setTier to the already-active tier is a no-op — no transition, no telemetry', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('injects'))
    resetTelemetryBuffer()

    act(() => result.current.setTier('injects'))
    expect(result.current.tier).toBe('injects')
    expect(steeringEvents()).toHaveLength(0)
  })
})

describe('usePauseState — clock safety: stops ONLY on Freeze (COR-050/053)', () => {
  // The load-bearing offset math (hold-across-time, resume-loses-nothing) is
  // proven deterministically — via an injected wall clock, not real timing —
  // in `pausableExerciseClock.test.ts`. This block proves the HOOK wires
  // Freeze/Resume through to that exact shared clock (and never touches it
  // for the other two tiers), by spying on the singleton's own methods rather
  // than on `Date.now` — `pausableExerciseClock.freeze()`/`.resume()` are
  // looked up on the live shared object at call time, so a `vi.spyOn` on the
  // singleton observes every call `usePauseState` makes, with no dependence
  // on real elapsed wall-clock time.

  it('Freeze installs the shared pausable clock and calls freeze() on it exactly once', () => {
    const freezeSpy = vi.spyOn(pausableExerciseClock, 'freeze')
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('freeze'))

    expect(freezeSpy).toHaveBeenCalledTimes(1)
    expect(getExerciseClock()).toBe(pausableExerciseClock)
    expect(result.current.isFrozen).toBe(true)
  })

  it('Freeze holds scenarioNow() at a fixed instant across repeated reads', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))

    const first = scenarioNow().getTime()
    const second = scenarioNow().getTime()
    const third = scenarioNow().getTime()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('Resume calls resume() on the SAME installed clock exactly once (frozen span folds into the offset)', () => {
    const resumeSpy = vi.spyOn(pausableExerciseClock, 'resume')
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('freeze'))
    act(() => result.current.resume())

    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(result.current.isFrozen).toBe(false)
    // Resume does NOT reset to the wall-mirroring default clock — that would
    // discard the accumulated offset and jump scenario time forward by the
    // frozen span. The pausable clock stays installed.
    expect(getExerciseClock()).toBe(pausableExerciseClock)
  })

  it('Pause injects never calls freeze() — scenarioNow() stays on the untouched default clock', () => {
    const freezeSpy = vi.spyOn(pausableExerciseClock, 'freeze')
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('injects'))

    expect(freezeSpy).not.toHaveBeenCalled()
    expect(getExerciseClock()).not.toBe(pausableExerciseClock)
    expect(result.current.isFrozen).toBe(false)
  })

  it('Pause engine never calls freeze() — scenarioNow() stays on the untouched default clock', () => {
    const freezeSpy = vi.spyOn(pausableExerciseClock, 'freeze')
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('engine'))

    expect(freezeSpy).not.toHaveBeenCalled()
    expect(getExerciseClock()).not.toBe(pausableExerciseClock)
    expect(result.current.isFrozen).toBe(false)
  })
})

describe('usePauseState — overlay register (seam value only)', () => {
  it('defaults to out-of-fiction and is settable', () => {
    const { result } = renderHook(() => usePauseState())
    expect(result.current.overlayRegister).toBe('out-of-fiction')

    act(() => result.current.setOverlayRegister('in-fiction'))
    expect(result.current.overlayRegister).toBe('in-fiction')
  })
})

describe('usePauseState — telemetry (XC-004)', () => {
  it('emits exactly one steering_action event per tier change, with actor/target/payload', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ actingHumanId: 'human-lead-1' }))

    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('injects'))

    const events = steeringEvents()
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event?.channel).toBe('system')
    expect(event?.actor).toEqual({ kind: 'system', actingHumanId: 'human-lead-1', role: 'controller' })
    expect(event?.target).toEqual({ entityType: 'exercise', entityId: 'ex-mock-0001' })
    expect(event?.payload).toMatchObject({ action: 'pause-tier', from: 'running', to: 'injects' })
    expect(event?.exerciseId).toBe('ex-mock-0001')
  })

  it('emits one event for the transition back to running (not zero)', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))
    resetTelemetryBuffer()

    act(() => result.current.resume())

    const events = steeringEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ action: 'pause-tier', from: 'freeze', to: 'running' })
  })

  it('each of a sequence of tier changes emits exactly one event apiece (no duplicates)', () => {
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('injects'))
    act(() => result.current.setTier('engine'))
    act(() => result.current.setTier('freeze'))
    act(() => result.current.resume())

    expect(steeringEvents()).toHaveLength(4)
    expect(steeringEvents().map(e => e.payload)).toEqual([
      expect.objectContaining({ from: 'running', to: 'injects' }),
      expect.objectContaining({ from: 'injects', to: 'engine' }),
      expect.objectContaining({ from: 'engine', to: 'freeze' }),
      expect.objectContaining({ from: 'freeze', to: 'running' }),
    ])
  })
})

describe('usePauseState — per-exercise scoping (COR-001, stamping-only)', () => {
  it('a different exercise stamps its own exerciseId on the telemetry event', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-bravo'))
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('injects'))

    const events = steeringEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.exerciseId).toBe('ex-bravo')
    expect(events[0]?.target).toEqual({ entityType: 'exercise', entityId: 'ex-bravo' })
  })
})
