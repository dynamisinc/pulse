/**
 * features/controller/engine/hooks/useSwampedMode.contract.test.tsx
 * ---------------------------------------------------------------------------
 * Two contract-level ACs for the swamped-mode toggle (engine-review-cockpit/03;
 * ADP-040, D5-014/1.1) that the sibling `useSwampedMode.test.tsx` does not
 * exercise:
 *
 *  1. THE ENGINE NEVER SELF-ENABLES. There is no code path — re-renders,
 *     re-subscriptions, or the pure `autoHoldPolicy` engine-side consumer
 *     reading the flag many times over — that flips `swampedMode` without a
 *     human calling the hook's own `setSwampedMode`. This is the autonomy-
 *     escalation invariant the story exists to guarantee.
 *  2. BOOLEAN-SHAPE CONTRACT. The `swampedMode` this hook returns is a plain
 *     `boolean` — exactly the shape story 02's `useDraftTimer` (via
 *     `autoHoldPolicy.decide`/`evaluate`) consumes as an input parameter, with
 *     no wrapper object. Proven by feeding the hook's live value straight into
 *     the real (pure) `autoHoldPolicy` functions.
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity, type ControllerIdentity } from '../../identity/controllerIdentity'
import {
  AutonomyLevel,
  ControllerDecision,
  DelayedAutoCountdown,
  TimeoutDisposition,
  runningAutonomy,
} from '../models/reviewContracts'
import { decide, evaluate } from '../services/autoHoldPolicy'
import { swampedModeStore, useSwampedMode } from './useSwampedMode'

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

function swampedEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.swamped_mode_changed')
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  swampedModeStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

describe('useSwampedMode — the engine never self-enables', () => {
  it('re-rendering the hook many times (no setSwampedMode call) never flips the flag on', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))

    const { result, rerender } = renderHook(() => useSwampedMode())
    expect(result.current.swampedMode).toBe(false)

    for (let i = 0; i < 20; i++) {
      rerender()
    }

    expect(result.current.swampedMode).toBe(false)
    expect(swampedEvents()).toHaveLength(0)
  })

  it('reading the flag from many concurrent hook instances never flips it on', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))

    const readers = Array.from({ length: 5 }, () => renderHook(() => useSwampedMode()))
    for (const reader of readers) {
      expect(reader.result.current.swampedMode).toBe(false)
    }

    expect(swampedModeStore.getSnapshot('ex-mock-0001')).toBe(false)
    expect(swampedEvents()).toHaveLength(0)
  })

  it('the pure engine-side consumer (autoHoldPolicy) reading swampedMode=true never writes it back to the store', () => {
    // Simulate story 02's `useDraftTimer` repeatedly evaluating an expired,
    // no-decision countdown against a swamped-mode-on world. `decide`/`evaluate`
    // are pure — they take `swampedMode` as an INPUT and must never be able to
    // mutate the hook's store (there is no import of `useSwampedMode` from
    // `autoHoldPolicy` at all — verified structurally by the module boundary).
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))
    const { result } = renderHook(() => useSwampedMode())
    expect(result.current.swampedMode).toBe(false)

    const countdown = new DelayedAutoCountdown({
      exerciseId: 'ex-mock-0001',
      storylineId: 'story-1',
      draftId: 'draft-1',
      startedScenarioMinute: 0,
      countdownMinutes: 5,
      decision: ControllerDecision.None,
    })
    const effective = runningAutonomy(AutonomyLevel.DelayedAuto)

    for (let i = 0; i < 10; i++) {
      const disposition = decide(countdown, effective, 100, true)
      expect(disposition).toBe(TimeoutDisposition.Publish)
      const outcome = evaluate(countdown, effective, 100, true)
      expect(outcome.viaSwampedMode).toBe(true)
    }

    // The engine's own read of "as if swamped mode were on" never touched the
    // human-gated store for this exercise — it is still off, exactly as the
    // lead left it.
    expect(result.current.swampedMode).toBe(false)
    expect(swampedModeStore.getSnapshot('ex-mock-0001')).toBe(false)
    expect(swampedEvents()).toHaveLength(0)
  })
})

describe('useSwampedMode — boolean-shape contract with the autoHoldPolicy/useDraftTimer input', () => {
  it('is a plain boolean, both off and on', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))

    const { result } = renderHook(() => useSwampedMode())
    expect(typeof result.current.swampedMode).toBe('boolean')

    act(() => result.current.setSwampedMode(true))
    expect(typeof result.current.swampedMode).toBe('boolean')
    expect(result.current.swampedMode).toBe(true)
  })

  it('feeds directly into autoHoldPolicy.decide/evaluate with no adaptation (the real story 02 input shape)', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))
    const { result } = renderHook(() => useSwampedMode())

    const countdown = new DelayedAutoCountdown({
      exerciseId: 'ex-mock-0001',
      storylineId: 'story-1',
      draftId: 'draft-1',
      startedScenarioMinute: 0,
      countdownMinutes: 5,
      decision: ControllerDecision.None,
    })
    const effective = runningAutonomy(AutonomyLevel.DelayedAuto)

    // Off (default): expired + no decision → HOLD, never a silent publish.
    const offDisposition = decide(countdown, effective, 100, result.current.swampedMode)
    expect(offDisposition).toBe(TimeoutDisposition.Hold)

    act(() => result.current.setSwampedMode(true))

    // On: the same call, same countdown, only the hook's own boolean differs.
    const onDisposition = decide(countdown, effective, 100, result.current.swampedMode)
    expect(onDisposition).toBe(TimeoutDisposition.Publish)
    const outcome = evaluate(countdown, effective, 100, result.current.swampedMode)
    expect(outcome.viaSwampedMode).toBe(true)
    expect(outcome.event?.viaSwampedMode).toBe(true)
  })
})

describe('useSwampedMode — resetForTests isolates per-exercise state across cases', () => {
  it('resetForTests clears every exercise flag so the next case starts clean', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))
    const first = renderHook(() => useSwampedMode())
    act(() => first.result.current.setSwampedMode(true))
    expect(swampedModeStore.getSnapshot('ex-mock-0001')).toBe(true)
    first.unmount()

    swampedModeStore.resetForTests()
    resetTelemetryBuffer()

    const second = renderHook(() => useSwampedMode())
    expect(second.result.current.swampedMode).toBe(false)
    expect(swampedEvents()).toHaveLength(0)
  })
})
