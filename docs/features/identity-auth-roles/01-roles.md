# Story: Role set

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-010  ·  **Design decisions:** none  ·  **Issue:** #58

## Context
The role set that mirrors the exercise ecosystem and gates every surface: **Participant**, **PIO**
(participant flavor with monitoring defaults + Press Room authoring), **Controller**, **Evaluator**
(read-everything, write-nothing in the sim), **Planner/ExerciseAdmin**, **OrgAdmin** — aligned with
Cadence's ExerciseRole vocabulary where sensible (COR-010).

**Seed delivered (Social E2 prerequisite):** `core/auth/roles.ts` landed as a minimal mock seed so the
Social (E2) build (`posts/02`, `posts/03`) has an `ExerciseRole` vocabulary and write-gating to build
against — it is **not** a build of this story's full ACs. Delivered: the `ExerciseRole` type (the six
roles), `PARTICIPANT`/`STAFF` role-group guards, `canWriteInSim()` (COR-013 write-nothing groundwork),
and `isExerciseRole()` + a `useRole()` hook. Tests: `core/auth/roles.test.ts`. Remaining before this
story can flip to Complete: actual route/API surface gating per role (participant cannot reach a staff
surface, XC-002), the PIO Press Room authoring activation (waits on E5), and the org-admin surface
itself — none of that exists yet.

## Acceptance Criteria
- [ ] The six roles exist and gate access: participant/PIO surfaces vs staff (controller/evaluator/
      planner) surfaces vs org administration.
- [ ] Role determines surface reachability — a participant role cannot reach any staff surface (XC-002),
      and an Evaluator cannot write in the sim (COR-013, story 04).
- [ ] PIO is a participant flavor with monitoring defaults and Press Room authoring rights (the latter
      activates when E5 lands).
- [ ] Roles are exercise-scoped assignments (a person's role is per exercise).

## Out of Scope
Evaluator write-nothing enforcement detail (story 04); staff cross-exercise assignment (StaffAssignment,
exercise-isolation story 05); org-account grants (story 09).

## Technical Notes
Foundation. Role checks gate routes/APIs; align naming with Cadence ExerciseRole. See implementation.md
(story 01).

## Dependencies
Exercise-isolation (scoping). Underpins every gated surface.

## Tests
- Unit/integration: each role reaches its allowed surfaces and is denied the others.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.1, §8.1, §8.2 (Tier-2 signed off by Tom, 2026-10-16). Wave A1. **The ACs above stay; the
following amend them.** The frozen-type change (`ExerciseRole` in `core/auth/roles.ts`) needs
**orchestrator clearance first** and a post on the feature issue before A1 merges (brief C1.4).

- [ ] **`orgAdmin` is no longer an exercise role.** Given the role vocabulary, then `ExerciseRole` is
      `planner | controller | evaluator | participant | pio`, and `orgAdmin` is an `OrgRole` carried by
      `Person.OrgRole` (org-level grant). Supersedes AC 1's "six roles" reading and AC 4 for `orgAdmin`
      only (it is org-scoped, not exercise-scoped).
- [ ] **Role set is per `Enrollment`.** Given a person with enrollments in two exercises, then they can hold
      a different role in each, and exactly one role per exercise (unique `(ExerciseId, PersonId)`;
      a second role in the same exercise is 409 `conflicting-enrollment`). Being staff and participant in
      the same exercise is impossible in the database.
- [ ] **Org admin gets no implicit in-exercise power.** Given an org admin with no enrollment in exercise X,
      then every exercise-scoped staff route in X fails closed; self-enrolling is audited
      (`org.enrollment.self-granted`).
- [ ] **Migration keeps today's access.** Every existing `orgAdmin` assignment sets `Person.OrgRole` and
      becomes a `planner` `Enrollment` on that exercise.
- [ ] User guide: `docs/guide/planner-guide.md` (roles) updated in the same PR, or states "no guide impact".

Depends on `16-person-and-enrollments`. Not in scope: the per-route enforcement (story 17).
