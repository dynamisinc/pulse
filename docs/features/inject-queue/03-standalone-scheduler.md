# Story: Standalone native scheduler ("hold for conduct")

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-013  ·  **Design decisions:** none  ·  **Issue:** #21

## Context
Exercises not driven by Cadence need to author scenario content ahead of time and have it land in the
queue. Controllers author content in the channel composers (Phase 1: the E2 social composer / persona
composer) with a **"hold for conduct"** flag; those items schedule against the **native exercise
clock** (COR-050) and appear in the conduct timeline (CTL-013). This is the standalone path (the
Cadence-sourced path is CTL-012, Phase 4).

## Acceptance Criteria
- [ ] Given the social/persona composer, when the controller marks content "hold for conduct" with a
      scheduled scenario time, then the item is created in a held/scheduled state and appears in the
      conduct timeline (story 01) at that time — not published immediately.
- [ ] Scheduling is expressed in **scenario time** against the native clock (COR-050/053); the item
      fires (or is offered to fire) when the clock reaches its time.
- [ ] Held/scheduled content is staff-only and unpublished until fired (COR-040 build-state) and is
      scoped to the active exercise (COR-001).
- [ ] Scheduled items can be edited or rescheduled before firing (feeds edit-then-fire, story 02).

## Out of Scope
The Cadence-driven queue source (CTL-012, Phase 4/E9); firing mechanics (story 02); bursts (story 04);
non-social channel composers (Phase 3).

## Technical Notes
Staff world (COBRA). Adds the "hold for conduct" affordance + scheduled scenario time to the composer;
writes a scheduled queue item. Reuses the E2 composer. See implementation.md (story 03).

## Dependencies
Story 01 (timeline target); E1 native clock (COR-050) + build/staged lifecycle (COR-040/032); the E2
composer. Populates the timeline.

## Tests
- Unit: "hold for conduct" creates a scheduled (not published) item at the given scenario time.
- Unit: rescheduling updates the item's scenario time; the item stays unpublished until fired.
