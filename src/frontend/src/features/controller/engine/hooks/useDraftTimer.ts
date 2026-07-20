/**
 * features/controller/engine/hooks/useDraftTimer.ts
 * ---------------------------------------------------------------------------
 * The SAFETY-CRITICAL timed-draft countdown hook (feature: engine-review-cockpit,
 * story 02; ADP-040, ADP-041, D5-014/1.1 which SUPERSEDES D5-005, COR-053,
 * NFR-001, XC-004). STAFF world (Controller Console / COBRA) — a pure-ish,
 * unit-testable hook; no UI, no COBRA import, never on a participant path (XC-002).
 *
 * WHAT IT DOES. Given one Delayed-auto draft's {@link DelayedAutoCountdown}, the
 * storyline's safety-adjusted {@link EffectiveAutonomy}, and whether swamped mode
 * is on, it ticks in SCENARIO time (COR-050/051 — reads the current scenario
 * minute from `scenarioNow()`; a test may inject its own clock) and reports the
 * LIVE disposition + a screen-reader-safe text `label` for the card. When the
 * countdown reaches zero WITH NO controller decision it resolves the terminal
 * outcome — and that outcome is HOLD, never a silent auto-send.
 *
 * SILENCE IS NEVER APPROVAL (the load-bearing invariant). The terminal action on
 * expiry with no decision is HOLD in the default config (`swampedMode === false`).
 * The ONE and ONLY publish-on-expiry path is `swampedMode === true` AND the draft
 * is STILL effectively Delayed-auto AND generation is not stopped — exactly what
 * story 01's `autoHoldPolicy` encodes. This hook DOES NOT re-derive that
 * precedence: it delegates every disposition to `decide()` and every terminal
 * transition to `evaluate()` (the transition helper that wraps `decide()`).
 *
 * IT DOES NOT PUBLISH. Publishing (and holding) belongs to `reviewActions`
 * (`createPost` / `reviewStore`), wired at the integration seam. This hook only
 * SURFACES the terminal disposition — as the returned `disposition` and via a
 * one-shot `onResolve(disposition, event)` callback the integration wires so a
 * default expiry resolves `Hold` and only the swamped path resolves `Publish`.
 *
 * ONE TELEMETRY EVENT PER TRANSITION (ADP-041/§11, XC-004). On the expiry→terminal
 * transition (no decision, expired, engine running) it emits EXACTLY ONE
 * `engine.reviewed` event via the caller-safe `buildAndEmit` — `action:
 * 'hold-on-expiry'` for the auto-HOLD, `action: 'auto-send'` for the swamped
 * auto-send — stamped with the acting controller (COR-018), the storyline, and
 * SCENARIO time. A ref guards against re-emitting on every subsequent tick. A
 * full stop / clamp is NOT a timeout transition (logged on the safety path), so
 * this hook emits nothing for it.
 *
 * A11Y (NFR-001). Disposition/countdown are conveyed by the text `label` (never
 * color alone): `'holds in M:SS'` while counting, `'timer expired — held for you'`
 * once auto-HELD, `'needs review'` otherwise.
 */

import { useEffect, useRef, useState } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import {
  TimeoutDisposition,
  scenarioMinuteOf,
  type DelayedAutoCountdown,
  type EffectiveAutonomy,
} from '../models/reviewContracts'
import { decide, evaluate, type DraftTimeoutResolved } from '../services/autoHoldPolicy'

/** How often (ms) the hook re-reads the scenario clock to keep the countdown live. */
const DEFAULT_TICK_MS = 1000

/** The `action` a timeout-transition `engine.reviewed` event records (ADP-041/§11). */
export type DraftTimerReviewedAction = 'hold-on-expiry' | 'auto-send'

/** Optional inputs — an injectable clock (tests), the resolve wiring, the tick rate. */
export interface UseDraftTimerOptions {
  /**
   * Called ONCE when the countdown resolves a terminal outcome on expiry with no
   * decision (the auto-HOLD, or the swamped auto-send). The integration wires this
   * to `reviewActions` — a `Hold` marks the item HELD, a `Publish` auto-sends. Never
   * fires for a still-running countdown, a human decision, or a full stop / clamp.
   */
  readonly onResolve?: (disposition: TimeoutDisposition, event: DraftTimeoutResolved) => void
  /**
   * The scenario-time clock, for deterministic tests. Defaults to `scenarioNow`
   * (`@/core/clock`) — the single participant/scenario time source (COR-053). Never
   * wall-clock.
   */
  readonly now?: () => Date
  /** Poll interval (ms) on which the scenario clock is re-read. Defaults to 1000. */
  readonly tickMs?: number
}

