# Story: Engine review queue

**Feature:** Engine review cockpit  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** ADP-040  ·  **Design decisions:** none  ·  **Issue:** #34

## Context
The cockpit the adaptive engine (E8, Phase 2) lands into. A review queue of suggested/delayed content
with **approve / edit / veto / re-roll** actions, **batch approve**, and per-item **persona +
storyline context** (ADP-040). It **ships in Phase 1** (engine-first, CTL-022) so the engine arrives
to a ready surface; in Phase 1 it is exercised with mock drafts.

## Acceptance Criteria
- [ ] Given engine-drafted (or mock) content, when the console renders the review queue, then each
      item shows its **persona** and **storyline** context and offers **approve / edit / veto /
      re-roll**.
- [ ] **Batch approve** applies to a multi-select and reports per-item outcome.
- [ ] Approve publishes the draft through the normal channel pipeline (E2) authored by its persona;
      edited drafts are sanitized before publish (NFR-004); veto discards; re-roll requests a new draft.
- [ ] The queue is a **continuous-watch** rail surface (console-shell) and its pending count is the
      single source shared by the NEEDS-YOU bar and the queue-pressure meter (D5-014/2.1).
- [ ] Every queue action is logged with its trigger + storyline (ADP-041/XC-004); the queue is
      staff-only (XC-002) and exercise-scoped (COR-001); keyboard-operable (NFR-001).

## Out of Scope
The engine that generates drafts (E8, Phase 2); the timeout/auto-HOLD behavior (story 02); swamped
mode (story 03); the kill switch (ADP-042, Phase 2).

## Technical Notes
Staff world (COBRA). Continuous-watch rail in console-shell. Approve/edit publishes via the E2 pipeline
(reuse). Pending count exposed to `useToDos`. See implementation.md (story 01).

## Dependencies
console-shell (rail + NEEDS-YOU source); E2 publish pipeline; E8 drafts (Phase 2; mock now); telemetry
/ engine-action log (ADP-041).

## Tests
- Component (RTL): a queue item shows persona + storyline context and the four actions; batch approve
  reports per-item outcomes.
- Unit: approve publishes as the persona; edit sanitizes; veto discards; each action is logged.
