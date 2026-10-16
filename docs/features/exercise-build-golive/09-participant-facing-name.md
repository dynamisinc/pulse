# Story: Participant-facing exercise name (#180 / #376)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032, COR-053, SOC-001 (+ #180, #376)  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §8.4  ·  **Issue:** —
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation, information leak)  ·  **Wave:** A3

## Context
The internal exercise name can leak the scenario (for example "HURREX-26 Cat 4 Landfall Dry Run"). Participants must only see a deliberate in-fiction name, with **no fallback** ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §8.4). Covers #376.

## Acceptance Criteria
- [ ] `Exercise.ParticipantName` (nullable, 80 characters max) is editable by the planner in settings.
- [ ] `ExerciseScopeDto.exerciseName` projects `ParticipantName` and **never falls back to the internal `Name`**; when unset it is null and participants see no exercise name (the brand header stands alone). Same field name and shape (frozen type, source change cleared by the orchestrator).
- [ ] Cards, link/invite/reset emails and the join page use the same projection; none can contain the internal name.
- [ ] Readiness blocking item 2: stage is refused until `ParticipantName` is set (story 03).
- [ ] A projection test walks every participant DTO and email template asserting the internal `Name` never appears.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Scenario time / two worlds: the name appears in the participant brand header in the exercise skin; no COBRA, no default MUI look.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` and `participant-guide.md` updated in the same PR.

## Out of Scope
Per-persona display names; localisation.

## Technical Notes
Both worlds. Paths: `Exercise` entity, `ExerciseScopeDto`, settings panel (COBRA), participant brand header. Migration is A3's (`Exercises.ParticipantName`).

## Dependencies
Wave A3, after A1; can run with 07, 08. Readiness item consumed by 03.

## Tests
Projection leak test; readiness test; RTL for header with and without name; foreign-exercise/org tests.
