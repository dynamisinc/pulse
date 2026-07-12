# Story: Fire / hold / skip / edit-then-fire (single + batch)

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-011  ·  **Design decisions:** none  ·  **Issue:** #20

## Context
The controller drives the queue: fire, hold, skip, or edit-then-fire each item, singly or in batch
(CTL-011). Firing captures dual time (wall + scenario), the Cadence convention. Edit-then-fire lets a
controller adjust an item to the moment before it lands.

## Acceptance Criteria
- [ ] Given a queue item, when the controller fires it, then its content publishes through the
      relevant channel pipeline (Phase 1: E2 social) and the item moves to **fired**, capturing both
      wall-clock and scenario timestamps.
- [ ] Hold and skip move an item to **held** / **skipped**; a held item can later be fired or skipped.
- [ ] Edit-then-fire opens the content in its composer, and firing publishes the edited version;
      edited content is sanitized before publish (NFR-004).
- [ ] Batch fire/hold/skip apply to a multi-select and report per-item outcome (partial failures are
      surfaced, not silent).
- [ ] Every fire/hold/skip/edit is logged as a controller action (XC-004) with dual time; the queue
      is staff-only (XC-002) and scoped to the active exercise (COR-001).
- [ ] The fire path has zero modal friction and is keyboard-operable (CTL-034 budget, NFR-001).

## Out of Scope
The timeline rendering (story 01); burst bundles (story 04); time-jump batch disposition (story 05);
Cadence-locked items' fire-lock (CTL-012/INT-005, Phase 4).

## Technical Notes
Staff world (COBRA). Fire publishes via the channel pipeline (E2 for social) — reuse it, don't fork.
Edit-then-fire reuses the persona/composer path. See implementation.md (story 02).

## Dependencies
Story 01 (timeline); the E2 publish pipeline; the telemetry emitter (XC-004). Backend-contract seam
for fire/publish.

## Tests
- Unit: a fire records dual time and moves item state pending→fired; hold/skip transitions.
- Unit: edited content is sanitized before publish.
- Component (RTL): batch fire reports per-item outcomes including a simulated partial failure.
