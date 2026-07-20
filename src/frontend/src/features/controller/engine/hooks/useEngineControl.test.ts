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
 *    another exercise's kill-switch/degraded state.
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `useSwampedMode.test.tsx`).
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
import { engineControlStore, useEngineControl } from './useEngineControl'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
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

function autonomyEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.autonomy_changed')
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  engineControlStore.resetForTests()
  resetTelemetryBuffer()
  mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
  mockedUseControllerIdentity.mockReturnValue(identity())
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
