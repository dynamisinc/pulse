/**
 * features/controller/engine/console/DraftTimerDriver.tsx
 * ---------------------------------------------------------------------------
 * THE SAFETY DEMO — wires story 02's `useDraftTimer` to actually drive one
 * `CountingDown` item's countdown to its terminal outcome (feature:
 * engine-review-cockpit, integration seam; ADP-040, D5-014/1.1). STAFF world
 * — invisible (renders nothing); no COBRA, no participant surface (XC-002).
 *
 * WHY THIS EXISTS. `useDraftTimer` computes the live disposition + fires a
 * one-shot `onResolve` on expiry, but it never touches the store or publishes
 * — that is deliberately this integration seam's job (see that hook's module
 * header). `<ControllerConsole>` mounts exactly one `<DraftTimerDriver>` per
 * `CountingDown` review item so every outstanding countdown is actually
 * ticking and resolving, not just displayed.
 *
 * THE WIRING (do not change this without re-reading `autoHoldPolicy`'s
 * precedence):
 *   - `onResolve(Hold, ...)`    -> `reviewStore.updateDisposition(Held)`. NO
 *     telemetry here — `useDraftTimer` already logged the single
 *     `hold-on-expiry` `engine.reviewed` transition.
 *   - `onResolve(Publish, ...)` -> `reviewActions.autoPublish(item, ctx)` —
 *     publishes the burst (`origin: 'engine'`) WITHOUT re-emitting
 *     `engine.reviewed` (`useDraftTimer` already logged `auto-send`);
 *     `createPost` still emits its own `'post'` event per post.
 *
 * RESULT (verify by reading, not just running): in the DEFAULT config
 * (`swampedMode === false`), an expired timer always resolves Hold — nothing
 * publishes, silence is never approval. Under swamped(lead) mode on a STILL
 * effectively Delayed-auto draft, it auto-sends. A STOP / Suggest-only /
 * degraded engine (via `useEngineControl`) drops `effective.level` below
 * Delayed-auto, so `autoHoldPolicy.decide()` returns Hold even under swamped
 * mode — this component does not special-case that; it is the ALREADY-tested
 * precedence in `autoHoldPolicy`/`useDraftTimer` doing its job with the real
 * `effective` value passed in.
 *
 * `ctx` intentionally omits `scenarioTime` — `autoPublish` needs the SCENARIO
 * instant at the moment of resolution (COR-053), not whenever this component
 * happened to render, so it is read fresh (`scenarioNow()`) inside the
 * `onResolve` callback, exactly as `useReviewQueue`'s `buildContext` does.
 */

import { useCallback } from 'react'
import { scenarioNow } from '@/core/clock'
import {
  DraftDisposition,
  TimeoutDisposition,
  type DelayedAutoCountdown,
  type EffectiveAutonomy,
  type EngineReviewItem,
} from '../models/reviewContracts'
import { autoPublish, type ReviewActionContext } from '../services/reviewActions'
import { reviewStore } from '../services/reviewStore'
import { useDraftTimer } from '../hooks/useDraftTimer'

/**
 * The clock/identity/exercise inputs `autoPublish` needs, minus `scenarioTime`
 * (read fresh at resolve-time — see the module header).
 */
export type DraftTimerDriverContext = Omit<ReviewActionContext, 'scenarioTime'>

export interface DraftTimerDriverProps {
  /** The `CountingDown` review item this driver ticks. */
  readonly item: EngineReviewItem
  /**
   * The item's countdown, REQUIRED here (not read off `item.countdown`, which
   * is nullable on the shared contract) — the caller (`ControllerConsole`)
   * guards this by only mounting a driver for items that both are
   * `CountingDown` AND carry a non-null countdown, so this component never
   * needs a runtime null-guard or an assertion in front of its Hook call.
   */
  readonly countdown: DelayedAutoCountdown
  /** Whether swamped mode is on for this exercise (`useSwampedMode().swampedMode`). */
  readonly swampedMode: boolean
  /** The engine's current safety-adjusted disposition (`useEngineControl().effective`). */
  readonly effective: EffectiveAutonomy
  /** The clock/identity/exercise inputs for a swamped-mode auto-publish. */
  readonly ctx: DraftTimerDriverContext
}

/**
 * Drives one `CountingDown` item's countdown via `useDraftTimer`, wiring its
 * terminal outcome to the review store / publish pipeline. Renders nothing.
 */
export function DraftTimerDriver({
  item,
  countdown,
  swampedMode,
  effective,
  ctx,
}: DraftTimerDriverProps) {
  const onResolve = useCallback(
    (disposition: TimeoutDisposition) => {
      if (disposition === TimeoutDisposition.Hold) {
        reviewStore.updateDisposition(item.draftId, DraftDisposition.Held)
        return
      }
      if (disposition === TimeoutDisposition.Publish) {
        autoPublish(item, { ...ctx, scenarioTime: scenarioNow().toISOString() })
      }
    },
    [item, ctx],
  )

  useDraftTimer(countdown, effective, swampedMode, { onResolve })

  return null
}
