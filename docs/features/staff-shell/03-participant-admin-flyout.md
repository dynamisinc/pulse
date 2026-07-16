# Story: Participant-admin flyout (login triage)

**Feature:** Staff shell frame  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-017  ·  **Design decisions:** D7-007  ·  **Issue:** —

## Context
StartEx reality: 100+ variably tech-literate participants, and someone is locked out or on the wrong
account. The shell provides a **shell-global** toolstrip tool (top zone, story 02) — a 330px right
flyout of **login-triage rows**: name, role, a status chip (**LOCKED OUT / NO LOGIN YET / ACTIVE**),
and a quick action link, plus a link to the full participant-admin surface. It is shell-global because
every staff surface needs it (COR-017); a badge shows the pending count.

## Acceptance Criteria
- [ ] Given a staff surface, when the controller opens the participant-admin tool from the toolstrip's
      shell-global zone, then a 330px flyout lists participant rows with name, role, a **status chip
      (LOCKED OUT / NO LOGIN YET / ACTIVE — text + icon, never color-only)**, and a quick action, plus
      a link to the full admin surface.
- [ ] The toolstrip tool shows a **pending-count badge** (e.g. number locked out / not-yet-logged-in).
- [ ] Quick actions (e.g. unlock, resend) are **audit-logged** (XC-004) with actor + scenario time and
      are gated by role (COR-017); the flyout is **staff-only** (XC-002) and exercise-scoped (XC-001).
- [ ] The flyout renders within the staff frame (Cadence), keyboard-operable, and screen-reader
      labelled including the status chip and badge count (NFR-001).
- [ ] Actions that are Prohibited/irreversible from a safety view (e.g. password entry) are **not**
      performed here — the tool triages and links out; it never has the controller type a participant's
      password.

## Out of Scope
The **full** participant-admin surface (E1 identity-auth-roles `08-participant-admin-panel.md`,
COR-017 — this is the quick-triage flyout that links to it); the shared-credential lifecycle
(NFR-009); account provisioning.

## Technical Notes
Staff world (COBRA/Cadence). A shell-global tool registered in the toolstrip's top zone (story 02).
Reads participant session/login state (exercise-scoped); quick actions call the identity-auth-roles
admin API (contract seam; mock now). Uses `@/theme/styledComponents` (CobraLinkButton etc.). See
implementation.md (story 03).

## Dependencies
Toolstrip dock (story 02); E1 identity-auth-roles participant-admin API + roles (COR-017); telemetry
emitter (XC-004). Ticks STORY-UPDATES.md §A (D5 deferred COR-017 → now the shell's).

## Tests
- Component (RTL): flyout lists rows with name/role/status chip + action; badge shows pending count.
- Unit: a quick action is role-gated and logs actor + scenario time.
- Component (RTL): status chip is text+icon (not color-only); keyboard-operable.
