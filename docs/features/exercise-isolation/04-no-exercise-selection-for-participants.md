# Story: Participants have no exercise-selection concept

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-004  ·  **Design decisions:** none  ·  **Issue:** #47

## Context
Participants never choose or perceive an exercise. Login lands directly in their exercise's landing
surface (the Social feed in pilot mode, the Portal in Phase 3), and an account belongs to exactly one
exercise (COR-004, XC-002).

## Acceptance Criteria
- [ ] Given a participant credential, when they log in, then they land directly in their exercise's
      landing surface — no exercise picker, no exercise list, no simulation-status or admin surface.
- [ ] A participant account belongs to exactly one exercise; there is no UI path to switch exercises.
- [ ] In pilot mode (pre-Portal) the landing surface is the Social feed (Master §4); the story does not
      hard-code the Portal.
- [ ] No participant-facing surface exposes the concept of exercise selection, simulation status, or
      platform administration (XC-002).

## Out of Scope
The staff switcher (story 05); the actual landing surfaces (E2 feed / E3 portal); the login page
theming (exercise-configuration COR-030).

## Technical Notes
Participant world. Routing resolves the exercise from the session (per-exercise hostname, story 08) —
not from a user choice. See implementation.md (story 04).

## Dependencies
Story 08 (hostname scoping); auth/session (identity-auth-roles COR-012). Shapes every participant
entry point.

## Tests
- Component/integration: participant login routes straight to the landing surface with no exercise
  picker; no admin/status surface is reachable.
