/**
 * features/controller/engine/services/autoHoldPolicy.ts
 * ---------------------------------------------------------------------------
 * The load-bearing auto-HOLD decision (feature: engine-review-cockpit, story 01;
 * ADP-040, D5-014/1.1 which supersedes D5-005; E8 architecture §8.2). A
 * FIELD-FOR-FIELD port of `src/Pulse.Core/Features/Autonomy/Services/AutoHoldPolicy.cs`.
 * STAFF world — pure, stateless functions; no UI, no COBRA, no React.
 *
 * It maps a Delayed-auto draft's countdown snapshot + the current safety-adjusted
 * autonomy + the current SCENARIO minute + whether swamped mode is on, to what
 * should happen — with the safety invariant baked in that **silence is never
 * approval**. An expired countdown with no controller decision resolves to
 * `TimeoutDisposition.Hold` ("timer expired — held for you", surfaces in NEEDS
 * YOU), NEVER a silent auto-send.
 *
 * The ONLY path to auto-send on expiry is the explicit, lead-controller-gated
 * swamped mode (story 03) applied to a STILL-effective Delayed-auto draft. Any
 * safety clamp (kill switch / degraded mode) drops the effective level below
 * Delayed-auto or stops the engine, which suspends in-flight countdowns: they
 * hold instead of sending, even under swamped mode. Timers are evaluated in
 * scenario time (COR-050/051).
 *
 * PRECEDENCE (ported exactly — do not reorder):
 *   1. A fully-stopped engine holds everything (kill-switch full stop).
 *   2. An explicit controller decision wins: Approved → Publish; Vetoed → Hold.
 *   3. No decision + not yet expired → AwaitDecision.
 *   4. No decision + expired → Hold, UNLESS swamped mode is on AND the effective
 *      level is still Delayed-auto (the sole auto-send path).
 *
 * Consumed by: story 02's `useDraftTimer` (terminal action on tick) and story
 * 01's `useReviewQueue` (deriving held/pending state for the inline count).
 */

import {
  ControllerDecision,
  TimeoutDisposition,
  AutonomyLevel,
  type DelayedAutoCountdown,
  type EffectiveAutonomy,
} from '../models/reviewContracts'

/**
 * The disposition for a countdown at `currentScenarioMinute`, given the draft's
 * safety-adjusted effective autonomy and whether swamped mode is on. Pure port of
 * `AutoHoldPolicy.Decide`; see the module header for the precedence.
 */
export function decide(
  countdown: DelayedAutoCountdown,
  effective: EffectiveAutonomy,
  currentScenarioMinute: number,
  swampedMode: boolean,
): TimeoutDisposition {
  // A full stop (kill switch) suspends everything outstanding — nothing publishes.
  if (effective.generationStopped) {
    return TimeoutDisposition.Hold
  }

  // Explicit human decisions are the controller's will and are honoured directly.
  // (A full stop, handled above, is the one control that overrides even a standing
  // approval.)
  if (countdown.decision === ControllerDecision.Approved) {
    return TimeoutDisposition.Publish
  }
  if (countdown.decision === ControllerDecision.Vetoed) {
    return TimeoutDisposition.Hold
  }

  if (!countdown.hasExpired(currentScenarioMinute)) {
    return TimeoutDisposition.AwaitDecision
  }

  // Expired with no decision. Silence is never approval → HOLD, unless swamped
  // mode is explicitly on and the draft is still effectively Delayed-auto (a
  // safety clamp having lowered it suspends this).
  const autoSend = swampedMode && effective.level === AutonomyLevel.DelayedAuto
  return autoSend ? TimeoutDisposition.Publish : TimeoutDisposition.Hold
}

/**
 * The transition event to LOG when a countdown reaches a terminal outcome on
 * expiry with no controller decision (the auto-HOLD, or the swamped-mode
 * auto-send) — mirrors the C# `DraftTimeoutResolved`. XC-004 `engine.reviewed`
 * with action `hold-on-expiry` / `auto-send` (ADP-041). Human approve/veto is
 * logged on the review-action path (`reviewActions`), not here.
 */
export interface DraftTimeoutResolved {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly disposition: TimeoutDisposition
  readonly viaSwampedMode: boolean
  readonly scenarioMinute: number
}

/** The result of {@link evaluate} (mirrors the C# `TimeoutEvaluation`). */
export interface TimeoutEvaluation {
  readonly disposition: TimeoutDisposition
  readonly viaSwampedMode: boolean
  /** Non-null ONLY for an on-expiry, no-decision resolution — the event to log. */
  readonly event: DraftTimeoutResolved | null
}

/**
 * Evaluates the countdown and, when it has reached a terminal outcome ON EXPIRY
 * WITH NO controller decision (the auto-HOLD, or the swamped-mode auto-send), also
 * returns the {@link DraftTimeoutResolved} event to log — mirrors
 * `AutoHoldPolicy.Evaluate`. While the countdown is still running, or when the
 * outcome is a human approve/veto (logged on the review-action path), the event is
 * null. The disposition is always returned.
 */
export function evaluate(
  countdown: DelayedAutoCountdown,
  effective: EffectiveAutonomy,
  currentScenarioMinute: number,
  swampedMode: boolean,
): TimeoutEvaluation {
  const disposition = decide(countdown, effective, currentScenarioMinute, swampedMode)

  // Only an on-expiry, no-decision resolution is an autonomy-layer transition to
  // log here.
  const isTimeoutTransition =
    countdown.decision === ControllerDecision.None &&
    !effective.generationStopped &&
    countdown.hasExpired(currentScenarioMinute)

  if (!isTimeoutTransition) {
    return { disposition, viaSwampedMode: false, event: null }
  }

  const viaSwampedMode = disposition === TimeoutDisposition.Publish
  return {
    disposition,
    viaSwampedMode,
    event: {
      exerciseId: countdown.exerciseId,
      storylineId: countdown.storylineId,
      draftId: countdown.draftId,
      disposition,
      viaSwampedMode,
      scenarioMinute: currentScenarioMinute,
    },
  }
}
