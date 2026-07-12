# Story: Expected-action tracking (fired-vs-responded)

**Feature:** Live monitoring  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-032  ·  **Design decisions:** none  ·  **Issue:** #32

## Context
Where content carries an expected action (from native authoring now, Cadence inject data later),
controllers see **fired-vs-responded** at a glance — the trigger for "they missed it, escalate"
decisions (CTL-032). Manual now; E8 automates the escalation later.

## Acceptance Criteria
- [ ] Given inject/content that carries an expected action, when it has fired, then the console shows
      its **fired-vs-responded** state (awaiting response / responded / overdue) at a glance.
- [ ] "Responded" is satisfied by a matching official on-platform response **or** an off-platform
      marker (world-steering CTL-026); an unmet expectation past its window shows as overdue.
- [ ] Overdue/awaiting/responded is conveyed by label/icon, **not color alone** (NFR-001), in
      scenario time (COR-053).
- [ ] Tracking is scoped to the active exercise (COR-001), staff-only (XC-002); state changes are
      logged (XC-004).

## Out of Scope
Automated escalation on a miss (E8 ADP-006, Phase 4); Cadence-sourced expected-action data (CTL-012/
E9, Phase 4); the queue-pressure meter (story 04).

## Technical Notes
Staff world (COBRA). Reads expected-action fields on queue items + response-match state (shared with
E8 ADP-002a / off-platform marker CTL-026). See implementation.md (story 03).

## Dependencies
inject-queue (fired state, expected-action authoring); world-steering CTL-026 (off-platform satisfies
expectation); console-shell. Feeds the trainee monitor (console-shell story 05).

## Tests
- Unit: an off-platform marker flips an expectation to responded; an unmet window flips to overdue.
- Component (RTL): fired-vs-responded renders with label+icon (not color-only).
