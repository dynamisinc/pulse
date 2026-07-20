# Story: Swamped-mode toggle (lead-controller-gated auto-send)

**Feature:** Engine review cockpit  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** ADP-040 (new capability)  ·  **Design decisions:** D5-014/1.1  ·  **Issue:** #36

## Context
The **only** sanctioned path to timeout auto-send. When a small SimCell is genuinely swamped, the
**lead controller** may opt into "swamped mode" — a per-exercise toggle under which expired timed
drafts auto-send instead of auto-holding (story 02). It is deliberately a separate, gated decision so
**automation never escalates its own autonomy**; a controller chooses it explicitly.

## Acceptance Criteria
- [ ] Given a controller whose Phase-1 mock identity has **`isLead: true`**, when they enable swamped
      mode for the exercise, then expired timed drafts **auto-send** (within existing engine rate caps)
      instead of auto-holding (story 02).
- [ ] Swamped mode is **not** available to a controller whose mock identity has `isLead: false`, and it
      is **off by default**; enabling/disabling it is logged (XC-004) with actor + scenario time.
- [ ] While swamped mode is on, the console shows a clear, persistent indicator (text + icon, not
      color-only; NFR-001) that timeout auto-send is active.
- [ ] The engine never turns swamped mode on by itself — it is only ever a human toggle (the autonomy
      level does not self-escalate).
- [ ] Swamped mode is per-exercise scoped (COR-001) and staff-only (XC-002).

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
- Unit: with swamped mode on, an expired timer auto-sends; with it off (default), it holds.
- Unit: a controller whose mock identity has `isLead: false` cannot enable it; toggling is logged.
- Component (RTL): the on-state indicator renders (text+icon, not color-only).
