# Story: Exercise Management: rename, archive, minimal duplicate

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-074, COR-075, exercise-build-golive/06 (duplicate, minimal slice)  ·  **Decisions:** DF-20, DF-35  ·  **Issue:** #540
**Stack:** fullstack  ·  **World:** staff  ·  **Review:** **Tier-2 (duplicate writes across exercise-scoped tables)**  ·  **Priority:** Should (duplicate: Could)  ·  **Wave:** 4  ·  **Effort:** M+
**Owner:** Wave 3 session · **Branch:** `build/demo-feedback/22-exercise-rename-archive-duplicate` → `feature/demo-feedback-w4-polish`

## Context

Story 15 lets controllers list and create exercises (`/staff/exercises`, `GET`/`POST /api/org/exercises`), but the
table has no row actions. Rename exists only for the **active** exercise (`PUT /api/staff/exercise-settings`,
`UpdateExerciseSettingsRequest.Name`, validated at `ExerciseSettingsService.cs:657`). Archive exists in the lifecycle
(`completed → archived`, terminal) but nothing offers it. Duplicate has no code at all. Tom 10/15: rename, archive,
and a minimal duplicate so a run can be reset into a fresh copy.

## Acceptance Criteria

### Rename

- [ ] `PATCH /api/org/exercises/{exerciseId:guid}` `{ name }` for planner / org admin / controller (DF-20 set),
      reusing the settings name validator (same length and blank rules; 400 on violation). The caller must be able to
      see the exercise in `GET /api/org/exercises` (same org scope), else 404. Emits `exercise.renamed`.
- [ ] Row action "Rename" opens a COBRA dialog (`CobraTextField`, `CobraPrimaryButton`); the table updates on success.

### Archive

- [ ] `POST /api/org/exercises/{exerciseId:guid}/archive`: applies `completed → archived` through the existing
      lifecycle service; any other state is 409 `{ reason: "not-completed" }`. Emits `exercise.archived`.
- [ ] Row action "Archive" only for completed exercises, behind a confirm; other states show the action disabled with
      the text "End the exercise first" (not tooltip-only). Archived exercises are labelled "Archived" (text, not color)
      and sorted last.

### Duplicate (Could; first to cut)

- [ ] `POST /api/org/exercises/{exerciseId:guid}/duplicate` `{ name }` → 201 with the new row in lifecycle `build`.
      One transaction. Copies exactly DF-35's list: `Exercise` settings columns (brand, chrome, `WatermarkEnabled`,
      channels, outlets, time zone; `NoiseLevel` reset to `off`; schedule cleared), personas (new ids), noise pool,
      run-sheet items and their child posts (status `pending`, fired/claim/post-id fields cleared, persona and media
      references remapped to the copies, `ExternalRef` kept), media asset rows re-keyed to the new exercise **pointing at
      the same blob** (no blob copy), and a controller staff assignment for the caller.
- [ ] **Never copies** posts, reactions, pins, follows, roster accounts, participant links, day words, sessions,
      telemetry, engine review items, runtime state (17).
- [ ] Isolation (Critical): writes run under the new exercise's context through the `PulseDbContext` write guard
      (never `IgnoreQueryFilters` on a write); the source exercise is byte-for-byte unchanged (row counts and a hash of
      its rows before and after); the copy sees none of the source's rows. A re-keyed media row serves through the
      normal media read (authorized by row, not blob path).
- [ ] Row action "Duplicate" with a name prompt (default "Copy of …"); emits `exercise.duplicated` with row counts.

### Cross-cutting

- [ ] COBRA throughout; FontAwesome icons; MUI 9 `sx`-only. Read-only evaluators see no row actions.

## Out of Scope

Deleting exercises, copying posts/roster, blob copies, cross-org duplicate, archive of non-completed exercises.

## Technical Notes

Owns `Features/ExerciseLifecycleAdmin/**` (+ new `Duplicate/`), `features/exerciseLifecycleAdmin/**`
(`OrgExerciseTable`, `orgExercisesService.ts`). Exercise-scoped tables are listed at `PulseDbContext.cs:115-178`.
If a new `Map…` call is needed it is seam S-6; prefer adding routes inside the existing
`MapExerciseLifecycleAdmin`. No migration.

## Dependencies

None. Tier-2 review before merge.

## Tests

Backend: rename (validator reuse, 404 outside org, role set), archive (completed ok, others 409), duplicate (copied
set exact, excluded set absent, remapped references, run sheet all pending, media re-keyed serves, source unchanged,
isolation both directions, transaction rolls back on a mid-copy failure). Frontend: row actions per state, dialogs,
evaluator sees none.
