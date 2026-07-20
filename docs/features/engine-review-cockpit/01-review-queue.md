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
- [ ] The queue is a **continuous-watch** rail surface (console-shell) and exposes its own **inline
      pending/held count** ("N need review / N timers <60s") as the single D5-014/2.1 source of truth;
      console-shell/02's NEEDS-YOU bar (not yet built) and the queue-pressure meter read from it once
      wired, rather than each recomputing it.
- [ ] Every queue action is logged with its trigger + storyline (ADP-041/XC-004); the queue is
      staff-only (XC-002) and exercise-scoped (COR-001); keyboard-operable (NFR-001).

## Out of Scope
The engine that generates drafts (E8, Phase 2); the timeout/auto-HOLD behavior (story 02); swamped
mode (story 03); the kill switch (ADP-042, Phase 2).

## Technical Notes
Staff world (COBRA). Continuous-watch rail in console-shell. Approve/edit publishes via the E2 pipeline
(reuse). Pending/held count is this story's own `useReviewQueue()` hook — **not** `useToDos`
(console-shell/02's NEEDS-YOU bar is not built yet; it will consume this hook once it lands). See
implementation.md (story 01).

## Dependencies
console-shell (continuous-watch rail hosting — the permanent-column dock point in
`ControllerConsole`'s work area does not exist yet; wiring it is an orchestrator-owned integration
seam, not this story, see implementation.md); E2 publish pipeline; E8 drafts (Phase 2; mock now);
telemetry / engine-action log (ADP-041).

## Tests
- Component (RTL): a queue item shows persona + storyline context and the four actions; batch approve
  reports per-item outcomes.
- Unit: approve publishes as the persona; edit sanitizes; veto discards; each action is logged.