/** What the timer surfaces to the review card (see the module header). */
export interface UseDraftTimerResult {
  /** The LIVE disposition from `autoHoldPolicy.decide` (Await / Hold / Publish). */
  readonly disposition: TimeoutDisposition
  /** Whole scenario minutes left before expiry (0 once expired) — the NFR-001 by-number read. */
  readonly minutesRemaining: number
  /** Whether the countdown has expired at the current scenario minute. */
  readonly hasExpired: boolean
  /**
   * A screen-reader-safe text label (NFR-001; never color alone). One of:
   *  - `'holds in M:SS'` (e.g. `'holds in 1:30'`) while counting down;
   *  - `'timer expired — held for you'` once auto-HELD on expiry;
   *  - `'needs review'` otherwise (a full stop / clamp / already-decided draft).
   */
  readonly label: string
}

/**
 * Emits the single timeout-transition `engine.reviewed` event (ADP-041/§11,
 * XC-004) — `hold-on-expiry` for the auto-HOLD, `auto-send` for the swamped
 * auto-send. Caller-safe (`buildAndEmit` never throws into the tick).
 */
function emitTimeoutResolved(
  event: DraftTimeoutResolved,
  timeZone: string,
  actingHumanId: string,
  scenarioTimeIso: string,
): void {
  const action: DraftTimerReviewedAction =
    event.disposition === TimeoutDisposition.Publish ? 'auto-send' : 'hold-on-expiry'

  buildAndEmit({
    exerciseId: event.exerciseId,
    eventType: 'engine.reviewed',
    channel: 'system',
    actor: { kind: 'engine', actingHumanId },
    origin: 'engine',
    wallClockTime: wallClockNowIso(),
    scenarioTime: scenarioTimeIso,
    timeZone,
    target: { entityType: 'engine-draft', entityId: event.draftId },
    payload: {
      action,
      storylineId: event.storylineId,
      disposition: event.disposition,
      viaSwampedMode: event.viaSwampedMode,
      scenarioMinute: event.scenarioMinute,
    },
  })
}

/** Formats a remaining-ms value as `M:SS` (ceil, so it never reads `0:00` while counting). */
function formatMmSs(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Maps the live disposition to the NFR-001 text label (see {@link UseDraftTimerResult}). */
function buildLabel(
  disposition: TimeoutDisposition,
  hasExpired: boolean,
  remainingMs: number,
): string {
  if (disposition === TimeoutDisposition.Hold && hasExpired) {
    return 'timer expired — held for you'
  }
  if (disposition === TimeoutDisposition.AwaitDecision) {
    return `holds in ${formatMmSs(remainingMs)}`
  }
  return 'needs review'
}

/**
 * Ticks a Delayed-auto draft's countdown in scenario time, reporting the live
 * disposition + label and resolving the terminal outcome (HOLD by default; the
 * swamped auto-send only via `decide()`). `swampedMode` is an INPUT — story 03
 * supplies it at integration; this hook never imports it (keeps the two files
 * disjoint). See the module header for the full safety contract.
 */
export function useDraftTimer(
  countdown: DelayedAutoCountdown,
  effective: EffectiveAutonomy,
  swampedMode: boolean,
  options: UseDraftTimerOptions = {},
): UseDraftTimerResult {
  const { onResolve, now: nowFn = scenarioNow, tickMs = DEFAULT_TICK_MS } = options

  const { actingHumanId } = useControllerIdentity()
  const { timeZone } = useExerciseContext()

  // The live scenario instant (ms), refreshed on each tick — never wall-clock.
  const [nowMs, setNowMs] = useState<number>(() => nowFn().getTime())
  useEffect(() => {
    const tick = () => {
      const next = nowFn().getTime()
      setNowMs(prev => (prev === next ? prev : next))
    }
    const id = setInterval(tick, tickMs)
    return () => clearInterval(id)
  }, [nowFn, tickMs])

  const currentScenarioMinute = scenarioMinuteOf(nowMs)
  const scenarioTimeIso = new Date(nowMs).toISOString()

  // The LIVE disposition + display reads — delegated to the pure safety policy;
  // the precedence is NEVER re-derived here.
  const disposition = decide(countdown, effective, currentScenarioMinute, swampedMode)
  const hasExpired = countdown.hasExpired(currentScenarioMinute)
  const minutesRemaining = countdown.minutesRemaining(currentScenarioMinute)
  const label = buildLabel(disposition, hasExpired, countdown.remainingMs(nowMs))

  // Guards the one-shot terminal transition: once a given countdown's expiry has
  // resolved, never re-emit/re-resolve on subsequent ticks (even if `onResolve`'s
  // identity changes and re-arms this effect). Keyed on the draft + its deadline
  // so a fresh countdown (re-roll) can resolve anew.
  const resolvedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const evaluation = evaluate(countdown, effective, currentScenarioMinute, swampedMode)
    const event = evaluation.event
    if (!event) return

    const key = `${countdown.draftId}:${countdown.deadlineScenarioMinute}`
    if (resolvedKeyRef.current === key) return
    resolvedKeyRef.current = key

    emitTimeoutResolved(event, timeZone, actingHumanId, scenarioTimeIso)
    onResolve?.(event.disposition, event)
  }, [
    countdown,
    effective,
    currentScenarioMinute,
    swampedMode,
    timeZone,
    actingHumanId,
    scenarioTimeIso,
    onResolve,
  ])

  return { disposition, minutesRemaining, hasExpired, label }
}
