/**
 * features/controller/engine/hooks/useReviewQueue.ts
 * ---------------------------------------------------------------------------
 * The review-queue read + action hook (feature: engine-review-cockpit, story 01;
 * ADP-040, D5-014/2.1, COR-001/018, COR-053, XC-004, NFR-001). STAFF world — pure
 * hook, no UI, no COBRA.
 *
 * Subscribes `<ReviewQueue>` to the mock `reviewStore` (a `useSyncExternalStore`
 * read of its stable snapshot), keeps a once-per-second SCENARIO-time tick so the
 * "holds in M:SS" countdown + the sub-60s count stay live, and exposes the four
 * per-item actions + batch approve — each wrapped with the clock/identity/exercise
 * INPUTS (`useControllerIdentity()` + `useExerciseContext()` + `scenarioNow()`)
 * that `reviewActions` needs, mirroring how `useComposeAsPersona` assembles them
 * for `composeAsPersona`.
 *
 * THE SINGLE COUNT SOURCE (D5-014/2.1). `pendingCount` / `heldCount` /
 * `timersUnder60sCount` derived here are the ONE source of truth for the inline
 * "N need review / N timers <60s" indicator — and, once it lands, console-shell/02's
 * NEEDS-YOU bar + the queue-pressure meter read from THIS hook rather than each
 * recomputing (feature.md). `pendingCount` mirrors the frozen
 * `EngineReviewItem.NeedsController` contract (Queued or Held).
 *
 * SCENARIO TIME (COR-050/051). The tick + all countdown math read `scenarioNow()`
 * — never wall-clock. Actions stamp `scenarioNow().toISOString()`.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import { DraftDisposition, type EngineReviewItem } from '../models/reviewContracts'
import {
  approve as approveAction,
  batchApprove as batchApproveAction,
  edit as editAction,
  reroll as rerollAction,
  veto as vetoAction,
  type BatchApproveOutcome,
  type ReviewActionContext,
} from '../services/reviewActions'
import { reviewStore } from '../services/reviewStore'

/** A countdown at/under this many ms remaining is a "timer under 60s" (D5-014/2.1). */
const UNDER_60S_MS = 60_000

/** How often the hook re-reads the scenario clock to keep countdowns live. */
const TICK_MS = 1000

/** The surface `<ReviewQueue>` binds to. */
export interface UseReviewQueueResult {
  /** The current review items (stable snapshot from the store). */
  readonly items: readonly EngineReviewItem[]
  /** Items demanding a decision (Queued or Held) — the "N need review" count. */
  readonly pendingCount: number
  /** Items auto-HELD on expiry ("timer expired — held for you"). */
  readonly heldCount: number
  /** Delayed-auto items with under 60 scenario-seconds left — the "N timers <60s" count. */
  readonly timersUnder60sCount: number
  /** The current SCENARIO instant (ms), refreshed each tick — drives countdown display. */
  readonly nowMs: number
  readonly approve: (item: EngineReviewItem) => void
  readonly veto: (item: EngineReviewItem) => void
  readonly edit: (item: EngineReviewItem, newText: string) => void
  readonly reroll: (item: EngineReviewItem) => void
  readonly batchApprove: (items: readonly EngineReviewItem[]) => BatchApproveOutcome[]
}

/**
 * Subscribes to the review store, keeps countdowns/counts live, and exposes the
 * review actions. See the module header for the full contract.
 */
export function useReviewQueue(): UseReviewQueueResult {
  const identity = useControllerIdentity()
  const { exerciseId, timeZone } = useExerciseContext()

  const items = useSyncExternalStore(reviewStore.subscribe, reviewStore.getItems)

  const [nowMs, setNowMs] = useState<number>(() => scenarioNow().getTime())
  useEffect(() => {
    const tick = () => {
      const next = scenarioNow().getTime()
      setNowMs(prev => (prev === next ? prev : next))
    }
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [])

  const pendingCount = useMemo(() => items.filter(item => item.needsController).length, [items])
  const heldCount = useMemo(
    () => items.filter(item => item.disposition === DraftDisposition.Held).length,
    [items],
  )
  const timersUnder60sCount = useMemo(
    () =>
      items.filter(item => {
        if (item.disposition !== DraftDisposition.CountingDown || !item.countdown) return false
        const remaining = item.countdown.remainingMs(nowMs)
        return remaining > 0 && remaining < UNDER_60S_MS
      }).length,
    [items, nowMs],
  )

  // Assemble the clock/identity/exercise INPUTS at call time (scenario time is
  // read fresh per action, COR-053), then delegate to the pure `reviewActions`.
  const buildContext = useCallback(
    (): ReviewActionContext => ({
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      actingHumanId: identity.actingHumanId,
    }),
    [exerciseId, timeZone, identity.actingHumanId],
  )

  const approve = useCallback(
    (item: EngineReviewItem) => {
      approveAction(item, buildContext())
    },
    [buildContext],
  )
  const veto = useCallback(
    (item: EngineReviewItem) => {
      vetoAction(item, buildContext())
    },
    [buildContext],
  )
  const edit = useCallback(
    (item: EngineReviewItem, newText: string) => {
      editAction(item, newText, buildContext())
    },
    [buildContext],
  )
  const reroll = useCallback(
    (item: EngineReviewItem) => {
      rerollAction(item, buildContext())
    },
    [buildContext],
  )
  const batchApprove = useCallback(
    (toApprove: readonly EngineReviewItem[]) => batchApproveAction(toApprove, buildContext()),
    [buildContext],
  )

  return {
    items,
    pendingCount,
    heldCount,
    timersUnder60sCount,
    nowMs,
    approve,
    veto,
    edit,
    reroll,
    batchApprove,
  }
}
