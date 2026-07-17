# Story: Annotation push to Cadence

**Feature:** Live evaluator tools — storyline board & annotation capture  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-021  ·  **Design decisions:** D6-003  ·  **Issue:** #236

## Context
EVL-021 requires annotations to be exportable and included in the AAR package; when Cadence is
linked, an annotation can be pushed as context to a Cadence Observation (`INT-030` channel). D6-003
covers this too: the toolstrip's **Annotations** tool is badged with the unpushed count and lists all
annotations; each row carries a **"→ Cadence"** action; the flyout footer carries one COBRA
**"Push N to Cadence"** button. This story enforces the epic's central boundary (E10 §1): **evidence
goes to Cadence, scoring stays there** — Pulse computes and transmits context, it never creates or
implies a P/S/M/U rating or EEG entry. See `docs/10-evaluation-aar.md` F10.3, §1, and `feature.md`.

## Acceptance Criteria
- [ ] Given the shell toolstrip, when annotations exist with at least one unpushed, then the
      Annotations tool icon carries a numeric badge equal to the unpushed count — per D6-003; the
      badge clears once nothing is unpushed.
- [ ] Given the Annotations flyout, when it opens, then it lists every captured annotation (category
      chip, scenario timestamp, note text, context anchor) newest-first, each row showing "✓ in
      Cadence" when already pushed or a "→ Cadence" action when not — per D6-003.
- [ ] Given an unpushed annotation row, when the evaluator clicks "→ Cadence", then that single
      annotation is sent to Cadence as observation-context evidence (`INT-030`) and the row updates
      to "✓ in Cadence" — per EVL-021.
- [ ] Given the Annotations flyout footer, when unpushed annotations remain, then one COBRA "Push N
      to Cadence" button sends all remaining unpushed annotations in one action, and relabels to
      "All in Cadence ✓" once none remain — per D6-003.
- [ ] Given the push action (single or batch), when it completes, then only the annotation content
      transmits as **context evidence** — no P/S/M/U rating, EEG entry, or observation score is
      created or implied on the Pulse side — enforcing the E10 §1 boundary.
- [ ] Telemetry (XC-004): each push (single or "Push N") emits an event recording what was pushed,
      when, and by whom.
- [ ] Accessibility (NFR-001): the toolstrip badge count is announced to assistive tech (not a bare
      color dot); flyout rows and the push button are fully keyboard-operable.

## Out of Scope
The Cadence-side Observation UI (Cadence's own surface); the capture popover (story 02); AAR-package
annotation export (`aar-export/01`, which packages the same annotation set as a document/JSON — a
separate path from this live push).

## Technical Notes
Staff world; `features/evaluator/components/annotation/AnnotationsFlyout.tsx`,
`hooks/usePushToCadence.ts` (single + batch mutation against the `INT-030` channel — mocked behind
the shared axios client until E9's Cadence-link contract exists; when Cadence isn't linked for an
exercise, the push action is **absent**, not disabled, per the read-only-affordance pattern used
elsewhere in Pulse). Registers into the shared D7 staff-shell toolstrip — does not draw its own
strip. See `implementation.md`.

## Dependencies
Story 02 (the annotation data this flyout lists); E9/`INT-030` (the Cadence push channel — a serial
edge once that contract exists; until then, push is a documented mock/no-op).

## Tests
- Component (RTL): toolstrip badge count matches unpushed annotations.
- Component (RTL): single-row "→ Cadence" push test.
- Component (RTL): "Push N to Cadence" batch test + button relabeling.
- Unit: boundary assertion — no scoring artifact is created or implied by a push.
