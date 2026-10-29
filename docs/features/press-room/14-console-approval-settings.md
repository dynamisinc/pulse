# Story: Console approval-gate settings

**Feature:** Press Room  ·  **Epic:** E5 (with E7)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-021 (exercise configuration of the gate)  ·  **Design decisions:** D4-007 sign-off #1 (per-exercise routing, per-org defaults), off by default  ·  **Issue:** #750
**Stack:** frontend  ·  **World:** staff (COBRA)  ·  **Wave:** 5  ·  **Effort:** S

## Context
Exercise designers decide whether the approval chain is part of the exercise and who sits on it. This small settings panel configures the story-06 settings API; the gate itself is participant paper.

## Acceptance Criteria
- [ ] **Off by default.** Given a new exercise, then the panel shows "Require approval before participant releases publish: Off", and saving nothing leaves the gate off.
- [ ] **Per-exercise toggle and routing.** Given the toggle on, then the controller chooses the default approver (a participant role or a specific persona/human) for the exercise; the choice is saved with a version and a 409 shows a reload prompt.
- [ ] **Per-org overrides.** Given the org list, then each org can inherit the exercise default, use its own approver, or be exempt; the effective routing per org is shown as text.
- [ ] **Self-approval flag.** Given routing, then "Allow author to approve own release" exists, default off, with a one-line explanation of the evaluation impact.
- [ ] **Disclosure of effect.** Given the gate is on mid-exercise, then a confirm states that new releases will be held and already-scheduled embargoes are unaffected (matching story 06).
- [ ] **Staff only.** COBRA components, keyboard-operable, read-only roles see values but no controls, axe clean; no participant skin.

## Out of Scope
The approval UI (10), multi-stage chains, notification routing beyond the wire, general exercise-configuration surfaces (existing feature).

## Technical Notes
Files: `features/controller/pressSettings/**`; entry registered by the orchestrator in the staff route registry or as a panel under exercise configuration. Mock-first against `GET|PUT /api/press/settings`.

## Dependencies
Story 06 (mock until live); foundation F17 for placement conventions. Can run with 08–13.

## Tests
RTL for default-off, inherit/override display, 409 handling, role-gating.
