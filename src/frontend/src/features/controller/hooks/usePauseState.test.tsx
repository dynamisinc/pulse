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
 * Story 07 (server-authoritative pause) adds, WITHOUT changing any of the above:
 *  - the ENGINE-tier unification with the #337 kill switch — entering/leaving
 *    the `engine` tier calls `useEngineControl().setMode('stop'|'live')`, and
 *    the tier pill + `<EngineControlBar>` read the SAME `engineControlStore`
 *    snapshot (asserted through the real store, not a mocked hook);
 *  - the live branch (`USE_MOCK_DATA === false`): the optimistic flip, the
 *    `/api/steering/pause-tier` POST, the guarded revert on rejection (and NO
 *    revert once a newer transition has superseded it), and the one-shot resync
 *    GET a freshly mounted console performs;
 *  - mock mode (the default here) fires NO backend call at all — story 03's
 *    behavior is untouched.
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
import { engineControlStore, useEngineControl } from '../engine/hooks/useEngineControl'
import { pausableExerciseClock } from '../services/pausableExerciseClock'
import * as livePauseTierActions from '../services/livePauseTierActions'
import type { PauseTierServerState } from '../services/livePauseTierActions'
import * as liveEngineControlActions from '../engine/services/liveEngineControlActions'
import { resetPauseStateForTest, usePauseState, type PauseTier } from './usePauseState'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))

/**
 * Toggled per-describe-block. Default `true` (mock mode — matches dev/UAT and
 * every story-03 test below). The live-mode block flips it to `false` for its
 * own tests only; the top-level `beforeEach` resets it, so story 03's coverage
 * is unaffected. A GETTER is used so the `USE_MOCK_DATA` import binding in
 * `usePauseState.ts` reads whichever value is current at call time (mirrors
 * `useEngineControl.test.ts`).
 */
let useMockData = true
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return useMockData
  },
}))

