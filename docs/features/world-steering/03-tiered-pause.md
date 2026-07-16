# Story: Tiered pause (injects / engine / freeze)

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-023  ·  **Design decisions:** D5-014/1.3, D7-004 (pause/EndEx pages → `participant-shell`), D7-010 (state pill → `staff-shell` header)  ·  **Issue:** #26

## Context
"Pause" is not one thing. The D5 review **amended** CTL-023 into **three tiers** so a controller can
hold the right amount of the world: **Pause injects** (world keeps living), **Pause engine** (no new
AI content), **Freeze world** (guarded; participants notice; safety-stop only). The **scenario clock
stops only on Freeze**. Break Fiction (story 04) implies world-freeze.

> **Amendment (D5-014/1.3).** Before: single pause action. After: three tiers with a state pill
> (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN); scenario clock stops only on Freeze; Freeze is
> guarded.
>
> **Amendment (D7-004 / D7-010).** The participant-facing **pause + EndEx pages** (in-fiction /
> out-of-fiction registers) are **rendered by `participant-shell`** (the overlay layer,
> `participant-shell/05-overlay-layer.md`). The **state pill** lives in the **`staff-shell` header**
> (`staff-shell/01`, D7-010) — the R-006 interim tag is **resolved**. **This story owns the control:**
> the tier state machine (Pause injects / Pause engine / Freeze), the guard on Freeze, the clock-stop-
> on-Freeze, and pushing `overlayState` for the shell to render.

## Acceptance Criteria
- [ ] Given the console, when the controller selects a pause tier, then the correct scope pauses —
      **Pause injects** halts queued inject/burst firing (world/engine keep running); **Pause engine**
      halts new E8 content (injects/world continue); **Freeze world** halts everything.
- [ ] The active tier is always visible as INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN (text +
      icon, not color-only; NFR-001) *(rendered by the `staff-shell` header state pill, D7-010 —
      R-006 resolved; this story provides the tier state it displays)*.
- [ ] The **scenario clock stops only on Freeze** (COR-050); injects-paused and engine-paused leave
      the clock running.
- [ ] **Freeze is guarded** (deliberate confirm) because participants notice it; the pause holding
      page supports **in-fiction and out-of-fiction** registers (CTL-023) — **rendered by
      `participant-shell`** (D7-004); this story selects the register and pushes the state.
- [ ] In-flight bursts (inject-queue CTL-014) suspend under Pause injects/Freeze; each tier change is
      logged (XC-004) and is staff-only (XC-002).

## Out of Scope
Break Fiction (story 04, which implies freeze); the exercise-clock mechanics themselves (E1 COR-050);
the holding-page content authoring (E1 lifecycle COR-032).

## Technical Notes
Staff world (COBRA). Owns a pause-state machine (injects/engine/freeze) that other surfaces read
(inject-queue burst suspend, time-jump gating; engine review). Freeze integrates with the clock stop.
See implementation.md (story 03).

## Dependencies
E1 clock + lifecycle/holding-page (COR-050/032); inject-queue (bursts/jump read pause); engine-review
-cockpit (engine pause). Ticks STORY-UPDATES.md §A **CTL-023**.

## Tests
- Unit: each tier pauses the correct scope; only Freeze stops the scenario clock.
- Unit: an in-flight burst suspends under Pause injects and Freeze.
- Component (RTL): the state pill shows the active tier with text+icon (not color-only); Freeze
  requires a confirm.
