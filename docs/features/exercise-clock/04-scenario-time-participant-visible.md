# Story: Scenario time is the participant-visible time

**Feature:** Exercise clock & scenario-time model  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-053  ·  **Design decisions:** none  ·  **Issue:** #80

## Context
The cross-cutting rule the whole product obeys: **scenario time is the participant-visible time.** All
in-fiction surfaces — post timestamps, "2h ago" relative times, article datelines, weather products,
portal dateline — render in scenario time in the exercise's time zone. Wall-clock time is captured in
telemetry (XC-004) but **never shown inside the fiction** (COR-053).

## Acceptance Criteria
- [ ] A shared scenario-time formatting utility renders absolute times, datelines, and relative times
      ("2h ago") in scenario time in the exercise time zone.
- [ ] Every participant-visible time uses this utility; a review/lint guard flags any wall-clock time
      rendered on a participant surface (enforced by `code-review`).
- [ ] Backdated content (persona-management COR-023) and post-jump backfills (story 02) render
      consistently under this rule.
- [ ] Wall-clock is available to staff (dual time) and telemetry, never in the participant fiction.

## Out of Scope
The individual surfaces' rendering (each channel uses the utility); staff dual-time display (E7).

## Technical Notes
Foundation utility consumed by every participant surface. This is the single most-reused time contract
in the product — put it in `core`. See implementation.md (story 04).

## Dependencies
Story 01 (clock); exercise-configuration (TZ). Consumed by E2/E3/E4/E5/E6 rendering and persona-management
backdated history.

## Tests
- Unit: absolute/relative/dateline formatting in scenario time + exercise TZ; no wall-clock leak; a
  backdated + a backfilled item render in correct scenario order.
