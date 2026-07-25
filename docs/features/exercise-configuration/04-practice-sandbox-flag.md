# Story: Practice/sandbox flag

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-033  ·  **Design decisions:** none  ·  **Issue:** #70

## Context
A practice/sandbox flag lets staff run rehearsals whose data is **excluded from evaluation exports**
(COR-033) — so a load rehearsal or a controller dry-run doesn't pollute the AAR.

The flag's **column ships in story 01's single migration** (feature.md "Single-migration rule"); this
story owns its behavior: setting it, reading it, and the staff-visible indicator. **E10 (evaluation
export) is Phase 4 and does not exist yet**, so the deliverable here is the flag plus a documented,
tested read seam E10 will filter on — not the export filtering itself.

## Acceptance Criteria
- [ ] Given a planner with a staff session, when they flag an exercise practice/sandbox, then the flag
      persists on that exercise and defaults to off for every exercise that has never been flagged.
- [ ] Given the flag is set, when a consumer asks whether an exercise's data is evaluation-eligible,
      then a single documented server-side seam answers it — so E10's export filtering has exactly one
      thing to read and no consumer re-derives the rule.
- [ ] Given the flag is set, when the exercise runs, then it remains **otherwise fully functional** for
      the rehearsal (no channel, engine or telemetry behavior changes because of the flag).
- [ ] Given the flag is set, when a staff surface renders, then the practice/sandbox state is clearly
      indicated — with icon + text, **never color alone** (NFR-001) — so a rehearsal is never mistaken
      for real conduct.
- [ ] **Isolation / staff-only (XC-001/002):** given the flag, when it is read or written, then it is a
      staff-world value scoped by the server-resolved exercise, never exposed on a participant surface
      and never settable from a client-supplied exercise parameter.
- [ ] **The seam actually resolves:** given a fully composed service provider wired in the orchestrator's
      order, when `IEvaluationEligibility` is resolved, then this story's implementation comes back and
      answers correctly for a flagged and an unflagged exercise — proving `AddPracticeMode()` is
      genuinely wired, not just that the service class works in isolation (a slice can merge fully green
      with its composition-root wiring never executed).

## Out of Scope
The evaluation export itself and its filtering (E10, Phase 4 — this story only publishes the seam); the
readiness-dashboard load rehearsal (exercise-build-golive COR-042 / NFR-002); any participant-visible
indication of practice mode (there is none — XC-002).

## Technical Notes
**Staff world.** The indicator component is COBRA (`@/theme/styledComponents`, FontAwesome, MUI 9
`sx`-only) and lives in `src/frontend/src/features/planner/`; the orchestrator mounts it and edits the
planner barrel + README (integration seams — see implementation.md). **Keep this story's client-contract
types local to `services/practiceModeService.ts`** — do not append to `features/planner/types.ts`, which
belongs to the account-import contract and would collide with the other wave-3 builder. Backend behavior
lands in the `Features/ExerciseConfiguration/` slice story 01b creates. No schema work here. See
implementation.md (story 04).

## Dependencies
Story 01 (settings slice + the flag column in its migration). Consumed later by E10 export
(Phase 4). Supports the load rehearsal (COR-042).

## Tests
- Integration: the flag persists per exercise and defaults off.
- Unit: the evaluation-eligibility seam returns false for a flagged exercise, true otherwise (the
  contract E10 will filter on).
- Component: the staff indicator conveys practice mode with icon + text, not color alone.
