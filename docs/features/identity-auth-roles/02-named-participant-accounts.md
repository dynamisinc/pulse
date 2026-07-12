# Story: Named participant accounts (provisioned, no self-signup)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011  ·  **Design decisions:** none  ·  **Issue:** #59

## Context
Active roles — anyone who posts, publishes, or DMs (PIOs, comms players) — get **exercise-provisioned
named accounts** (bulk import or planner-created). There is **no self-registration** on participant
paths, and fake sign-up UI theater is omitted normatively (phishing-pattern optics on a government
training site) (COR-011).

## Acceptance Criteria
- [ ] Planners can provision named participant accounts by bulk import (CSV, mirroring Cadence's bulk
      import) or individually.
- [ ] There is **no self-registration** on any participant path, and **no fake sign-up UI**.
- [ ] A provisioned account belongs to exactly one exercise (COR-004) and carries its role(s).
- [ ] Provisioning is a staff/planner action (staff world), never participant-facing (XC-002).

## Out of Scope
Read-only shared access (story 06); sessions (story 03); org-account grants (story 09); the login page
theming (exercise-configuration COR-030).

## Technical Notes
Staff-world provisioning + participant login. CSV import mirrors Cadence's UX. See implementation.md
(story 02).

## Dependencies
Story 01 (roles); exercise-isolation (one-exercise accounts). Feeds participant login (exercise-isolation
story 04).

## Tests
- Integration: CSV import creates scoped accounts; no self-registration endpoint exists on participant
  paths.
