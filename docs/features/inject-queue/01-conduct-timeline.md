# Story: Conduct timeline with item status

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-010  ·  **Design decisions:** none  ·  **Issue:** #19

## Context
The controller's left-hand rail: a conduct timeline listing pre-authored Pulse content (posts,
and later articles/releases/weather products) in scheduled order with status — pending / ready /
fired / skipped / held — mirroring Cadence's MSEL conduct vocabulary so a Cadence-trained controller
reads it immediately (CTL-010). Synced to the native exercise clock (COR-050).

## Acceptance Criteria
- [ ] Given scheduled Pulse content, when the console renders, then the timeline lists items in
      scheduled scenario-time order, each showing its status (pending / ready / fired / skipped /
      held) and its target channel/persona.
- [ ] The timeline is synced to the native exercise clock (COR-050): the "now" marker and each item's
      scheduled time render in **scenario time** in the exercise time zone (COR-053), with wall-clock
      available to staff as secondary (dual time).
- [ ] Status is conveyed by label/icon, **not color alone** (NFR-001), and the timeline is
      keyboard-navigable.
- [ ] The timeline is scoped to the **active exercise** (COR-001) and is staff-only (XC-002).
- [ ] In Phase 1 the timeline covers the Social channel; the model accommodates other channels as
      E4/E5/E6 land (no channel is hard-coded out).

## Out of Scope
The fire/hold/skip/edit actions (story 02); the native scheduler that populates it (story 03);
bursts (story 04); time-jump disposition (story 05); Cadence-sourced items (CTL-012, Phase 4).

## Technical Notes
Staff world (COBRA). A continuous-watch rail surface mounted in console-shell. Reads a queue model
keyed by exercise + scenario time. See implementation.md (story 01).

## Dependencies
console-shell (rail host); E1 native clock + lifecycle (COR-050/032); the scheduler (story 03)
populates items. Backend-contract seam for the queue.

## Tests
- Component (RTL): items render in scenario-time order with status label+icon (not color-only).
- Unit: the "now" marker and item times format in scenario time; the list is exercise-scoped.
