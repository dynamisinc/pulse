# Story: Preview-as-participant

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-041  ·  **Design decisions:** none  ·  **Issue:** #72

## Context
At any point during Build/Staged, staff can open a full **participant-perspective preview** of the
world as it will appear at a chosen moment (at platform-open, at StartEx) — the design-review tool for
the fiction (COR-041).

## Acceptance Criteria
- [ ] Staff can open a participant-perspective preview of the world at a chosen moment (platform-open /
      StartEx / a chosen scenario time).
- [ ] The preview renders the participant world faithfully (skins, scenario time per COR-053, no staff
      chrome) without publishing anything or affecting participant sessions.
- [ ] Preview is staff-only (XC-002) and clearly labelled as a preview so it is not mistaken for live
      conduct.
- [ ] The preview respects exercise scoping (exercise-isolation) — it only shows this exercise.

## Out of Scope
The build workspace authoring (story 01); the readiness dashboard (story 03); editing from within the
preview.

## Technical Notes
Staff-invoked participant-world render at a chosen scenario time; read-only, non-publishing. See
implementation.md (story 02).

## Dependencies
Story 01 (content to preview); the participant surfaces (E2 now); scenario-time rendering (COR-053).

## Tests
- Component/integration: preview renders the participant world at a chosen moment without publishing or
  touching live sessions.
