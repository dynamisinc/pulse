# Story: Participant admin panel (login triage)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started (scope partly taken up by [`easy-login`](../easy-login/feature.md); see the scope update below)
**Requirements:** COR-017  ·  **Design decisions:** none  ·  **Issue:** #65

## Context
The first 30 minutes of every StartEx is login triage — it cannot require a support ticket.
**Controllers** (not just OrgAdmins) can reset passwords, unlock accounts, force-logout sessions,
reassign roles/org affiliations mid-exercise, and diagnose "wrong account" situations from the staff
console, audit-logged (COR-017). (D5 flags this as a candidate console toolstrip tool.)

## Scope update (2026-10-13): part of this is now built by `easy-login`

Tom's StartEx login-triage decisions (the Tue 10/20 demo) produced the [`easy-login`](../easy-login/feature.md)
feature, which implements the part of this story that the new sign-in model needs. **This story stays Not
Started**: it keeps what `easy-login` does not cover, and the ACs below are not ticked by that feature.

| AC below | Taken up by `easy-login` | Still on this story |
|---|---|---|
| Reset a password | Reissue a participant's personal link, or rotate the exercise's day word (a participant on the new paths has no password): `easy-login/03`, `/05`, `/10`, `/11` | Password reset for legacy password accounts |
| Unlock an account | Not needed on the new paths (no per-account lockout, EL-9) | Lockout/unlock for password accounts (`Account.LockedOutUntil` is still reserved) |
| Force-logout a session | Revoke link, reissue link and disable-the-person all end the participant's live sessions and report the count: `easy-login/03`, `/10` | Force-logout of a single session by id |
| Reassign role/org affiliation | Re-importing a corrected roster CSV updates agency, role and the org-persona binding in place: `easy-login/02`, `/10` | A single-participant edit form |
| Diagnose "wrong account" | The roster table shows each person's persona binding, last sign-in, live sessions and link state: `easy-login/10` | A guided "who is this person signed in as" view |
| Audit-logged, staff-only, exercise-scoped, keyboard-operable | `easy-login/02, 03, 05, 10` (XC-004 events with staff role + acting human; controller/planner only) | |

The roster screen at `/staff/participant-admin` is the "full participant-admin surface" the staff-shell flyout
(`staff-shell/03`) has been waiting for. Wiring the flyout's footer link and its live data to it is a follow-up
outside `easy-login`.

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

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §3.3, §2.2, §8.2. Wave A2. **This story's scope moves from "login triage" to the people/roster
scope**; it is partly taken up by `easy-login` and by the new A2 stories 19-23.

- [ ] **Participant reset is a roster action.** Given a planner or controller (never evaluator) on a roster row,
      when they choose "Reset password", then a reset link is emailed (story 21); for a participant with no
      email, a one-time temporary password is shown once, works for one sign-in and forces a change.
- [ ] **Unlock, force-logout, reassign role/affiliation** act on the participant's `Enrollment`/`Account`
      within the caller's exercise only; foreign-exercise and foreign-org ids return the bare 404.
- [ ] **Staff never see or choose another person's password.**
- [ ] Every action is audit-logged (XC-004) with the acting `PersonId` and role.
- [ ] User guide: `docs/guide/planner-guide.md` and `controller-guide.md` updated in the same PR.

Out of scope here: the org directory UI (19), staff invite (20), sign-in methods (22).
