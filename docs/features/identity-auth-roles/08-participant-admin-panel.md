# Story: Participant admin panel (login triage)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-017  ·  **Design decisions:** none  ·  **Issue:** #65

## Context
The first 30 minutes of every StartEx is login triage — it cannot require a support ticket.
**Controllers** (not just OrgAdmins) can reset passwords, unlock accounts, force-logout sessions,
reassign roles/org affiliations mid-exercise, and diagnose "wrong account" situations from the staff
console, audit-logged (COR-017). (D5 flags this as a candidate console toolstrip tool.)

## Acceptance Criteria
- [ ] From the staff console, a controller can reset a participant's password, unlock an account,
      force-logout a session, and reassign role/org affiliation mid-exercise.
- [ ] Every admin action is **audit-logged** (XC-004) with the acting controller and target.
- [ ] The panel is staff-only (XC-002), exercise-scoped (COR-001), and keyboard-operable (NFR-001).
- [ ] A "wrong account" diagnosis path helps a controller identify and fix a participant's login state.

## Out of Scope
The toolstrip host that will surface this (console-shell); OrgAdmin-level org management; the shared
credential (story 07).

## Technical Notes
Staff world (COBRA). A candidate console flyout (D5 backlog). Actions operate on accounts/sessions from
stories 02/03. See implementation.md (story 08).

## Dependencies
Stories 01/02/03; exercise-isolation; console-shell (future host). Audit via telemetry.

## Tests
- Integration: reset/unlock/force-logout/reassign work and are audit-logged; panel is staff-only.
