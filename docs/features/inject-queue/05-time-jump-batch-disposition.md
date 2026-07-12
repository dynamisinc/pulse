# Story: Scenario-time-jump batch disposition (pause-first)

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-015  ·  **Design decisions:** D5-014/P4  ·  **Issue:** #23

## Context
When a Director jumps scenario time ("it is now D+3, 0800", COR-051), the queue must dispose of the
content in the skipped span. The D5 review **amended** the workflow: a time-jump **requires a pause
first**, and the jump dialog performs a **batch disposition** of the spanned injects. Guarding the
jump behind a pause prevents an accidental mass-fire during live conduct.

> **Amendment (D5-014/P4).** Before: time-jump available during conduct. After: time-jump **requires
> pause first**; the dialog does batch disposition of spanned injects (fire all / fire + hold rumor
> wave / skip all).

## Acceptance Criteria
- [ ] Given live conduct, when a controller initiates a scenario-time jump, then the action is
      **blocked unless the world is paused** (world-steering CTL-023) — the UI requires pause first.
- [ ] Given a paused world and a target scenario time, when the controller confirms the jump, then a
      batch-disposition dialog lists the injects in the skipped span and offers **fire all** /
      **fire + hold rumor wave** / **skip all** (per COR-051: fire-as-backfill / skip / re-schedule).
- [ ] Fired-as-backfill items publish with **backdated scenario timestamps** so feeds render them in
      correct scenario order (COR-051/053).
- [ ] The jump and its disposition choice are logged as controller/Director actions (XC-004); the
      operation is staff-only (XC-002) and exercise-scoped (COR-001).
- [ ] The jump dialog is keyboard-operable and its options are labelled, not color-coded only
      (NFR-001).

## Out of Scope
The clock/jump mechanics themselves (E1 COR-051); the pause tiers (world-steering CTL-023 — this
depends on them); engine timer re-evaluation on jump (E8 ADP-001 handles its own re-evaluation).

## Technical Notes
Staff world (COBRA). Depends on the tiered-pause state (CTL-023) — the jump control is disabled until
paused. Batch disposition reuses the fire/skip/reschedule actions (story 02). See implementation.md
(story 05).

## Dependencies
world-steering CTL-023 (tiered pause — jump requires pause); E1 clock/jump (COR-051); story 02 (fire/
skip). Ticks STORY-UPDATES.md §A **CTL-015**.

## Tests
- Component (RTL): the jump control is disabled until the world is paused.
- Unit: "fire all" backdates spanned injects to correct scenario order; "skip all" marks them skipped.
- Unit: the jump + disposition choice are logged.
