/**
 * features/controller/engine/hooks/useDemandMeter.ts
 * ---------------------------------------------------------------------------
 * The CTL-034 controller-workload / "queue pressure" mock hook (feature:
 * engine-review-cockpit, integration seam; D5-014/2.7, E8 architecture §8.5).
 * STAFF world — pure hook, no UI, no COBRA.
 *
 * A mirror, in spirit, of the FROZEN
 * `Pulse.Core/Features/Autonomy/Services/WorkloadDemandMeter.cs`: it counts
 * the review DECISIONS the engine demands of the operating controller —
 * approve / edit / veto / re-roll, one per burst, including each item inside
 * a batch approve — over a rolling SCENARIO-minute window (COR-050/051), and
 * flags when that sustained demand exceeds the budget of 6/min (`BudgetPerMinute`
 * in the C# source; `IsOverBudget` is strictly `> 6`, so a rate exactly at 6 is
 * within budget — ported verbatim here).
 *
 * THIS IS A DEMAND METER, NEVER A CONTROLLER-PERFORMANCE MEASURE (D5-014/2.7
 * — forbids surfacing it as surveillance). It measures what the engine's
 * design PUSHES onto the human; a reading past budget flags that the ENGINE is
 * generating too much demand, not that the controller is slow. `<EngineControlBar>`
 * renders this with a tooltip stating exactly that.
 *
 * NON-INVASIVE SOURCE (does not reimplement `reviewActions`/`ReviewQueue`,
 * per the integration spec's "consume, don't duplicate" guardrail). Every
 * controller review decision already emits exactly ONE `engine.reviewed`
 * telemetry event with `action: 'approve' | 'edit' | 'veto' | 're-roll'`
 * (`reviewActions.ts`) — DISTINCT from `useDraftTimer`'s own
 * `'hold-on-expiry' | 'auto-send'` actions, which are system/timer transitions,
 * not a controller decision, and must NOT count as demand. This hook polls the
 * telemetry mock sink's bounded buffer (`@/core/telemetry`) for exactly that
 * action set, scoped to THIS exercise + THIS controller, rather than wiring a
 * side-channel into the review actions themselves. A monotonic "already
 * scanned" cursor (`getTelemetryHealth().emitted`) means each event is
 * counted exactly once even though the buffer itself is capped (NFR-007).
 *
 * SCENARIO TIME (COR-050/051). The rolling window is scenario-minute based —
 * a freeze accrues no phantom demand, a time-jump doesn't dilute the rate —
 * exactly like the C# meter.
 */

import { useEffect, useRef, useState } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, getTelemetryHealth } from '@/core/telemetry'
import { scenarioMinuteOf } from '../models/reviewContracts'
import { useControllerIdentity } from '../../identity/controllerIdentity'

/** The CTL-034 budget — sustained demand must stay at or below this many decisions/minute. */
export const DEMAND_BUDGET_PER_MINUTE = 6

/** The rolling window, in scenario minutes (mirrors the C# `DefaultWindowMinutes`). */
const WINDOW_MINUTES = 1

/** How often (ms) the hook re-scans the telemetry buffer + re-reads the scenario clock. */
const POLL_MS = 1000

/** The `engine.reviewed` actions that count as controller-demanded review decisions. */
const DEMAND_ACTIONS = new Set(['approve', 'edit', 'veto', 're-roll'])

/** The surface `<EngineControlBar>` binds to. */
export interface UseDemandMeterResult {
  /** Decisions demanded of this controller inside the rolling scenario-minute window. */
  readonly demand: number
  /** The CTL-034 budget (6/min). */
  readonly budget: number
  /** Whether sustained demand strictly exceeds the budget (amber, D5-014/2.7). */
  readonly overBudget: boolean
}

/**
 * The per-controller, per-exercise CTL-034 demand meter. See the module
 * header for the full contract.
 */
export function useDemandMeter(): UseDemandMeterResult {
  const { exerciseId } = useExerciseContext()
  const { actingHumanId } = useControllerIdentity()

  // Scenario minutes at which a demand event was recorded (mirrors the C#
  // meter's retained `DemandEvent` list) — module-lifetime for this hook
  // instance; a fresh mount (e.g. a new exercise) starts empty. Mutated AND
  // read only from inside the effect below (never during render — reading a
  // ref's `.current` while rendering is unsafe/lint-forbidden, since React
  // gives no guarantee the render observing it is the one that "counts").
  const demandMinutesRef = useRef<number[]>([])
  const lastEmittedCountRef = useRef(0)

  // The windowed count is derived INSIDE the effect (see `scan` below) and
  // published via `setDemand`, so render only ever reads plain state — never
  // the ref. A same-value `setDemand` correctly bails React out of a
  // redundant re-render (there's nothing new to show), unlike a naive
  // "re-render on every poll" counter would need to.
  const [demand, setDemand] = useState(0)

  useEffect(() => {
    const scan = () => {
      const health = getTelemetryHealth()
      const delta = health.emitted - lastEmittedCountRef.current
      lastEmittedCountRef.current = health.emitted

      if (delta > 0) {
        const buffered = getEmittedTelemetryEvents()
        // Only the most recently emitted `delta` events are new since the last
        // scan (the buffer is capped, so under sustained overflow a very large
        // delta could under-count — acceptable for this Phase-1 mock meter).
        const recent = buffered.slice(Math.max(0, buffered.length - delta))
        for (const event of recent) {
          if (event.eventType !== 'engine.reviewed') continue
          if (event.exerciseId !== exerciseId) continue
          if (event.actor.actingHumanId !== actingHumanId) continue
          const action = event.payload?.['action']
          if (typeof action !== 'string' || !DEMAND_ACTIONS.has(action)) continue
          demandMinutesRef.current.push(scenarioMinuteOf(new Date(event.scenarioTime).getTime()))
        }
      }

      const nowMinute = scenarioMinuteOf(scenarioNow().getTime())
      const lowerExclusive = nowMinute - WINDOW_MINUTES
      setDemand(
        demandMinutesRef.current.filter(minute => minute > lowerExclusive && minute <= nowMinute)
          .length,
      )
    }

    scan()
    const id = setInterval(scan, POLL_MS)
    return () => clearInterval(id)
  }, [exerciseId, actingHumanId])

  return {
    demand,
    budget: DEMAND_BUDGET_PER_MINUTE,
    overBudget: demand > DEMAND_BUDGET_PER_MINUTE,
  }
}
