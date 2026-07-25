/**
 * features/controller/engine/hooks/useEngineControl.test.ts
 * ---------------------------------------------------------------------------
 * Covers the integration seam's ADP-042 kill switch + degraded-mode mock hook:
 *  - defaults to Live / healthy, effective = runningAutonomy(DelayedAuto);
 *  - the kill switch's Suggest-only / STOP positions resolve the exact
 *    `EffectiveAutonomy` the spec pins down, and log ONE telemetry event per
 *    actual mode change;
 *  - the automatic degraded clamp lowers `effective` to Suggest regardless of
 *    `mode` (unless already STOPped, which wins) — mirroring
 *    `EngineAutonomyState.ResolveEffective`'s "stopped checked first" order —
 *    and `restore()` is the ONLY way to lift it, never automatic;
 *  - per-exercise scoping (COR-001): a different exercise never observes
 *    another exercise's kill-switch/degraded state;
 *  - MOCK <-> LIVE (UAT engine-pause fix): under `USE_MOCK_DATA` (the default
 *    here, matching dev/test), `setMode` never reaches the live backend
 *    action; toggled to live (a dedicated describe block below), it ALSO
 *    calls `liveEngineControlActions.setMode` with the mode + acting
 *    human/time zone, and reverts the optimistic flip on a rejected POST.
 *    The `engine.autonomy_changed` telemetry emit happens in BOTH modes,
 *    unconditionally — the backend kill-switch/restore endpoints mutate
 *    in-memory state but emit no telemetry of their own, so this frontend
 *    emit is the only audit trail (it is logged before the POST fires, so it
 *    still stands even if the POST later rejects and the optimistic flip is
 *    reverted).
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `useSwampedMode.test.tsx`).
 * `@/core/config/mockData` is mocked via a GETTER so the same test file can
 * toggle `USE_MOCK_DATA` between describe blocks (default `true`; the
 * live-mode block below flips it to `false` for its own tests only) — the
 * getter is read fresh on every access, so `useEngineControl.ts`'s live
 * `USE_MOCK_DATA` import binding reflects whichever value is current when
 * `setMode` actually runs. `../services/liveEngineControlActions` is mocked
 * wholesale (never a real network call).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  AutonomyLevel,
  STOPPED_AUTONOMY,
  runningAutonomy,
} from '../models/reviewContracts'
import { useControllerIdentity, type ControllerIdentity } from '../../identity/controllerIdentity'
import * as liveEngineControlActions from '../services/liveEngineControlActions'
import { engineControlStore, useEngineControl } from './useEngineControl'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))

/**
 * Toggled per-describe-block. Default `true` (mock mode — matches dev/UAT and
 * every pre-existing test below). The live-mode describe block flips this to
 * `false` for its own tests via a `beforeEach`; the top-level `beforeEach`
 * resets it to `true` before every test so mock-mode coverage is unaffected.
 */
let useMockData = true
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return useMockData
  },
}))

vi.mock('../services/liveEngineControlActions', () => ({
  setMode: vi.fn(),
}))

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)
const mockedLiveSetMode = vi.mocked(liveEngineControlActions.setMode)

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

function autonomyEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.autonomy_changed')
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  engineControlStore.resetForTests()
  resetTelemetryBuffer()
  mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
  mockedUseControllerIdentity.mockReturnValue(identity())
  useMockData = true
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

describe('useEngineControl — default state', () => {
  it('defaults to Live, healthy, effective = running Delayed-auto', () => {
    const { result } = renderHook(() => useEngineControl())

    expect(result.current.mode).toBe('live')
    expect(result.current.degraded).toBe(false)
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.DelayedAuto))
  })

  it('modeSettledCount defaults to 0 and never changes under mock mode (there is no live POST to settle)', () => {
    const { result } = renderHook(() => useEngineControl())
    expect(result.current.modeSettledCount).toBe(0)

    act(() => result.current.setMode('suggest-only'))
    act(() => result.current.setMode('stop'))
    act(() => result.current.setMode('live'))

    expect(result.current.modeSettledCount).toBe(0)
  })
})

describe('useEngineControl — kill switch (ADP-042)', () => {
  it('Suggest-only resolves effective = runningAutonomy(Suggest) and logs one event', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('suggest-only'))

    expect(result.current.mode).toBe('suggest-only')
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.Suggest))
    expect(autonomyEvents()).toHaveLength(1)
    expect(autonomyEvents()[0]?.payload).toMatchObject({ cause: 'kill-switch', mode: 'suggest-only' })
    expect(autonomyEvents()[0]?.actor).toEqual({ kind: 'engine', actingHumanId: 'human-controller-01' })
  })

  it('STOP resolves effective = STOPPED_AUTONOMY (full stop)', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('stop'))

    expect(result.current.effective).toEqual(STOPPED_AUTONOMY)
    expect(result.current.effective.generationStopped).toBe(true)
  })

  it('is a no-op (no state change, no telemetry) when set to its current mode', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('live'))

    expect(result.current.mode).toBe('live')
    expect(autonomyEvents()).toHaveLength(0)
  })

  it('a human can always raise back to Live — the engine never self-raises (nothing here can call setMode but a human)', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('stop'))
    act(() => result.current.setMode('live'))

    expect(result.current.mode).toBe('live')
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.DelayedAuto))
    expect(autonomyEvents()).toHaveLength(2)
  })

  it('mock mode never fires the live backend action (fires NO backend POST)', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('suggest-only'))
    act(() => result.current.setMode('stop'))
    act(() => result.current.setMode('live'))

    expect(mockedLiveSetMode).not.toHaveBeenCalled()
  })
})

