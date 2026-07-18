# Story: Retention & export policy

**Feature:** AAR export package  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started · deferred: design pass pending
**Requirements:** EVL-032  ·  **Design decisions:** none — deferred, not a screen concern this pass  ·  **Issue:** #224

## Context
EVL-032 requires archived exercises to retain full timeline/replay integrity per COR-006, with
org-configurable retention windows (records/PII posture per NFR-007). Per `DECISIONS.md`'s "D6 open
/ deferred" note: **"EVL-032 (retention/off-box export policy surface) — not a screen concern this
pass."** No D6 decision resolves any UI for this requirement, and it is not even settled that this
belongs on the evaluator dashboard at all — it may instead belong to an org-admin or
`exercise-configuration` settings surface. **This story is a placeholder documenting the gap, not a
buildable spec.**

## Acceptance Criteria
- [ ] (Design-blocked) An org-configurable retention window for archived exercise timeline/replay
      data exists, honoring COR-006 (archived exercises fully separable, never contaminating live
      queries) and NFR-007 (PII/records minimization, documented defaults, a purge-on-request path)
      — no D6 decision or screen resolves this yet.
- [ ] Until a design pass happens, archived exercises default to full retention (no silent data
      loss) — this requirement is tracked here rather than built ad hoc.
- [ ] When resolved, determine whether this surface belongs to the evaluator dashboard at all, or to
      an org-admin/`exercise-configuration` surface instead (open question, not yet decided) — cite
      the resolving decision ID before building.

## Out of Scope
Everything except tracking the gap. No implementation happens in this pass.

## Technical Notes
Not applicable — placeholder. If resolved toward `exercise-configuration` ownership, this story
should be moved there rather than built under `features/evaluator/`.

## Dependencies
A future design pass (destination surface undecided); `exercise-configuration`, which likely owns
the eventual settings UI even if the evaluator dashboard only surfaces read-only retention status.

## Tests
None — placeholder story.
