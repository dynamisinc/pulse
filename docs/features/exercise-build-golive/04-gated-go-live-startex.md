# Story: Gated go-live — Staged, then StartEx→Live

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-043  ·  **Design decisions:** none  ·  **Issue:** #74

## Context
Go-live is a deliberate, gated action (Exercise Director authority) with **two distinct moments**:
**Build → Staged** opens participant access to the ambient world (pre-StartEx familiarization); and
**StartEx (Staged → Live)** is a separate explicit action that starts the exercise clock (COR-050) and
begins scenario content delivery (COR-043).

## Acceptance Criteria
- [ ] **Build → Staged** is a Director-gated action that opens participant access to the ambient world
      (clock not started; ambient/backdated content visible; scheduled scenario content held; E8
      dormant; weather shows pre-StartEx state).
- [ ] **StartEx (Staged → Live)** is a **separate** Director-gated action that starts the exercise
      clock (exercise-clock COR-050) and begins scenario content delivery.
- [ ] Both actions are Director-authority, logged (XC-004), and reflect/advance the lifecycle state
      machine (exercise-configuration COR-032).
- [ ] The readiness dashboard (story 03) is surfaced at the go-live decision.

## Out of Scope
The clock mechanics (exercise-clock COR-050); content lock (story 05); the holding page (Paused,
exercise-configuration); EndEx (exercise-clock COR-054).

## Technical Notes
Staff world (COBRA), Director-gated. Two separate transitions with defined per-subsystem Staged/Live
behavior. See implementation.md (story 04).

## Dependencies
exercise-configuration lifecycle (COR-032); exercise-clock (StartEx starts clock); story 03 (readiness);
roles (Director authority). Drives E8 dormancy and scheduled content.

## Tests
- Integration: Staged opens participant access with clock stopped + scenario content held; StartEx
  starts the clock and scenario delivery; both are Director-gated and logged.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.1, §5.2, §8.2 (Tier-2 signed off by Tom, 2026-10-16). Wave A3 (role checks land in identity 17, A1).
- [ ] **StartEx is controller-only.** Given a staged exercise, when a controller starts it, then it goes live and sets `Exercise.FirstLiveAt` if null; planner, evaluator and org-scope sessions get 403 and no state change. **Stage** (build -> staged) is planner-only and requires no blocking readiness item; **unstage** is story 07.
- [ ] Every transition emits `exercise.lifecycle.transitioned` with the actor `PersonId` and role.
- [ ] User guide (C5 docs-as-done): `docs/guide/controller-guide.md` is updated in the same PR, or the PR states "no guide impact".
