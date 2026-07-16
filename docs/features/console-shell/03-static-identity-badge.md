# Story: Static identity badge during conduct

**Feature:** Console shell  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-005  ·  **Design decisions:** D5-012(g), R-006 (presentation interim)  ·  **Issue:** #11

## Context
COR-005 lets staff hold assignments across exercises with an explicit exercise switcher on staff
surfaces. The D5 review refined this for **live conduct**: during conduct the console header shows a
**static identity badge** (the current exercise + controller), not a switcher — switching exercises
is a **pre-conduct** concern. This preserves COR-005's identity intent while removing a mid-conduct
foot-gun (accidentally operating the wrong world). The E1 COR-005 requirement/story should carry the
same clarification.

> **Interim — superseded by D7 shell (R-006).** The exercise identity block is inventoried improvised
> chrome (`docs/design/COMPONENTS.md`, D5 `.exsw`) — its header placement/presentation here is
> interim; the D7 unified-shell session defines the shell's identity chrome. The **behavior stands**:
> static during conduct, switching pre-conduct. Related gap: participants have **no** exercise
> identity at all (COMPONENTS.md divergence #5) — tracked as
> `exercise-configuration/05-participant-exercise-identity.md`, a D7 input.

## Acceptance Criteria
- [ ] Given an exercise in live conduct, when the console renders, then the shell shows a **static**
      identity badge (exercise name + controller identity) with **no** exercise switcher control
      *(header placement/presentation: interim — superseded by D7 shell, R-006)*.
- [ ] Given a pre-conduct state (Build/Staged), when a controller with multiple assignments opens the
      console, then exercise switching is available (COR-005) — switching is a pre-conduct action.
- [ ] The badge unambiguously identifies which exercise the controller is operating, in the staff
      (dark COBRA) chrome so it is never confusable with a participant view (XC-002).
- [ ] The badge is keyboard-focusable and screen-reader labelled (NFR-001).

## Out of Scope
The full exercise-switcher UX and the E1 assignment model (COR-005 in E1); mid-conduct role/account
reassignment (COR-017 participant admin, a later toolstrip tool).

## Technical Notes
Staff world (COBRA). Reads the active-exercise + lifecycle state (COR-032/050) to decide static vs
switchable. Note in the E1 backlog that COR-005 is amended by D5-012(g). See implementation.md
(story 03).

## Dependencies
E1 exercise-context, staff assignments, and lifecycle state (COR-005/032). Story 01 (shell header).

## Tests
- Component (RTL): in a Live exercise the header renders a static badge and no switcher.
- Component (RTL): in Build/Staged a multi-assignment controller sees the switcher.
