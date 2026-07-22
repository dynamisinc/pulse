# Story: Staff cross-exercise switcher (staff-only)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-005  ·  **Design decisions:** D5-012(g)  ·  **Issue:** #48
**Stack:** frontend  ·  **Review:** Tier-1

## Context
Staff (controllers/evaluators) may hold assignments across multiple exercises, with an explicit
exercise switcher on **staff surfaces only** (COR-005). The D5 review refined this: during **live
conduct** the console shows a **static identity badge**, not a switcher — switching is a pre-conduct
action (D5-012(g), expressed in `console-shell/03`).

**Phase B2 make-real (`docs/BACKEND_ROADMAP.md` §4).** This story now builds the switcher against the
**real** `StaffAssignment` model (identity-auth-roles/05): it reads `GET /api/staff/assignments` for the
staff user's exercises and calls `POST /api/staff/active-exercise` to switch, which re-scopes staff
queries server-side via the shared `ExerciseContext` seam. `StaffAssignment` is the **only** cross-
exercise object in the model — see identity-auth-roles/05 for why it is exempt from the global filter.

## Acceptance Criteria
- [x] Given a staff member with assignments in multiple exercises, when they use a staff surface, then
      an explicit exercise switcher lets them change active exercise (pre-conduct).
- [x] The switcher appears **only** on staff surfaces (dark COBRA chrome) — never on any participant
      path (XC-002); it is impossible to confuse with a participant view.
- [ ] During live conduct the console presents a **static identity badge** (per D5-012(g)); switching
      is a pre-conduct concern (see console-shell/03). **Not yet enforced by this story** — the
      conduct-aware gate is `console-shell/03`'s build (Not Started, Out of Scope here); today the
      switcher does not itself check conduct state. See Delivered.
- [x] Switching active exercise re-scopes all staff queries to the newly selected exercise (built on
      story 01).
- [x] **Make-real data source:** the switcher lists the staff user's exercises from
      `GET /api/staff/assignments` (identity-auth-roles/05) and switches via
      `POST /api/staff/active-exercise`, which validates against the caller's `StaffAssignment` set and
      re-scopes subsequent staff queries (the staff arm of the scope seam).
- [x] **Accessibility (NFR-001):** the switcher is keyboard-operable with an accessible label; the
      active exercise is conveyed by more than color.

## Out of Scope
The conduct-time static badge UI itself (console-shell/03); staff assignment management (StaffAssignment
model); participant routing (story 04).

## Technical Notes
Staff world (COBRA). The active-exercise selection drives the scoping context for staff queries. Note
the conduct-time amendment (D5-012(g)) lands in console-shell. See implementation.md (story 05).

## Dependencies
Story 01 (scoping); **identity-auth-roles/05** (the live `StaffUser`/`StaffAssignment` model +
`GET /api/staff/assignments` + `POST /api/staff/active-exercise`); identity-auth-roles/03 (staff
session, live); console-shell/03 for conduct-time behavior. Composed by `app-shell/01` (the staff arm of
role-aware nav).

## Tests
- Component: the switcher is present on staff surfaces and absent on participant paths.
- Integration: switching active exercise re-scopes staff queries.

## Delivered (Phase B2)
Built and tested on the B2 Wave-4 merges on `feature/identity-backend`: the COBRA staff exercise
switcher against the live `StaffAssignment` model (`GET /api/staff/assignments`,
`POST /api/staff/active-exercise`) — staff-surfaces-only, keyboard-operable, never on a participant
path. Switching re-scopes staff queries server-side and invalidates the relevant client query cache; the
"switching re-scopes staff queries" AC is met (server-enforced scope + query invalidation), with a
display-lag follow-up noted below. Both code-review gates (Gate-1, Gate-2) clean; umbrella green —
frontend `build:check` clean and the feature's suites green.

Tracked follow-ups (not blockers to Complete):
- **The conduct-time static-badge gate (D5-012(g)) is not yet enforced by this story** — it is
  `console-shell/03`'s build (Not Started), which this story's Out of Scope already carves out. Until
  `console-shell/03` lands, the switcher does not itself suppress during live conduct; content isolation
  is unaffected (this is a staff-chrome sequencing gap, not an isolation leak).
- **`ExerciseContextProvider` has no refetch.** After a switch, other `useExerciseContext()` consumers
  (e.g. `StaffHeader`) lag until remount — the switch itself is server-enforced and query-invalidated
  correctly, but a stale display can persist in a sibling consumer until it next mounts/refetches. NOT an
  isolation leak (the server-side scope and query invalidation are correct); tracked as a post-B2
  follow-on to add a refetch/subscribe path to the provider.

Markdown status flipped to Complete. Not closing the GitHub issue — it closes when the umbrella→main
PR merges.
