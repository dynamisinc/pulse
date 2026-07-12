# Story: NEEDS-YOU action bar — locate & highlight, never act

**Feature:** Console shell  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** console UI architecture (D5)  ·  **Design decisions:** D5-010, D5-012(d)  ·  **Issue:** #10

## Context
A single controller running a whole world needs to know what actually needs them *right now* without
the console taking actions on their behalf. The NEEDS-YOU bar names current to-dos (drafts held for
review, expiring timers, unmatched official content prompts) and its chips **locate and highlight**
the target — but they **never execute**. This is a safety property: no action-at-a-distance; nothing
fires without an explicit Fire/Approve press on the target surface.

## Acceptance Criteria
- [ ] Given outstanding to-dos, when the console renders, then a persistent NEEDS-YOU bar lists them
      (e.g. "3 drafts held", "1 timer under 60s", "does this address #WaterIssues?").
- [ ] When the controller clicks a chip, then the console navigates to and **highlights** the target
      (amber ring) — and performs **no** other action (no fire, no approve, no send).
- [ ] The only way any queued item acts is an explicit press on its own control (Fire/Approve/Veto) —
      verified: activating a chip never mutates world state.
- [ ] The bar's counts **agree with the source surfaces** (the review queue's pending count, the
      timer count) — a single source of truth, not a divergent tally (D5-014/2.1).
- [ ] The bar is keyboard-navigable and its severity is not color-only (NFR-001); it is staff-only
      (XC-002).

## Out of Scope
The surfaces the chips point at (review queue, inject queue, response-match prompt — their own
stories); auto-acting on any to-do (explicitly forbidden).

## Technical Notes
Staff world (COBRA). Reads a derived "to-dos" selector composed from the review queue, timers, and
response-match prompts — it holds no independent state that could drift. Highlight is a shared
"reveal target" primitive reused by other surfaces. See implementation.md (story 02).

## Dependencies
Story 01 (shell); engine-review-cockpit (drafts/timers feed the bar); world-steering/inject-queue
(fire targets). Enforces the interaction-safety contract across E7.

## Tests
- Component (RTL): clicking a chip highlights the target and dispatches no mutating action.
- Unit: NEEDS-YOU counts are derived from the same source as the queue/timer surfaces (no drift).
