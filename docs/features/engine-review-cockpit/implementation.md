# Implementation: Engine review cockpit

> Staff-world continuous-watch surface that E8 (Phase 2) lands into; built and tested with mock drafts
> in Phase 1. Publishes approved content via the E2 pipeline. The auto-HOLD default (story 02) is a
> safety property — inaction is never approval.

> **Phase 0 reconciliation (done).** This doc previously assumed two soft deps that turned out not to
> exist yet: console-shell/02's NEEDS-YOU bar (`useToDos`) and world-steering's pause/escalation state
> (`usePauseState`, `useStorylineTarget`). Both are corrected below — see the Reuse map. The mock
> foundation (story 01) is now specified as a field-for-field TS mirror of the FROZEN backend contracts
> in `Pulse.Core/Features/Autonomy/Models/*` and `Services/AutoHoldPolicy.cs`/`WorkloadDemandMeter.cs`,
> and stories 01–03 are specified against the SHIPPED E7 Simcell Operator Wave-1 seam
> (`/console`, `@/features/controller`, `useControllerIdentity()`, the E2 `createPost` pipeline).

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Review queue | The SHARED mock foundation + the queue surface: a TS mirror of `EngineReviewItem`/`DelayedAutoCountdown`/`GeneratedPost`/`DraftDisposition`/`TimeoutDisposition`/`AutonomyLevel`/`EffectiveAutonomy` (field-for-field port of `Pulse.Core/Features/Autonomy/Models/*`), a pure `autoHoldPolicy.decide()` TS port of `AutoHoldPolicy.Decide` (same precedence, scenario-time minutes), a mock exercise-scoped review store, and `reviewActions` (approve/edit/veto/re-roll/batch) that publish via the SHIPPED `createPost`. Does not fork `createPost`. | `features/controller/engine/models/reviewContracts.ts`, `features/controller/engine/services/autoHoldPolicy.ts`, `features/controller/engine/services/reviewStore.ts` (mock, exercise-scoped), `features/controller/engine/services/reviewActions.ts`, `features/controller/engine/components/ReviewQueue.tsx`, `features/controller/engine/hooks/useReviewQueue.ts` | `EngineReviewItem`/`DraftDisposition`/`TimeoutDisposition`/`AutonomyLevel`/`EffectiveAutonomy`/`DelayedAutoCountdown`/`GeneratedPost` (types), `decide()` (pure fn, consumed by 02), `useReviewQueue()` (items + `pendingCount`/`heldCount` — the inline-indicator source), `approve`/`edit`/`veto`/`reroll`/`batchApprove` |
| 02 Auto-HOLD on expiry | A countdown-tick hook whose terminal action calls story 01's `decide()`/`autoHoldPolicy` against the current scenario minute and the draft's `EffectiveAutonomy`. Takes `swampedMode: boolean` as an **input parameter** (not an import of story 03), so its file stays disjoint from 03's — terminal action is HOLD unless the caller passes `swampedMode: true` (and the draft is still effectively Delayed-auto, per `AutoHoldPolicy`'s own precedence). | `features/controller/engine/hooks/useDraftTimer.ts` | `useDraftTimer(countdown, effective, swampedMode)` |
| 03 Swamped mode | A per-exercise lead-gated toggle. Gate reads `isLead` off the Phase-1 mock controller identity (extends `controllerIdentity.ts`'s mock — see Reuse map), not an E1 role (`roles.ts` has no `lead-controller` yet). Provides the `swampedMode` boolean that 02 consumes as an input. | `features/controller/engine/hooks/useSwampedMode.ts`, `features/controller/engine/components/SwampedModeToggle.tsx` | `useSwampedMode()` (returns `{ swampedMode, isLead, setSwampedMode }`), `SwampedModeToggle` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- **Inline pending/held count — this feature's own hook.** `console-shell/02`'s NEEDS-YOU bar
  (`useToDos`) is **not built**; do not reference it. `useReviewQueue()` (story 01) is itself the
  D5-014/2.1 single source of truth ("N need review / N timers <60s"); when console-shell/02 lands it
  reads from this hook rather than recomputing.
- **Storyline context — mocked, not `world-steering`.** `world-steering`'s escalation dial
  (`useStorylineTarget`) and pause tiers (`usePauseState`) are **not built**; do not reference them.
  Story 01's mock `EngineReviewItem` carries a `storylineId` + a short mocked storyline "brief" string
  for the queue item's context display. There is **no pause-suspends-timers wiring** yet — story 02's
  timer runs independent of any pause state; note this as a documented follow-up for when `world-
  steering`'s CTL-023 tiered pause lands (Pause engine should suspend `useDraftTimer`).
- **E2 publish pipeline (SHIPPED, `@/features/social`)** — `createPost({ ..., origin: 'engine',
  actingHumanId })` → `postStore.appendPost` → `toParticipantView` is the **only** publish path for an
  approved/edited/swamped-auto-sent draft. `actingHumanId` is the **approving controller**'s id from
  `useControllerIdentity()` (COR-018 attribution on an engine-originated post); the persona-voiced
  `GeneratedPost.PersonaHandle` resolves to `authorPersonaId`. Do not fork `createPost`.
- **`useControllerIdentity()` (SHIPPED, `@/features/controller`)** — the acting controller for
  publish attribution (story 01) and, extended with an `isLead` flag (story 03; see below), the
  swamped-mode gate. This is a same-tab Phase-1 mock, same pattern as the rest of `/console` — no
  `SessionProvider` is mounted there, and none of these stories require it.
- **`controllerIdentity.ts`'s mock is extended, not forked (story 03).** Story 03 adds an `isLead:
  boolean` field to the SHIPPED `ControllerIdentity`/`MOCK_CONTROLLER_IDENTITIES` (console-shell/01,
  Complete) — same "Phase-1 mock, deferred backend swap" pattern the module's own header documents.
  This is a small, additive, backward-compatible extension of a shared file (not a fork); flag it at
  code review since it touches a shipped file outside `engine/`.
- `@/core/exerciseContext`'s `useExerciseContext()` (SHIPPED) — scopes the mock review store per
  exercise (COR-001); never a client-supplied query-scoping param.
- `@/core/clock`'s `scenarioNow`/scenario-minute reads (SHIPPED) — countdown/expiry math is scenario-
  time only (COR-050/051), mirroring `DelayedAutoCountdown`'s scenario-minute contract.
- `@/core/telemetry`'s `buildAndEmit` (SHIPPED, XC-004 v0) — every queue action, expiry→HOLD
  transition, and swamped-mode toggle is logged (ADP-041); `channel: 'system'`, `actor.kind: 'engine'`
  for engine-attributed transitions, `origin: 'engine'` on the resulting post.
- `usePersonas`/`Persona` (SHIPPED, `@/features/personas`) — resolves `GeneratedPost.PersonaHandle` to
  a `Persona` for the queue item's persona context.
- **Integration seam (orchestrator-owned, future — not this wave).** `ControllerConsole.tsx`'s work
  area does not yet have a permanent-column mount point for `ReviewQueue`, nor a kill-switch/demand-
  meter/degrade indicator, nor a place to surface the inline count in chrome. Docking `ReviewQueue`
  into that work area is a composition-root-style edit (`ORCHESTRATION_MECHANICS.md` §4 "composition
  root is disjoint from nothing") — the orchestrator makes it serially, between waves, in its own
  commit; no story 01/02/03 builder branch touches `ControllerConsole.tsx`.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Review queue | frontend | `engine/models/reviewContracts.ts`, `engine/services/autoHoldPolicy.ts`, `engine/services/reviewStore.ts`, `engine/services/reviewActions.ts`, `engine/components/ReviewQueue.tsx`, `engine/hooks/useReviewQueue.ts` | shipped `createPost`/`postStore` (E2); shipped `useControllerIdentity()`, `useExerciseContext()`, `@/core/clock`, `@/core/telemetry`, `usePersonas()` | — | 1 | M |
| 02 Auto-HOLD on expiry | frontend | `engine/hooks/useDraftTimer.ts` | 01 (`reviewContracts`, `autoHoldPolicy`) | 03 | 2 | S |
| 03 Swamped mode | frontend | `engine/hooks/useSwampedMode.ts`, `engine/components/SwampedModeToggle.tsx`; additive extension of shipped `identity/controllerIdentity.ts` (adds `isLead`) | 01 (`reviewContracts`); shipped `controllerIdentity.ts` (console-shell/01) | 02 | 2 | S |

Story 01 is the **keystone** — it establishes the shared mock contracts (the TS mirror of the frozen
backend models) and the pure `autoHoldPolicy`/`useReviewQueue` seam that 02 and 03 both build against.
Stories 02/03 build in parallel in Wave 2: they are file-disjoint (`useDraftTimer.ts` vs.
`useSwampedMode.ts`/`SwampedModeToggle.tsx`), decoupled by the `swampedMode: boolean` input/output
contract rather than an import of each other. **No story may allow timeout auto-send except behind
`swampedMode === true`** — `useDraftTimer`'s terminal action is HOLD by default, matching
`AutoHoldPolicy.Decide`'s precedence exactly (full-stop → explicit decision → not-expired →
expired-with-no-decision-holds-unless-swamped-and-still-Delayed-auto).
