# Story: Suggest + Delayed-auto autonomy levels

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP §2.3 (v1 subset)  ·  **Design decisions:** none  ·  **Issue:** #169

## Context
The engine runs at a controller-chosen autonomy level, per exercise and per-storyline overridable
(epic §2.3). v1 ships two: **Suggest** (drafts land in the review queue; nothing publishes without
approval) and **Delayed-auto** (drafts publish after a scenario-time countdown unless a controller
vetoes — keeps pace without constant attention). **Auto** is v1.1 (out of scope here). The level is
what the reaction-loop's generate→review stage routes on.

## Acceptance Criteria
- [ ] Given an exercise, when the lead controller sets the engine autonomy level, then it is one of
      **Suggest** or **Delayed-auto** (v1), stored per exercise and overridable per storyline.
- [ ] Given **Suggest**, when a burst is ready, then it lands in the review queue (engine-review-cockpit
      #34) and nothing publishes without an explicit approve.
- [ ] Given **Delayed-auto**, when a burst is ready, then it publishes after a **scenario-time**
      countdown unless a controller vetoes within the window; on timeout it auto-HOLDs (story 02).
- [ ] Given a per-storyline override, when set, then that storyline uses its level regardless of the
      exercise default.
- [ ] Given autonomy changes, when a controller makes one, then it is **only** ever a human toggle —
      the engine never sets or raises its own level (the self-escalation invariant); changes are
      logged (XC-004, staff-only XC-002).

## Out of Scope
Auto mode (auto-mode feature, v1.1); the auto-HOLD timeout behavior (story 02); the kill switch
(story 03); the workload contract (story 04); the review-queue UI (engine-review-cockpit #34).

## Technical Notes
Staff. Autonomy level is per-exercise state with per-storyline overrides, read by reaction-loop
story 03 to route drafts. Delayed-auto countdown runs in scenario time (COR-050). See
implementation.md (story 01) and architecture §8.1.

## Dependencies
reaction-loop story 03 (routes on the level); engine-review-cockpit #34 (Suggest target); E1 roles
(lead-controller sets it); E1 clock (countdown). Story 02 (the timeout terminal action).

## Tests
- Unit: level is Suggest or Delayed-auto, per-exercise with per-storyline override; Suggest queues,
  Delayed-auto publishes on countdown unless vetoed.
- Unit: the engine cannot set/raise its own level; changes log.