describe('useEngineControl — degraded-mode clamp (automatic, safety-only-clamps-down)', () => {
  it('degrade() clamps effective to Suggest even while mode is Live, and logs one event', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.degrade('provider timeout'))

    expect(result.current.mode).toBe('live') // mode itself is untouched
    expect(result.current.degraded).toBe(true)
    expect(result.current.degradedReason).toBe('provider timeout')
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.Suggest))
    expect(autonomyEvents()).toHaveLength(1)
    expect(autonomyEvents()[0]?.payload).toMatchObject({ cause: 'degraded-mode' })
  })

  it('a full stop still wins over a degraded clamp (stopped is checked first)', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('stop'))
    act(() => result.current.degrade('provider timeout'))

    expect(result.current.effective).toEqual(STOPPED_AUTONOMY)
  })

  it('restore() is the ONLY way to lift the degraded clamp — never automatic', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.degrade('provider timeout'))
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.Suggest))

    act(() => result.current.restore())
    expect(result.current.degraded).toBe(false)
    expect(result.current.degradedReason).toBeNull()
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.DelayedAuto))
    expect(autonomyEvents()).toHaveLength(2)
    expect(autonomyEvents()[1]?.payload).toMatchObject({ cause: 'restore' })
  })

  it('restore() is a no-op when already healthy', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.restore())

    expect(autonomyEvents()).toHaveLength(0)
  })
})

describe('useEngineControl — per-exercise scoping (COR-001)', () => {
  it('a different exercise never observes another exercise\'s kill-switch state', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-alpha'))
    const alpha = renderHook(() => useEngineControl())
    act(() => alpha.result.current.setMode('stop'))
    expect(alpha.result.current.mode).toBe('stop')
    alpha.unmount()

    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-bravo'))
    const bravo = renderHook(() => useEngineControl())
    expect(bravo.result.current.mode).toBe('live')
  })
})

