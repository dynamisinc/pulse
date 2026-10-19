# Story: Gated go-live — Staged, then StartEx→Live

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Partially built (roles/transition/telemetry via identity 16/17)
**Requirements:** COR-043  ·  **Design decisions:** none  ·  **Issue:** #74

## Context
Go-live is a deliberate, gated action (~~Exercise Director authority~~ planner stages, controller starts) with **two distinct moments**:
**Build → Staged** opens participant access to the ambient world (pre-StartEx familiarization); and
**StartEx (Staged → Live)** is a separate explicit action that starts the exercise clock (COR-050) and
begins scenario content delivery (COR-043).

## Acceptance Criteria
- [ ] **Build → Staged** is a ~~Director-gated~~ **planner-only** action (role gate ALREADY MET, identity 17; readiness gate remaining, see Currency check) that opens participant access to the ambient world
      (clock not started; ambient/backdated content visible; scheduled scenario content held; E8
      dormant; weather shows pre-StartEx state).
- [ ] **StartEx (Staged → Live)** is a **separate** ~~Director-gated~~ **controller-only** action (ALREADY MET) that starts the exercise
      clock (exercise-clock COR-050) and begins scenario content delivery.
- [ ] Both actions are ~~Director-authority~~ role-gated (planner / controller; there is no Director role), logged (XC-004), and reflect/advance the lifecycle state
      machine (exercise-configuration COR-032).
- [ ] The readiness dashboard (story 03) is surfaced at the go-live decision (**shown, not enforced, at StartEx**; enforced at Stage).

### Copilot review 7 fold (2026-10-16)
- [ ] The `FirstLiveAt` stamp itself is delivered in A1 (identity-auth-roles 16). This story keeps the controller-only gate and adds the readiness check; it does not re-implement the stamp.

## Out of Scope
The clock mechanics (exercise-clock COR-050); content lock (story 05); the holding page (Paused,
exercise-configuration); EndEx (exercise-clock COR-054).

## Technical Notes
Staff world (COBRA), Director-gated. Two separate transitions with defined per-subsystem Staged/Live
behavior. See implementation.md (story 04).

## Dependencies
exercise-configuration lifecycle (COR-032); exercise-clock (StartEx starts clock); story 03 (readiness);
~~roles (Director authority)~~ identity-auth-roles 17 role matrix; story 03 readiness. Drives E8 dormancy and scheduled content.

## Tests
- Integration: Staged opens participant access with clock stopped + scenario content held; StartEx
  starts the clock and scenario delivery; both are Director-gated and logged.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.1, §5.2, §8.2 (Tier-2 signed off by Tom, 2026-10-16). Wave A3 (role checks land in identity 17, A1).
- [ ] **StartEx is controller-only.** Given a staged exercise, when a controller starts it, then it goes live and sets `Exercise.FirstLiveAt` if null; planner, evaluator and org-scope sessions get 403 and no state change. **Stage** (build -> staged) is planner-only and requires no blocking readiness item; **unstage** is story 07.
- [ ] Every transition emits `exercise.lifecycle.transitioned` with the actor `PersonId` and role.
- [ ] User guide (C5 docs-as-done): `docs/guide/controller-guide.md` is updated in the same PR, or the PR states "no guide impact".

## Currency check 2026-10-19 (post-A1, Session D)

Audit of main after A1. Slice plan: PR-2 = story 03, **PR-3 = this story**, PR-4 = A3 migration + story 09, PR-5 = story 01. There is no "Director" role: roles are planner / controller / evaluator (+ orgAdmin at org scope).

**Rules (replace any "Director" wording above)**
- **Stage** (build -> staged) is planner-only (delivered, identity 17) AND is refused with `409 { error: 'readiness-blocking', blocking: [...] }` while any blocking item from story 03 is `open`.
- **StartEx** (staged -> live) is controller-only (delivered, identity 17) and does NOT re-run the blocking check. Readiness is shown at the decision, not enforced.

**ALREADY MET (evidence on main)**
- Transition + clock start: `ExerciseLifecycleState` forward-only machine, `POST /api/staff/exercise-lifecycle/transition`.
- Role gates: `LifecycleTransitionRoles` + `LifecycleTransitionRoleFilter` (stage = planner; StartEx / pause / resume / EndEx = controller; unarchive = no exercise role).
- Telemetry: `exercise.lifecycle.transitioned` with `Actor.ActingHumanId` (= `StaffUserId`, same key as `Person.Id`, so it is the PersonId) and `Role`.
- `FirstLiveAt` stamp: identity 16.

**Remaining work**
- [ ] The stage readiness gate in `ExerciseLifecycleService` (409 with the blocking list; needs the story 03 service).
- [ ] A planner "Stage exercise" control in `/staff/plan` alongside the Readiness section: confirm dialog; shows the blocking list on 409.
- [ ] A readiness summary next to the controller's Start control (`features/controller/lifecycle/ExerciseLifecycleControl.tsx`).
- [ ] Tests: stage refused with blocking items (409 body shape) and allowed when clear; StartEx unaffected by open items; existing role-matrix rows unchanged.

**Not built (story 07):** unstage, reopen, reset, unarchive.

**Dependencies (updated):** identity-auth-roles 17 role matrix; story 03 readiness.
