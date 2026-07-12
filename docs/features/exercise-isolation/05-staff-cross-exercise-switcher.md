# Story: Staff cross-exercise switcher (staff-only)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-005  ·  **Design decisions:** D5-012(g)  ·  **Issue:** #48

## Context
Staff (controllers/evaluators) may hold assignments across multiple exercises, with an explicit
exercise switcher on **staff surfaces only** (COR-005). The D5 review refined this: during **live
conduct** the console shows a **static identity badge**, not a switcher — switching is a pre-conduct
action (D5-012(g), expressed in `console-shell/03`).

## Acceptance Criteria
- [ ] Given a staff member with assignments in multiple exercises, when they use a staff surface, then
      an explicit exercise switcher lets them change active exercise (pre-conduct).
- [ ] The switcher appears **only** on staff surfaces (dark COBRA chrome) — never on any participant
      path (XC-002); it is impossible to confuse with a participant view.
- [ ] During live conduct the console presents a **static identity badge** (per D5-012(g)); switching
      is a pre-conduct concern (see console-shell/03).
- [ ] Switching active exercise re-scopes all staff queries to the newly selected exercise (built on
      story 01).

## Out of Scope
The conduct-time static badge UI itself (console-shell/03); staff assignment management (StaffAssignment
model); participant routing (story 04).

## Technical Notes
Staff world (COBRA). The active-exercise selection drives the scoping context for staff queries. Note
the conduct-time amendment (D5-012(g)) lands in console-shell. See implementation.md (story 05).

## Dependencies
Story 01 (scoping); StaffAssignment (identity-auth-roles); console-shell/03 for conduct-time behavior.

## Tests
- Component: the switcher is present on staff surfaces and absent on participant paths.
- Integration: switching active exercise re-scopes staff queries.
