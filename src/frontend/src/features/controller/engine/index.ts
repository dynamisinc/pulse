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
 * SERIAL INTEGRATION (Wave-1, `ControllerConsoleRoute`). This barrel also
 * exports the integration seam's own additions: `useDraftTimer` (story 02, now
 * public so `DraftTimerDriver` can be composed from outside this folder),
 * `useEngineControl` (the ADP-042 kill switch + degraded-mode mock),
 * `useDemandMeter` (the CTL-034 "queue pressure = demand, never performance"
 * meter), `EngineControlBar` (the docked chrome strip), and `autoPublish` (the
 * ONE swamped-mode timeout auto-send path, which does not re-emit
 * `engine.reviewed` — see `reviewActions.ts`).
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
export { approve, edit, veto, reroll, batchApprove, autoPublish } from './services/reviewActions'
export type { ReviewActionContext, ReviewedAction, BatchApproveOutcome } from './services/reviewActions'
export { reviewStore } from './services/reviewStore'

// --- Swamped mode (story 03) — the lead-gated auto-send opt-in ---
export { useSwampedMode } from './hooks/useSwampedMode'
export type { UseSwampedModeResult } from './hooks/useSwampedMode'
export { SwampedModeToggle } from './components/SwampedModeToggle'

// --- The timed-draft countdown hook (story 02) — public for the integration
// seam's `DraftTimerDriver` ---
export { useDraftTimer } from './hooks/useDraftTimer'
export type {
  UseDraftTimerOptions,
  UseDraftTimerResult,
  DraftTimerReviewedAction,
} from './hooks/useDraftTimer'

// --- Serial integration seam: engine control, demand meter, the chrome strip,
// the timer driver, and the edit composer ---
export { useEngineControl } from './hooks/useEngineControl'
export type { EngineMode, UseEngineControlResult } from './hooks/useEngineControl'
export { useDemandMeter, DEMAND_BUDGET_PER_MINUTE } from './hooks/useDemandMeter'
export type { UseDemandMeterResult } from './hooks/useDemandMeter'
export { EngineControlBar } from './console/EngineControlBar'
export { DraftTimerDriver } from './console/DraftTimerDriver'
export type { DraftTimerDriverProps, DraftTimerDriverContext } from './console/DraftTimerDriver'
export { EngineDraftEditComposer } from './components/EngineDraftEditComposer'

// --- Engine settings panel (story 06) — the console admin surface for the
// exercise autonomy default + tier-policy mode (story 05's API). The single
// source both this panel and `EngineControlBar`'s "Live" label read. ---
export { useEngineSettings, engineSettingsStore } from './hooks/useEngineSettings'
export type {
  UseEngineSettingsResult,
  AutonomyDefaultLevel,
  EngineSettingsDto,
  TierPolicyMode,
} from './hooks/useEngineSettings'
export { EngineSettingsPanel, ENGINE_SETTINGS_TOOL_ID } from './components/EngineSettingsPanel'
export type { EngineSettingsPanelProps } from './components/EngineSettingsPanel'
