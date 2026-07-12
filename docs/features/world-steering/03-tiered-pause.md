# Story: Tiered pause (injects / engine / freeze)

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-023  ·  **Design decisions:** D5-014/1.3  ·  **Issue:** #26

## Context
"Pause" is not one thing. The D5 review **amended** CTL-023 into **three tiers** so a controller can
hold the right amount of the world: **Pause injects** (world keeps living), **Pause engine** (no new
AI content), **Freeze world** (guarded; participants notice; safety-stop only). The **scenario clock
stops only on Freeze**. Break Fiction (story 04) implies world-freeze.

> **Amendment (D5-014/1.3).** Before: single pause action. After: three tiers with a state pill
> (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN); scenario clock stops only on Freeze; Freeze is
> guarded.

## Acceptance Criteria
- [ ] Given the console, when the controller selects a pause tier, then the correct scope pauses —
      **Pause injects** halts queued inject/burst firing (world/engine keep running); **Pause engine**
      halts new E8 content (injects/world continue); **Freeze world** halts everything.
- [ ] A **state pill** shows the active tier: INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN (text +
      icon, not color-only; NFR-001).
- [ ] The **scenario clock stops only on Freeze** (COR-050); injects-paused and engine-paused leave
      the clock running.
- [ ] **Freeze is guarded** (deliberate confirm) because participants notice it; the pause holding
      page supports **in-fiction and out-of-fiction** options (CTL-023).
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
