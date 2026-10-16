/**
 * features/controller/engine/hooks/useDraftTimer.delegation.test.ts
 * ---------------------------------------------------------------------------
 * Proves `useDraftTimer` DELEGATES every disposition/transition decision to
 * story 01's `autoHoldPolicy` (`decide` / `evaluate`) rather than re-deriving the
 * safety precedence locally (ADP-040, D5-014/1.1 — see the module header on
 * `useDraftTimer.ts`). `../services/autoHoldPolicy` is mocked wholesale so the
 * hook's OWN logic can never coincidentally match the real policy's output —
 * the returned disposition/label/event must be exactly what the (mocked) policy
 * says, proving there is no parallel safety re-implementation in the hook.
 *
 * Kept in its own file so the policy mock does not shadow the real
 * `autoHoldPolicy` used by the rest of the `useDraftTimer.test.ts` suite.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  AutonomyLevel,
  DelayedAutoCountdown,
  TimeoutDisposition,
  runningAutonomy,
} from '../models/reviewContracts'
import * as autoHoldPolicy from '../services/autoHoldPolicy'
import { useDraftTimer } from './useDraftTimer'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(() => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Test Exercise',
    timeZone: 'America/New_York',
    status: 'active',
  })),
}))

vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(() => ({
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
  })),
}))

// Wholesale mock of the safety policy — a SENTINEL disposition the real policy
// would never return, so a passing assertion can only mean the hook took the
// mock's word for it rather than computing its own answer.
const SENTINEL_DISPOSITION = 'sentinel-disposition-not-a-real-value' as TimeoutDisposition

vi.mock('../services/autoHoldPolicy', () => ({
  decide: vi.fn(),
  evaluate: vi.fn(),
}))

const EX = 'ex-mock-0001'
const STORY = 'storyline-1'
const DRAFT = 'draft-1'

function makeCountdown(): DelayedAutoCountdown {
  return new DelayedAutoCountdown({
    exerciseId: EX,
    storylineId: STORY,
    draftId: DRAFT,
    startedScenarioMinute: 100,
    countdownMinutes: 5,
  })
}

const delayedAuto = runningAutonomy(AutonomyLevel.DelayedAuto)

describe('useDraftTimer — delegates to autoHoldPolicy.decide/evaluate (no re-derived copy)', () => {
  it('returns whatever the (mocked) policy decides, verbatim — the hook computes nothing itself', () => {
    resetTelemetryBuffer()
    vi.mocked(autoHoldPolicy.decide).mockReturnValue(SENTINEL_DISPOSITION)
    vi.mocked(autoHoldPolicy.evaluate).mockReturnValue({
      disposition: SENTINEL_DISPOSITION,
      viaSwampedMode: false,
      event: null,
    })

    const countdown = makeCountdown()
    const swampedMode = false
    const scenarioMinute = 105
    const { result } = renderHook(() =>
      useDraftTimer(countdown, delayedAuto, swampedMode, {
        now: () => new Date(scenarioMinute * 60_000),
      }),
    )

    // The hook's live disposition is EXACTLY the mocked policy's sentinel — proof
    // it reads `decide()`'s return rather than deriving its own value.
    expect(result.current.disposition).toBe(SENTINEL_DISPOSITION)

    // And it called the real policy functions with the real inputs, unmodified.
    expect(autoHoldPolicy.decide).toHaveBeenCalledWith(
      countdown,
      delayedAuto,
      scenarioMinute,
      swampedMode,
    )
    expect(autoHoldPolicy.evaluate).toHaveBeenCalledWith(
      countdown,
      delayedAuto,
      scenarioMinute,
      swampedMode,
    )
  })

  it('emits/resolves only when the (mocked) evaluate returns a transition event — the hook never invents one', () => {
    resetTelemetryBuffer()
    vi.mocked(autoHoldPolicy.decide).mockReturnValue(TimeoutDisposition.Hold)
    vi.mocked(autoHoldPolicy.evaluate).mockReturnValue({
      disposition: TimeoutDisposition.Hold,
      viaSwampedMode: false,
      event: {
        exerciseId: EX,
        storylineId: STORY,
        draftId: DRAFT,
        disposition: TimeoutDisposition.Hold,
        viaSwampedMode: false,
        scenarioMinute: 105,
      },
    })

    const onResolve = vi.fn()
    renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, {
        onResolve,
        now: () => new Date(105 * 60_000),
      }),
    )

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(
      TimeoutDisposition.Hold,
      expect.objectContaining({ draftId: DRAFT, disposition: TimeoutDisposition.Hold }),
    )
    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.reviewed')
    expect(events).toHaveLength(1)
  })

  it('resolves/emits nothing when the (mocked) evaluate reports no transition event', () => {
    resetTelemetryBuffer()
    vi.mocked(autoHoldPolicy.decide).mockReturnValue(TimeoutDisposition.AwaitDecision)
    vi.mocked(autoHoldPolicy.evaluate).mockReturnValue({
      disposition: TimeoutDisposition.AwaitDecision,
      viaSwampedMode: false,
      event: null,
    })

    const onResolve = vi.fn()
    renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, {
        onResolve,
        now: () => new Date(101 * 60_000),
      }),
    )

    expect(onResolve).not.toHaveBeenCalled()
    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.reviewed')
    expect(events).toHaveLength(0)
  })
})
