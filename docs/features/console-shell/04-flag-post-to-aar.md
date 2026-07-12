# Story: Flag on any post → after-action record

**Feature:** Console shell  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** console UI architecture (D5); E10 AAR sink  ·  **Design decisions:** D5-014/3.4  ·  **Issue:** #12

## Context
Controllers spot moments worth revisiting in the hotwash as they happen. A lightweight per-post
**Flag** action writes that post to the after-action record (E10) so it surfaces in the AAR. This is
the **minimal** slice — the full evaluator flag/annotation set (categories, notes, rubric linkage) is
deferred to D6/evaluator.

## Acceptance Criteria
- [ ] Given any post visible in a staff surface (live world, watchlist, thread), when the controller
      uses the hover **Flag** action, then that post is written to the after-action record with the
      flagging controller, the post reference, and both wall + scenario timestamps (XC-004/COR-053).
- [ ] A flagged post shows a subtle staff-only flagged affordance (icon + label, not color-only,
      NFR-001); the flag is **never** visible to participants (XC-002).
- [ ] Flagging is idempotent/toggleable (re-flag does not duplicate the AAR entry; unflag removes it).
- [ ] The AAR write is soft/append-only and retained for the record (XC-010).

## Out of Scope
Evaluator annotation categories, notes, rubric/EEG linkage, and the AAR review UI (D6/evaluator,
E10). Flagging non-post content types (future).

## Technical Notes
Staff world (COBRA). Reuses the shared "reveal/act on a post" affordance and the E10 after-action
record sink (mockable now). Emits telemetry on flag. See implementation.md (story 04).

## Dependencies
Story 01 (shell); the E10 after-action record sink (Phase 4 full, minimal write now); a post
reference from any staff surface. Full annotations link to D6.

## Tests
- Unit: a flag writes an AAR entry with controller + post ref + dual time; unflag removes it; re-flag
  does not duplicate.
- Component (RTL): the flagged affordance renders as icon+label (not color-only) and only on staff
  surfaces.
