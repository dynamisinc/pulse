/**
 * features/controller/engine — public barrel (engine-review-cockpit, STAFF world).
 *
 * The E7 engine review cockpit surface the adaptive engine (E8, Phase 2) lands
 * into — built + tested with mock drafts in Phase 1. Story 01 (the keystone)
 * establishes the shared mock contracts (the TS mirror of the FROZEN backend
 * autonomy/safety models), the pure `autoHoldPolicy` seam stories 02/03 build
 * against, the exercise-scoped mock review store, the review actions (publish via
 * the SHIPPED E2 `createPost`), and the `<ReviewQueue>` column + `useReviewQueue`
 * hook (the single D5-014/2.1 count source).
 *
 * The integration step docks `<ReviewQueue>` into `ControllerConsole`'s work area
 * and wires the real edit composer into its `editSlot` — a composition-root edit,
 * not this story's (implementation.md "Integration seam").
 *
 * World: staff (COBRA). The published OUTPUT is a participant post via `createPost`
 * (`origin: 'engine'`, scenario-time, sanitized) — never drawn here (XC-002).
 */

// --- The review-queue surface (story 01) ---
export { ReviewQueue } from './components/ReviewQueue'
export type { ReviewQueueProps, ReviewQueueEditSlotProps } from './components/ReviewQueue'

export { useReviewQueue } from './hooks/useReviewQueue'
export type { UseReviewQueueResult } from './hooks/useReviewQueue'

// --- The frozen-contract TS mirror (consumed by stories 02/03) ---
export {
  DraftDisposition,
  ControllerDecision,
  TimeoutDisposition,
  AutonomyLevel,
  AutonomyLevels,
  STOPPED_AUTONOMY,
  runningAutonomy,
  DelayedAutoCountdown,
  EngineReviewItem,
  scenarioMinuteOf,
  SCENARIO_MS_PER_MINUTE,
} from './models/reviewContracts'
export type {
  EffectiveAutonomy,
  GeneratedPost,
  DelayedAutoCountdownInit,
  EngineReviewItemInit,
} from './models/reviewContracts'

// --- The pure auto-HOLD policy (consumed by story 02) ---
export { decide, evaluate } from './services/autoHoldPolicy'
export type { DraftTimeoutResolved, TimeoutEvaluation } from './services/autoHoldPolicy'

// --- Review actions + the mock store ---
export { approve, edit, veto, reroll, batchApprove } from './services/reviewActions'
export type { ReviewActionContext, ReviewedAction, BatchApproveOutcome } from './services/reviewActions'
export { reviewStore } from './services/reviewStore'
