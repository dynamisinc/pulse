# Story: Exercise lifecycle state machine

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032  ·  **Design decisions:** none  ·  **Issue:** #69

## Context
The exercise lifecycle: **Build → Staged → Live → Paused → Completed (EndEx) → Archived** (COR-032).
Build is staff-only content development; Staged opens participant access to the ambient world before
the scenario starts; Live is post-StartEx with the clock running; Paused shows a configurable holding
page. Participants access Staged and Live only.

## Acceptance Criteria
- [ ] The exercise has a lifecycle status with the states Build / Staged / Live / Paused / Completed /
      Archived and defined allowed transitions.
- [ ] Participants can access **Staged** and **Live** only; Build/Completed/Archived are not
      participant-accessible; **Paused** shows a configurable holding page (in-fiction or out-of-fiction).
- [ ] Each state defines subsystem behavior hooks (e.g. Staged: clock not started, scheduled content
      held) that other features read (build/go-live, clock, engine).
- [ ] Lifecycle transitions are staff/Director actions, logged (XC-004), and gated (see build/go-live
      COR-043).

## Out of Scope
The gated go-live/StartEx actions themselves (exercise-build-golive COR-043); the clock (exercise-clock
COR-050); the holding-page content authoring; EndEx specifics (exercise-clock COR-054).

## Technical Notes
Foundation state machine other features subscribe to. Staged vs Live is the key distinction. See
implementation.md (story 03).

## Dependencies
Story 01; consumed by exercise-build-golive (transitions), exercise-clock (Live starts clock), E8
(dormant until Live).

## Tests
- Unit: allowed transitions enforced; participants blocked outside Staged/Live; Paused shows holding
  page.