// The live pause-tier POST/GET and the shipped kill-switch POST are mocked
// wholesale — never a real network call.
vi.mock('../services/livePauseTierActions', () => ({
  setPauseTier: vi.fn(),
  fetchPauseTier: vi.fn(),
}))
vi.mock('../engine/services/liveEngineControlActions', () => ({
  setMode: vi.fn().mockResolvedValue(undefined),
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
const mockedSetPauseTier = vi.mocked(livePauseTierActions.setPauseTier)
const mockedFetchPauseTier = vi.mocked(livePauseTierActions.fetchPauseTier)
const mockedLiveEngineSetMode = vi.mocked(liveEngineControlActions.setMode)

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

/** The kill switch's own audit events — must stay empty on a server-sourced resync (WR-002). */
function autonomyEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.autonomy_changed')
}

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
  mockedUseControllerIdentity.mockReturnValue(identity())
  resetTelemetryBuffer()
  resetPauseStateForTest()
  engineControlStore.resetForTests()
  // The composed kill switch's live POST resolves unless a test says otherwise.
  mockedLiveEngineSetMode.mockResolvedValue(undefined)
  useMockData = true
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

// ---------------------------------------------------------------------------
// Story 07: ENGINE PAUSED unifies with the #337 kill switch (frontend-only)
// ---------------------------------------------------------------------------

/** Renders the pause hook AND the kill-switch hook, so both read the one store. */
function renderBothSurfaces() {
  return renderHook(() => ({ pause: usePauseState(), engine: useEngineControl() }))
}

/** The server's `{ tier, clockFrozen }` answer, as `livePauseTierActions` parses it. */
function serverState(tier: PauseTier, clockFrozen: boolean): PauseTierServerState {
  return { tier, clockFrozen }
}

/** Flushes the microtask queue so an in-flight promise's handlers run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('usePauseState — ENGINE PAUSED drives the SAME kill switch <EngineControlBar> reads', () => {
  it("entering the engine tier calls setMode('stop') — the tier pill and the control bar agree", () => {
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('engine'))

    expect(result.current.pause.tier).toBe('engine')
    expect(result.current.engine.mode).toBe('stop')
    // Both surfaces read ONE engineControlStore snapshot — the tier pill and
    // <EngineControlBar> can never show contradictory states.
    expect(engineControlStore.getSnapshot('ex-mock-0001').mode).toBe('stop')
  })

  it("leaving the engine tier for Resume calls setMode('live')", () => {
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('engine'))
    act(() => result.current.pause.resume())

    expect(result.current.pause.tier).toBe('running')
    expect(result.current.engine.mode).toBe('live')
    expect(engineControlStore.getSnapshot('ex-mock-0001').mode).toBe('live')
  })

  it('leaving the engine tier for Freeze keeps the engine STOPPED (a stronger pause never restarts it)', () => {
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('engine'))
    act(() => result.current.pause.setTier('freeze'))

    expect(result.current.pause.tier).toBe('freeze')
    expect(result.current.engine.mode).toBe('stop')
  })

  it('engine -> freeze -> Resume restores the engine (never RUNNING over a stuck STOP)', () => {
    // WR-003: the two surfaces must not be able to disagree. Reaching `running`
    // via freeze used to leave the bar at STOP under a pill reading RUNNING.
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('engine'))
    act(() => result.current.pause.setTier('freeze'))
    act(() => result.current.pause.resume())

    expect(result.current.pause.tier).toBe('running')
    expect(result.current.engine.mode).toBe('live')
    expect(engineControlStore.getSnapshot('ex-mock-0001').mode).toBe('live')
  })

  it('Resume restores a manually chosen SUGGEST-ONLY rather than raising to LIVE (§8.2)', () => {
    const { result } = renderBothSurfaces()

    // The controller's own pre-pause choice.
    act(() => result.current.engine.setMode('suggest-only'))
    act(() => result.current.pause.setTier('engine'))
    expect(result.current.engine.mode).toBe('stop')

    act(() => result.current.pause.resume())

    // Restoring 'live' here would be an AUTOMATIC autonomy raise out of a
    // human's deliberate clamp.
    expect(result.current.engine.mode).toBe('suggest-only')
  })

  it('leaving the engine tier for Pause injects restores the engine (injects paused, engine live)', () => {
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('engine'))
    act(() => result.current.pause.setTier('injects'))

    expect(result.current.pause.tier).toBe('injects')
    expect(result.current.engine.mode).toBe('live')
  })

  it('the injects and freeze tiers never touch the kill switch on their own', () => {
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('injects'))
    expect(result.current.engine.mode).toBe('live')

    act(() => result.current.pause.setTier('freeze'))
    expect(result.current.engine.mode).toBe('live')
  })
})

// ---------------------------------------------------------------------------
// Story 07: the live branch (server-authoritative pause)
// ---------------------------------------------------------------------------

describe('usePauseState — mock mode fires NO backend call (story 03 path unchanged)', () => {
  it('never POSTs a tier change and never GETs a resync', () => {
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('injects'))
    act(() => result.current.setTier('freeze'))
    act(() => result.current.resume())

    expect(mockedSetPauseTier).not.toHaveBeenCalled()
    expect(mockedFetchPauseTier).not.toHaveBeenCalled()
  })
})

describe('usePauseState — live mode (server-authoritative; USE_MOCK_DATA=false)', () => {
  beforeEach(() => {
    useMockData = false
    // The server APPLIED whatever was asked of it, unless a test says otherwise.
    mockedSetPauseTier.mockImplementation(tier =>
      Promise.resolve(serverState(tier, tier === 'freeze')),
    )
    mockedFetchPauseTier.mockRejectedValue(new Error('no resync in this test'))
  })

  it('flips the tier optimistically AND POSTs it with the acting human + time zone', () => {
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('freeze'))

    // Optimistic — the console flips immediately, without waiting on the POST.
    expect(result.current.tier).toBe('freeze')
    expect(result.current.isFrozen).toBe(true)
    expect(mockedSetPauseTier).toHaveBeenCalledWith('freeze', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
    // Exactly ONE steering_action, shape unchanged — never duplicated because a
    // live POST also fired.
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.payload).toMatchObject({
      action: 'pause-tier',
      from: 'running',
      to: 'freeze',
    })
  })

  it('POSTs the Resume transition too', () => {
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('freeze'))
    act(() => result.current.resume())

    expect(mockedSetPauseTier).toHaveBeenLastCalledWith('running', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
  })

  it('reverts the optimistic flip when the POST rejects, keeping the telemetry already logged', async () => {
    mockedSetPauseTier.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => usePauseState())

    await act(async () => {
      result.current.setTier('freeze')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.tier).toBe('running')
    expect(result.current.isFrozen).toBe(false)
    // The attempted change is still logged — the emit happens before the POST.
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.payload).toMatchObject({ from: 'running', to: 'freeze' })
  })

  it('does NOT revert when a newer transition has superseded the rejected one', async () => {
    let rejectFirst: ((reason: Error) => void) | undefined
    mockedSetPauseTier
      .mockImplementationOnce(
        () =>
          new Promise<PauseTierServerState>((_resolve, reject) => {
            rejectFirst = reject
          }),
      )
      .mockImplementation(tier => Promise.resolve(serverState(tier, tier === 'freeze')))

    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('injects'))
    // A NEWER transition lands before the first POST's rejection arrives.
    act(() => result.current.setTier('freeze'))

    await act(async () => {
      rejectFirst?.(new Error('network down'))
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('freeze')
    expect(result.current.isFrozen).toBe(true)
  })

  // ---- CR-001: a Freeze the server did not apply must never render as frozen ----

  it('reverts a Freeze the server reports it did NOT apply (clockFrozen: false)', async () => {
    // The endpoint answered 200 with the HONEST truth that the scenario clock is
    // not frozen. WORLD FROZEN must not survive that.
    mockedSetPauseTier.mockResolvedValue(serverState('freeze', false))
    const { result } = renderHook(() => usePauseState())

    await act(async () => {
      result.current.setTier('freeze')
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('running')
    expect(result.current.isFrozen).toBe(false)
    expect(result.current.label).toBe('RUNNING')
  })

  it('reverts a Freeze the server REFUSED (the 409 rejection path)', async () => {
    mockedSetPauseTier.mockRejectedValue(new Error('Request failed with status code 409'))
    const { result } = renderHook(() => usePauseState())

    await act(async () => {
      result.current.setTier('freeze')
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('running')
    expect(result.current.isFrozen).toBe(false)
  })

  it('reverts when the server recorded a DIFFERENT tier than the one requested', async () => {
    mockedSetPauseTier.mockResolvedValue(serverState('running', false))
    const { result } = renderHook(() => usePauseState())

    await act(async () => {
      result.current.setTier('engine')
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('running')
  })

  it('keeps the Freeze when the server confirms the clock IS frozen', async () => {
    mockedSetPauseTier.mockResolvedValue(serverState('freeze', true))
    const { result } = renderHook(() => usePauseState())

    await act(async () => {
      result.current.setTier('freeze')
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('freeze')
    expect(result.current.isFrozen).toBe(true)
    expect(result.current.label).toBe('WORLD FROZEN')
  })

  // ---- CR-002: ENGINE PAUSED cannot outlive a failed kill-switch POST ----

  it('reverts the tier when the KILL-SWITCH POST fails, even though the pause-tier POST succeeded', async () => {
    // The engine tier fires TWO independent requests. When the kill switch is the
    // one that fails, the bar snaps back to LIVE — the pill must not keep reading
    // ENGINE PAUSED over a generating engine (AC3: never contradictory).
    mockedLiveEngineSetMode.mockRejectedValue(new Error('kill switch unreachable'))
    const { result } = renderBothSurfaces()

    await act(async () => {
      result.current.pause.setTier('engine')
      await flushMicrotasks()
    })

    expect(result.current.engine.mode).toBe('live')
    expect(result.current.pause.tier).toBe('running')
    expect(result.current.pause.label).toBe('RUNNING')
    expect(engineControlStore.getSnapshot('ex-mock-0001').mode).toBe('live')
  })

  it('does NOT revert a kill-switch failure once a newer transition has superseded it', async () => {
    let rejectKillSwitch: ((reason: Error) => void) | undefined
    mockedLiveEngineSetMode.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectKillSwitch = reject
        }),
    )
    const { result } = renderBothSurfaces()

    act(() => result.current.pause.setTier('engine'))
    // A NEWER transition lands before the kill switch's rejection arrives.
    act(() => result.current.pause.setTier('freeze'))

    await act(async () => {
      rejectKillSwitch?.(new Error('kill switch unreachable'))
      await flushMicrotasks()
    })

    expect(result.current.pause.tier).toBe('freeze')
  })

  it('reverts the engine kill switch too when the PAUSE-TIER POST rejects', async () => {
    mockedSetPauseTier.mockRejectedValue(new Error('network down'))
    const { result } = renderBothSurfaces()

    await act(async () => {
      result.current.pause.setTier('engine')
      await flushMicrotasks()
    })

    expect(result.current.pause.tier).toBe('running')
    expect(result.current.engine.mode).toBe('live')
  })

  // ---- the one-shot resync ----

  it('resyncs ONCE on mount and adopts the server tier without emitting telemetry or POSTing', async () => {
    mockedFetchPauseTier.mockResolvedValue(serverState('freeze', true))

    const { result } = renderHook(() => usePauseState())
    await act(async () => {
      await flushMicrotasks()
    })

    expect(mockedFetchPauseTier).toHaveBeenCalledTimes(1)
    expect(result.current.tier).toBe('freeze')
    expect(result.current.isFrozen).toBe(true)
    // A resync is not a controller action — the controller who caused it already
    // logged it, so adopting it must not emit a second event or echo a POST.
    expect(steeringEvents()).toHaveLength(0)
    expect(mockedSetPauseTier).not.toHaveBeenCalled()
  })

  it('never adopts a Freeze the server reports as NOT applied', async () => {
    mockedFetchPauseTier.mockResolvedValue(serverState('freeze', false))

    const { result } = renderHook(() => usePauseState())
    await act(async () => {
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('running')
    expect(result.current.isFrozen).toBe(false)
  })

  it('adopting the engine tier reflects the STOP locally with no autonomy telemetry and no kill-switch POST', async () => {
    // WR-002: the stop was some OTHER human's action, already logged by them.
    // Emitting engine.autonomy_changed here would attribute a safety action to
    // this console's acting human for something they never did (COR-018).
    mockedFetchPauseTier.mockResolvedValue(serverState('engine', false))

    const { result } = renderBothSurfaces()
    await act(async () => {
      await flushMicrotasks()
    })

    expect(result.current.pause.tier).toBe('engine')
    expect(result.current.engine.mode).toBe('stop')
    expect(autonomyEvents()).toHaveLength(0)
    expect(steeringEvents()).toHaveLength(0)
    expect(mockedLiveEngineSetMode).not.toHaveBeenCalled()
  })

  it('a resync that lands AFTER the controller acted never overwrites their choice', async () => {
    // WR-001: the adopt path carries the same supersede guard the POST path does.
    let resolveResync: ((state: PauseTierServerState) => void) | undefined
    mockedFetchPauseTier.mockImplementation(
      () =>
        new Promise<PauseTierServerState>(resolve => {
          resolveResync = resolve
        }),
    )

    const { result } = renderHook(() => usePauseState())

    // The controller acts while the GET is still in flight.
    act(() => result.current.setTier('injects'))

    await act(async () => {
      resolveResync?.(serverState('freeze', true))
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('injects')
    expect(result.current.isFrozen).toBe(false)
  })

  it('keeps the local baseline when the resync GET fails (never a guessed tier)', async () => {
    mockedFetchPauseTier.mockRejectedValue(new Error('401'))

    const { result } = renderHook(() => usePauseState())
    await act(async () => {
      await flushMicrotasks()
    })

    expect(result.current.tier).toBe('running')
    expect(steeringEvents()).toHaveLength(0)
  })

  it('resyncs only once across several mounted surfaces', async () => {
    mockedFetchPauseTier.mockResolvedValue(serverState('engine', false))

    const first = renderHook(() => usePauseState())
    const second = renderHook(() => usePauseState())
    await act(async () => {
      await flushMicrotasks()
    })

    expect(mockedFetchPauseTier).toHaveBeenCalledTimes(1)
    expect(first.result.current.tier).toBe('engine')
    expect(second.result.current.tier).toBe('engine')
  })
})
