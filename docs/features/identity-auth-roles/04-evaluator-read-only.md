# Story: Evaluator read-everything, write-nothing

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-013  ·  **Design decisions:** none  ·  **Issue:** #61

## Context
The Evaluator role can see all channels and all controller activity but **cannot post, react, or DM**
(COR-013). Evaluators observe the world (and later score it, E10) without perturbing it.

## Acceptance Criteria
- [ ] An Evaluator can view all channels and controller activity (read access across the exercise).
- [ ] An Evaluator **cannot** post, reply, react, repost, follow, or DM anywhere in the sim — write
      paths are denied for the role.
- [ ] The evaluator's read access is exercise-scoped (exercise-isolation story 01) and staff-world
      (never a participant surface).
- [ ] The console/monitoring surfaces expose evaluator variants with steering controls **absent, not
      disabled** (per D5 CTL-033 backlog; full variant is later).

### Copilot review 6 fold (2026-10-16)
- [ ] "Write-nothing" means exercise content and administration. An evaluator can still refresh, log out, read their own session and switch between their own enrollments (design doc §8.2).

## Out of Scope
The evaluator dashboard/analytics (E10/D6); the read-only console variant build (live-monitoring
CTL-033 backlog); DM observability plumbing (E2 SOC-062).

## Technical Notes
Staff world. Role-level write denial across sim actions; read access rides the same scoped queries.
See implementation.md (story 04).

## Dependencies
Story 01 (roles); exercise-isolation (scoped read). Relates to E10 evaluator surfaces.

## Tests
- Integration: every sim write path is denied for Evaluator; reads across channels succeed.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §8.2 (role matrix), §8.1. Wave A1. Tier-2 (security).

- [ ] **Evaluator write-nothing is proved by the route x role matrix, not by per-endpoint spot checks.**
      Given every mutating staff/participant route enumerated at startup, when the `evaluator` role calls
      each, then it is refused (403; bare 404 where the bare-404 pattern applies) with no state change.
      The matrix test is owned by story 17 and must list this story's routes; a new write route with no
      matrix entry fails the build.
- [ ] **Evaluator is refused every write including future annotations** (#61) until track 5 adds an
      evaluator-only annotation route (explicitly out of scope here).
- [ ] **Evaluator read access is unchanged:** console, feeds, report read within the evaluator's own
      `Enrollment` exercise only; a foreign-exercise and a foreign-org read return the bare 404.
- [ ] User guide: `docs/guide/` evaluator/roles section states evaluators are read-only; updated in the
      same PR.

Depends on `17-role-matrix-enforcement`.
