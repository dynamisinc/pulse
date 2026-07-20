/**
 * features/controller/engine/services/autoHoldPolicy.test.ts
 * ---------------------------------------------------------------------------
 * The load-bearing safety port (engine-review-cockpit/01; ADP-040, D5-014/1.1).
 * Mirrors the C# `AutoHoldPolicy` test intent: the precedence, and above all the
 * invariant that SILENCE IS NEVER APPROVAL — an expired countdown with no decision
 * holds, never auto-sends, except behind swamped-mode on a still-Delayed-auto draft.
 */
import { describe, expect, it } from 'vitest'
import {
  AutonomyLevel,
  ControllerDecision,
  DelayedAutoCountdown,
  STOPPED_AUTONOMY,
  TimeoutDisposition,
  runningAutonomy,
} from '../models/reviewContracts'
import { decide, evaluate } from './autoHoldPolicy'

const EX = 'ex-mock-0001'
const STORY = 'storyline-1'
const DRAFT = 'draft-1'

function countdown(overrides: Partial<{
  startedScenarioMinute: number
  countdownMinutes: number
  decision: ControllerDecision
}> = {}): DelayedAutoCountdown {
  return new DelayedAutoCountdown({
    exerciseId: EX,
    storylineId: STORY,
    draftId: DRAFT,
    startedScenarioMinute: overrides.startedScenarioMinute ?? 100,
    countdownMinutes: overrides.countdownMinutes ?? 5,
    ...(overrides.decision !== undefined ? { decision: overrides.decision } : {}),
  })
}

const delayedAuto = runningAutonomy(AutonomyLevel.DelayedAuto)

describe('autoHoldPolicy.decide — precedence', () => {
  it('a full stop holds everything, even a standing approval', () => {
    const c = countdown({ decision: ControllerDecision.Approved })
    expect(decide(c, STOPPED_AUTONOMY, 200, true)).toBe(TimeoutDisposition.Hold)
  })

  it('an explicit approval publishes regardless of the countdown', () => {
    const c = countdown({ decision: ControllerDecision.Approved })
    expect(decide(c, delayedAuto, 101, false)).toBe(TimeoutDisposition.Publish)
  })

  it('an explicit veto holds regardless of the countdown', () => {
    const c = countdown({ decision: ControllerDecision.Vetoed })
    expect(decide(c, delayedAuto, 200, true)).toBe(TimeoutDisposition.Hold)
  })

  it('no decision + not yet expired → await decision', () => {
    const c = countdown() // deadline 105
    expect(decide(c, delayedAuto, 104, false)).toBe(TimeoutDisposition.AwaitDecision)
  })

  it('SILENCE IS NEVER APPROVAL: expired + no decision + not swamped → hold', () => {
    const c = countdown() // deadline 105
    expect(decide(c, delayedAuto, 105, false)).toBe(TimeoutDisposition.Hold)
    expect(decide(c, delayedAuto, 999, false)).toBe(TimeoutDisposition.Hold)
  })

  it('swamped mode is the ONLY auto-send: expired + no decision + swamped + Delayed-auto → publish', () => {
    const c = countdown() // deadline 105
    expect(decide(c, delayedAuto, 105, true)).toBe(TimeoutDisposition.Publish)
  })

  it('swamped mode still holds when a safety clamp lowered the level below Delayed-auto', () => {
    const c = countdown()
    const suggest = runningAutonomy(AutonomyLevel.Suggest)
    expect(decide(c, suggest, 200, true)).toBe(TimeoutDisposition.Hold)
  })
})

describe('autoHoldPolicy.evaluate — transition event to log', () => {
  it('emits no event while the countdown is still running', () => {
    const result = evaluate(countdown(), delayedAuto, 104, false)
    expect(result.disposition).toBe(TimeoutDisposition.AwaitDecision)
    expect(result.event).toBeNull()
  })

  it('emits a hold-on-expiry event on expiry with no decision (not swamped)', () => {
    const result = evaluate(countdown(), delayedAuto, 106, false)
    expect(result.disposition).toBe(TimeoutDisposition.Hold)
    expect(result.viaSwampedMode).toBe(false)
    expect(result.event).toMatchObject({
      exerciseId: EX,
      storylineId: STORY,
      draftId: DRAFT,
      disposition: TimeoutDisposition.Hold,
      viaSwampedMode: false,
      scenarioMinute: 106,
    })
  })

  it('emits an auto-send event under swamped mode on expiry', () => {
    const result = evaluate(countdown(), delayedAuto, 106, true)
    expect(result.disposition).toBe(TimeoutDisposition.Publish)
    expect(result.viaSwampedMode).toBe(true)
    expect(result.event?.viaSwampedMode).toBe(true)
  })

  it('emits no event for a human veto (logged on the review-action path)', () => {
    const vetoed = countdown({ decision: ControllerDecision.Vetoed })
    const result = evaluate(vetoed, delayedAuto, 200, false)
    expect(result.disposition).toBe(TimeoutDisposition.Hold)
    expect(result.event).toBeNull()
  })
})

describe('DelayedAutoCountdown — scenario-minute math', () => {
  it('derives the deadline and expiry in scenario minutes', () => {
    const c = countdown({ startedScenarioMinute: 100, countdownMinutes: 5 })
    expect(c.deadlineScenarioMinute).toBe(105)
    expect(c.hasExpired(104)).toBe(false)
    expect(c.hasExpired(105)).toBe(true)
    expect(c.minutesRemaining(102)).toBe(3)
    expect(c.minutesRemaining(200)).toBe(0)
  })

  it('validates its fields (no invalid countdown can exist)', () => {
    const make = (exerciseId: string, countdownMinutes: number) => () =>
      new DelayedAutoCountdown({
        exerciseId,
        storylineId: STORY,
        draftId: DRAFT,
        startedScenarioMinute: 0,
        countdownMinutes,
      })
    expect(make('', 1)).toThrow() // empty exercise id
    expect(make(EX, -1)).toThrow() // negative length
  })
})
