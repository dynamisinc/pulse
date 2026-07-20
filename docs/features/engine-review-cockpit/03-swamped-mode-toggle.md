# Story: Swamped-mode toggle (lead-controller-gated auto-send)

**Feature:** Engine review cockpit  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** ADP-040 (new capability)  ·  **Design decisions:** D5-014/1.1  ·  **Issue:** #36

## Context
The **only** sanctioned path to timeout auto-send. When a small SimCell is genuinely swamped, the
**lead controller** may opt into "swamped mode" — a per-exercise toggle under which expired timed
drafts auto-send instead of auto-holding (story 02). It is deliberately a separate, gated decision so
**automation never escalates its own autonomy**; a controller chooses it explicitly.

## Acceptance Criteria
- [x] Given a controller whose Phase-1 mock identity has **`isLead: true`**, when they enable swamped
      mode for the exercise, then expired timed drafts **auto-send** (within existing engine rate caps)
      instead of auto-holding (story 02).
- [x] Swamped mode is **not** available to a controller whose mock identity has `isLead: false`, and it
      is **off by default**; enabling/disabling it is logged (XC-004) with actor + scenario time.
- [x] While swamped mode is on, the console shows a clear, persistent indicator (text + icon, not
      color-only; NFR-001) that timeout auto-send is active.
- [x] The engine never turns swamped mode on by itself — it is only ever a human toggle (the autonomy
      level does not self-escalate).
- [x] Swamped mode is per-exercise scoped (COR-001) and staff-only (XC-002).

## Out of Scope
The default auto-HOLD behavior (story 02); autonomy levels themselves (E8 Suggest/Delayed/Auto,
ADP-030s); the kill switch (ADP-042).

## Technical Notes
Staff world (COBRA). A per-exercise flag gated by `useControllerIdentity()`'s **`isLead`** field — a
small, additive extension of the SHIPPED Phase-1 mock (`identity/controllerIdentity.ts`,
console-shell/01), not an E1 role (`roles.ts` has no `lead-controller` role yet; the real
lead-controller gate is the deferred backend swap, same pattern as the rest of that mock). `/console`
does not mount `SessionProvider`, so this does not require it either. `useSwampedMode()` provides the
resulting `swampedMode` boolean as an **input** to story 02's `useDraftTimer`, not an import of it.
Persistent on-state banner. See implementation.md (story 03).

## Dependencies
The Phase-1 mock controller identity's `isLead` flag (extends `controllerIdentity.ts`, console-
shell/01, shipped); story 02 (the timer path it switches, via the `swampedMode` input/output
contract); telemetry. Part of STORY-UPDATES.md §A **ADP-040** (the swamped-mode add).

## Tests
Delivered — AC ↔ test mapping (`src/frontend/src/features/controller/engine/`,
`src/frontend/src/features/controller/identity/`):
- **AC1** (lead enables swamped mode → expired timers auto-send) →
  `hooks/useSwampedMode.test.tsx` `useSwampedMode — lead can toggle` › `'enables swamped mode and logs
  one telemetry event with actor + scenario time'`; the resulting auto-send path is proven end-to-end
  by `hooks/useDraftTimer.test.ts` `'resolves Publish (action auto-send) on expiry when swamped + still
  Delayed-auto'` and `console/DraftTimerDriver.test.tsx` `DraftTimerDriver — swamped(lead) + still
  Delayed-auto: the ONE auto-send path` › `'autoPublish appends an origin: engine post; its participant
  view strips provenance'`. The `isLead` source is `identity/controllerIdentity.test.tsx`
  `'isLead: true for the mock exercise, false for any other (derived) exercise (ADP-040)'`.
- **AC2** (not available to non-lead, off by default, toggling logged) →
  `hooks/useSwampedMode.test.tsx` `useSwampedMode — default state` › `'is off by default for a fresh
  exercise'`; `useSwampedMode — non-lead cannot enable it (ADP-040)` › `'setSwampedMode(true) is
  rejected: state stays off, nothing is logged'` and `'setSwampedMode(false) is not gated for a
  non-lead'`; `useSwampedMode — lead can toggle` › `'disables swamped mode and logs a second telemetry
  event'` and `'is a no-op (no state change, no telemetry) when set to its current value'`.
  Component-level gate: `components/SwampedModeToggle.test.tsx` `SwampedModeToggle — non-lead
  controller (COR-015 absent, not disabled)` › `'never renders the enable control'`.
- **AC3** (persistent on-state indicator, text+icon not color-only) →
  `components/SwampedModeToggle.test.tsx` `SwampedModeToggle — lead controller` › `'shows the
  persistent on-state banner with TEXT + an icon (NFR-001) when on'` and `SwampedModeToggle — non-lead
  controller` › `'still shows the on-state banner if the exercise's lead has enabled it'`.
- **AC4** (engine never self-enables it) → `hooks/useSwampedMode.contract.test.tsx`
  `useSwampedMode — the engine never self-enables` › `'re-rendering the hook many times (no
  setSwampedMode call) never flips the flag on'`, `'reading the flag from many concurrent hook
  instances never flips it on'`, and `'the pure engine-side consumer (autoHoldPolicy) reading
  swampedMode=true never writes it back to the store'`.
- **AC5** (per-exercise scoped, staff-only) → `hooks/useSwampedMode.test.tsx` `useSwampedMode —
  per-exercise scoping (COR-001)` › `'a different exercise never observes another exercise's flag'`;
  `hooks/useSwampedMode.contract.test.tsx` `useSwampedMode — resetForTests isolates per-exercise state
  across cases` › `'resetForTests clears every exercise flag so the next case starts clean'`. Staff-only
  console mounting covered under the story 01/console-dock integration tests.
- **Input-contract guarantee** (plain boolean feeding `autoHoldPolicy`/`useDraftTimer` with no
  adaptation) → `hooks/useSwampedMode.contract.test.tsx` `useSwampedMode — boolean-shape contract with
  the autoHoldPolicy/useDraftTimer input` › `'is a plain boolean, both off and on'` and `'feeds
  directly into autoHoldPolicy.decide/evaluate with no adaptation (the real story 02 input shape)'`.
- **Clamp precedence** (swamped still holds when STOP/Suggest-only/degrade clamps below Delayed-auto)
  → `console/DraftTimerDriver.test.tsx` `DraftTimerDriver — the clamp-suspends-swamped composition
  (REAL useEngineControl)` (all three cases) and `services/autoHoldPolicy.test.ts` `'swamped mode still
  holds when a safety clamp lowered the level below Delayed-auto'`.
