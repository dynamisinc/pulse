# Story: Live annotation capture (≤10 seconds)

**Feature:** Live evaluator tools — storyline board & annotation capture  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-020  ·  **Design decisions:** D6-003  ·  **Issue:** #235

## Context
EVL-020 wants evaluators to bookmark/tag any timeline moment or content item with a note and
category (e.g., "strong correction," "missed rumor") — capturing judgment in the moment, the
"Cadence-photo-capture philosophy applied to the info environment." D6-003 gives the exact
interaction: any card/tile/row carries a ⚑ affordance; the **B** key opens the same **one popover**
anywhere with a **context-derived anchor** (no modal); the popover holds a focused note field and
category chips **STRENGTH/IMPROVEMENT/OBSERVATION** on keys **1–3**; **Enter** saves, **Esc**
cancels; the whole path is measured at **≤10 seconds**. See `docs/10-evaluation-aar.md` F10.3 and
`feature.md`.

## Acceptance Criteria
- [ ] Given any card/tile/row on the Live, Timeline, Replay, or Metrics views, when the evaluator
      presses the **B** key (while not focused in a text field) or clicks a ⚑ affordance, then one
      popover opens — not a modal — anchored to the current context (e.g. "Replay · 15:03 scenario"
      or "#WaterIssues board tile · 14:46") — per D6-003.
- [ ] Given the annotation popover, when it opens, then the note field is auto-focused and empty,
      ready for typing immediately with no extra click required.
- [ ] Given the annotation popover, when the evaluator presses **1**, **2**, or **3**, then the
      category selection switches to STRENGTH / IMPROVEMENT / OBSERVATION respectively and the
      corresponding chip highlights as active — per D6-003.
- [ ] Given the annotation popover with a note typed, when the evaluator presses **Enter**, then the
      annotation saves — with its scenario-time timestamp, category, note text, and context anchor
      — and the popover closes; pressing **Esc** at any point cancels with no save — per D6-003.
- [ ] Given the measured interaction end-to-end (open → type → categorize → save), when performed as
      designed, then it completes in ≤10 seconds — the usability budget D6-003 names explicitly.
- [ ] Telemetry (XC-004): saving an annotation emits an event (wall + scenario time, evaluator
      actor, context anchor) — an evaluator judgment action captured for its own audit trail,
      distinct from participant telemetry.
- [ ] Accessibility (NFR-001): the popover is keyboard-operable end-to-end (the B-key path already
      is, by design); category chips are labeled by text, not color alone; focus returns sensibly on
      close.

## Out of Scope
Pushing an annotation to Cadence (story 03); the annotations list/flyout itself (story 03 owns the
list view — this story owns only the ≤10s capture popover); attach-to-selection (drag a post into
the popover) — per "D6 open/deferred," direct-manipulation attach is a build refinement, not this
pass.

## Technical Notes
Staff world; `features/evaluator/components/annotation/AnnotationPopover.tsx`,
`hooks/useAnnotationCapture.ts` (a global keydown listener for B/1-2-3/Enter/Esc and a
context-anchor derivation keyed off the currently active view). One popover instance mounts at the
dashboard root, not per-row, per D6-003 ("one popover, no modal"). See `implementation.md`.

## Dependencies
`evaluation-timeline` and this feature's own story 01 (both supply the context anchors the popover
reads); does not block story 03, which builds the list UI in parallel once the annotation data shape
is agreed.

## Tests
- Component (RTL): B-key opens the popover from multiple view contexts with the correct anchor.
- Component (RTL): 1/2/3 category-switch test.
- Component (RTL): Enter saves / Esc cancels, with no partial save on cancel.
- Manual/UX check: ≤10s measured path, documented until an automated timing harness exists.