describe('useEngineControl — live mode (UAT engine-pause fix; USE_MOCK_DATA=false)', () => {
  beforeEach(() => {
    useMockData = false
  })

  it("setMode('stop') calls the live action with the mode + acting human/time zone, optimistically flips the store, and STILL emits the audit telemetry (the backend endpoint emits none of its own)", () => {
    mockedLiveSetMode.mockResolvedValue(undefined)
    const { result } = renderHook(() => useEngineControl())

    act(() => result.current.setMode('stop'))

    // Optimistic — the store flips immediately, without waiting on the POST.
    expect(result.current.mode).toBe('stop')
    expect(result.current.effective).toEqual(STOPPED_AUTONOMY)
    expect(mockedLiveSetMode).toHaveBeenCalledWith('stop', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
    // The frontend emit is the ONLY audit trail — the backend endpoint mutates
    // in-memory state but emits no telemetry of its own.
    expect(autonomyEvents()).toHaveLength(1)
    expect(autonomyEvents()[0]?.payload).toMatchObject({ cause: 'kill-switch', mode: 'stop' })
  })

  it("setMode('suggest-only') calls the live action with the right mode and emits telemetry", () => {
    mockedLiveSetMode.mockResolvedValue(undefined)
    const { result } = renderHook(() => useEngineControl())

    act(() => result.current.setMode('suggest-only'))

    expect(result.current.mode).toBe('suggest-only')
    expect(mockedLiveSetMode).toHaveBeenCalledWith('suggest-only', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
    expect(autonomyEvents()).toHaveLength(1)
    expect(autonomyEvents()[0]?.payload).toMatchObject({ cause: 'kill-switch', mode: 'suggest-only' })
  })

  it('reverts the optimistic flip to the prior mode when the live POST rejects, but keeps the telemetry already logged for the attempted change', async () => {
    mockedLiveSetMode.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useEngineControl())

    await act(async () => {
      result.current.setMode('stop')
      // Flush the microtask queue so the rejected promise's `.catch` runs.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.mode).toBe('live')
    expect(result.current.effective).toEqual(runningAutonomy(AutonomyLevel.DelayedAuto))
    // The attempted change was still logged — the emit happens before the
    // POST fires, so a later rejection/revert does not erase the audit trail.
    expect(autonomyEvents()).toHaveLength(1)
    expect(autonomyEvents()[0]?.payload).toMatchObject({ cause: 'kill-switch', mode: 'stop' })
  })

  it('is a no-op (no telemetry, no live POST) when set to its current mode', () => {
    const { result } = renderHook(() => useEngineControl())
    act(() => result.current.setMode('live'))

    expect(result.current.mode).toBe('live')
    expect(mockedLiveSetMode).not.toHaveBeenCalled()
    expect(autonomyEvents()).toHaveLength(0)
  })

  it('invokes the optional onRejected callback after reverting, so a composing caller can undo coupled state', async () => {
    // world-steering/07: `usePauseState` uses this to drop its ENGINE PAUSED tier
    // when the kill-switch POST fails — the two surfaces must never disagree.
    mockedLiveSetMode.mockRejectedValue(new Error('network down'))
    const onRejected = vi.fn()
    const { result } = renderHook(() => useEngineControl())

    await act(async () => {
      result.current.setMode('stop', { onRejected })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.mode).toBe('live')
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('never invokes onRejected when the live POST succeeds', async () => {
    mockedLiveSetMode.mockResolvedValue(undefined)
    const onRejected = vi.fn()
    const { result } = renderHook(() => useEngineControl())

    await act(async () => {
      result.current.setMode('stop', { onRejected })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.mode).toBe('stop')
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('a throwing onRejected can never break the kill switch\'s own revert', async () => {
    mockedLiveSetMode.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useEngineControl())

    await act(async () => {
      result.current.setMode('stop', {
        onRejected: () => {
          throw new Error('composing caller exploded')
        },
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.mode).toBe('live')
  })

  // -----------------------------------------------------------------------
  // `modeSettledCount` (autonomy-safety story 06, Gate-1 CR-101) — the
  // settle SIGNAL `<EngineControlBar>` watches (instead of racing the
  // optimistic `mode` flip) to know when it's safe to refetch engine
  // settings without beating the kill-switch POST to the read.
  // -----------------------------------------------------------------------

  it('modeSettledCount bumps AFTER the optimistic flip, once the live POST resolves — not in the same synchronous call as the flip', async () => {
    let resolveLive: () => void = () => {}
    mockedLiveSetMode.mockReturnValue(new Promise(resolve => { resolveLive = resolve }))
    const { result } = renderHook(() => useEngineControl())

    act(() => result.current.setMode('stop'))

    // The optimistic flip already happened; the settle signal has NOT yet —
    // the POST is still in flight.
    expect(result.current.mode).toBe('stop')
    expect(result.current.modeSettledCount).toBe(0)

    await act(async () => {
      resolveLive()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.modeSettledCount).toBe(1)
  })

  it('modeSettledCount ALSO bumps on a rejected POST — a settlement either way is a valid refetch trigger', async () => {
    mockedLiveSetMode.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useEngineControl())

    await act(async () => {
      result.current.setMode('stop')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.mode).toBe('live') // reverted
    expect(result.current.modeSettledCount).toBe(1)
  })

  it('modeSettledCount bumps once per settle, across repeated flips', async () => {
    mockedLiveSetMode.mockResolvedValue(undefined)
    const { result } = renderHook(() => useEngineControl())

    await act(async () => {
      result.current.setMode('stop')
      await Promise.resolve()
    })
    await act(async () => {
      result.current.setMode('live')
      await Promise.resolve()
    })

    expect(result.current.modeSettledCount).toBe(2)
  })
})

describe('engineControlStore.adoptServerMode — a SILENT local adopt (no telemetry, no POST)', () => {
  it('reflects a server-reported mode locally without emitting an autonomy event or POSTing', () => {
    // world-steering/07 WR-002: a resync learns the engine is already stopped
    // because ANOTHER human stopped it. Emitting engine.autonomy_changed here
    // would attribute a safety action to whoever happens to be watching this
    // console (COR-018/XC-004 accuracy); re-POSTing would echo a command nobody
    // issued.
    const { result } = renderHook(() => useEngineControl())

    act(() => engineControlStore.adoptServerMode('ex-mock-0001', 'stop'))

    expect(result.current.mode).toBe('stop')
    expect(engineControlStore.getSnapshot('ex-mock-0001').mode).toBe('stop')
    expect(autonomyEvents()).toHaveLength(0)
    expect(mockedLiveSetMode).not.toHaveBeenCalled()
  })

  it('is a no-op when the adopted mode already matches', () => {
    const { result } = renderHook(() => useEngineControl())

    act(() => engineControlStore.adoptServerMode('ex-mock-0001', 'live'))

    expect(result.current.mode).toBe('live')
    expect(autonomyEvents()).toHaveLength(0)
  })

  it('adopts per exercise — never leaking into another exercise (COR-001)', () => {
    engineControlStore.adoptServerMode('ex-alpha', 'stop')

    expect(engineControlStore.getSnapshot('ex-alpha').mode).toBe('stop')
    expect(engineControlStore.getSnapshot('ex-bravo').mode).toBe('live')
  })
})
