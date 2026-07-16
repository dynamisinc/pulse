# Story: Coverage — missed opportunities, provisional until confirmed

**Feature:** Response, coverage, reach & sentiment metrics  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-011  ·  **Design decisions:** D6-010  ·  **Issue:** —

## Context
EVL-011's coverage metric auto-generates a missed-opportunities list (public concerns/storylines/
trending topics that never got an official response), but **each auto-flagged miss requires
evaluator/controller confirmation before it appears in the AAR export** — protection against
off-platform blindness producing false findings; unconfirmed items export as "flagged, unconfirmed."

**Design-introduced workflow (flagged for the reviewer):** the bare epic text only requires
confirmation-before-export. D6-010 is a design-session addition that resolves the concrete UI beyond
that: missed-opportunity rows start **dashed-amber "PROVISIONAL — NOT IN AAR YET"** at reduced
opacity with explicit **Confirm-for-AAR / Dismiss** actions (evaluator judgment, not world
steering); confirmed rows go **solid red** with the confirming evaluator's id; the AAR export flyout
restates that unconfirmed items export flagged provisional. This two-state provisional→confirmed/
dismissed workflow, and its specific visual treatment, is D6-010's contribution — call it out when
reviewing this story against the epic. See `docs/10-evaluation-aar.md` F10.2 and `feature.md`.

## Acceptance Criteria
- [ ] Given the automatically generated missed-opportunities list, when a new item is flagged, then
      it renders **dashed-amber**, at reduced opacity, with the chip text "PROVISIONAL — NOT IN AAR
      YET" and two actions — **Confirm for AAR** and **Dismiss** — per D6-010.
- [ ] Given a provisional coverage row, when an evaluator or controller clicks **Confirm for AAR**,
      then the row switches to solid red styling with a chip naming the confirming evaluator (e.g.
      "MISSED · CONFIRMED E1") at full opacity — per D6-010.
- [ ] Given a provisional coverage row, when **Dismiss** is clicked, then the row is removed from the
      coverage list and never appears in the AAR export — the false-finding protection EVL-011
      exists for.
- [ ] Given a coverage item addressed by an official response, when it renders, then it shows an
      ADDRESSED state (checkmark glyph, green edge) distinct from both provisional and
      confirmed-missed — the three-state model in the reference DOM's `covRows`.
- [ ] Given the AAR export package (`aar-export/01`), when it is generated, then any coverage item
      still unconfirmed exports flagged "provisional" rather than being silently included or
      excluded — the cross-feature contract D6-010 and D6-012 both restate.
- [ ] Telemetry (XC-004): each Confirm-for-AAR and Dismiss action emits an event (wall + scenario
      time, evaluator actor) — an evaluator judgment action worth its own audit trail, distinct from
      participant/persona telemetry.
- [ ] Accessibility (NFR-001): the provisional/confirmed/addressed states are distinguished by glyph
      + text chip + color together, never color or opacity alone.

## Out of Scope
The algorithm that auto-detects a "missed opportunity" candidate (an analysis concern over the
telemetry stream, not this story's UI); the AAR manifest itself (`aar-export/01`, which only
restates the provisional-count warning this story produces).

## Technical Notes
Staff world; `features/evaluator/components/metrics/CoverageList.tsx`, `hooks/useCoverageRows.ts`
(confirm/dismiss mutation over the coverage read model — client-held state behind the axios client
until a backend contract exists, matching the reference mockup's local `cov` state array). See
`implementation.md`.

## Dependencies
`evaluation-timeline` (candidate events feeding coverage detection); this feature's own
coverage-detection read model (mocked initially).

## Tests
- Component (RTL): provisional → confirmed transition (styling + confirming-evaluator id).
- Component (RTL): dismiss removes the row and it never reaches AAR export.
- Component (RTL): three-state style/label assertion (never color-only).
