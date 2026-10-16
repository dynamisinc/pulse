# Story: Reset, reopen, unstage and unarchive

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-043, COR-032 (+ #377/#481)  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.1, §5.2, §5.4, §5.4a, §8.5  ·  **Issue:** #580
**Stack:** fullstack  ·  **Review tier:** Tier-2 (data deletion, isolation)  ·  **Wave:** A3

## Context
Exercises can only move forward today, and the demo reset is direct SQL in `Clear-DemoContent.ps1`. This story adds the four reverse/recover transitions in [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.2 and replaces the script's SQL with one service transaction. Staff world.

## Acceptance Criteria
- [ ] **Unstage** (staged -> build): planner; keeps everything, wipes nothing.
- [ ] **Reopen** (completed -> live): controller; refused once archived; the scenario clock resumes where it stopped; audited.
- [ ] **Unarchive** (archived -> completed, or -> build if it was archived from build): org admin only; restores read-write per the prior state; nothing else changes.
- [ ] **Archive** is allowed from `completed`, and from `build` when `FirstLiveAt` is set (a reset exercise being retired); planner or org admin; live sessions revoked.
- [ ] **Reset** (completed **or staged** -> build): planner or org admin, typed-name confirmation; refused in build, live, paused and archived. Keeps settings, chrome, sign-in methods, personas (with live edits), staff library media, run sheet (items back to *pending*), noise pool, **setup posts** (`IsSetupContent`), accounts, enrollments, links and the view-only code. Hard-deletes conduct posts and edits, reactions, reposts, `PostMediaItem` rows and participant-uploaded media on them, conduct follows (`Follow.IsSetupContent = false`), telemetry events, engine review items, inject-queue state, runtime state (clock, pause tier), day words and every session.
- [ ] **Reset from staged** clears a dry run (posts, reactions, telemetry, sessions, day words made while staged) and keeps everything authored in build, because `IsSetupContent` is stamped only in build.
- [ ] **Run-sheet reply items (§5.4a):** an item whose reply target was a deleted conduct post becomes `needs-repair` ("reply target removed by reset"), cannot fire, and blocks staging (readiness item 8); items targeting setup posts return to `pending`.
- [ ] **Reset dialog guidance:** it offers the AAR/report export first (from completed) and says: to keep a run, don't reset; duplicate and run again in the copy (duplicating then resetting the source still destroys the run).
- [ ] **One transaction through `PulseDbContext`** with the exercise filter scoping every delete, plus an outbox step for blob deletes; a failure rolls back; no direct SQL. `Clear-DemoContent.ps1` becomes a wrapper around the reset endpoint.
- [ ] Every transition emits `exercise.lifecycle.transitioned` with the actor `PersonId` and role (and, for org-scope actions, an `OrgAuditEvent`).
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` (reset, reopen, unstage, unarchive; the "ask Dynamis" lines removed) updated in the same PR, screenshots re-captured.

### Copilot review 2 fold (2026-10-16, ADMIN-IDENTITY-MODEL §5.4)
- [ ] `Follow.IsSetupContent` is stamped by the write path (true only while the exercise is in build). The A3 migration backfills `Posts` and `Follows` by the §5.4 rule (the first lifecycle transition out of build; participant-origin posts are always conduct; with no transition event, a row is conduct). Reset deletes only conduct follows.

## Out of Scope
Delete (08); multiple runs per exercise or run numbering (rejected, §5.2); evaluator annotations; the AAR export itself (E10).

## Technical Notes
Staff world. Paths: `Features/ExerciseLifecycleAdmin/Reset*`, `LifecycleEndpoints.cs` (role checks from identity 17), `scripts/uat/Clear-DemoContent.ps1`, planner confirm dialog (COBRA type-to-confirm). Migration `Posts.IsSetupContent` is A3's (with 09's `ParticipantName`). Stamp of `IsSetupContent` happens in the post write path. Orchestrator clearance first for the migration, `Program.cs` and `staffRouteRegistry.tsx` lines.

## Dependencies
Wave A3, after A1 (16, 17). Can run with 08, 09 (disjoint files; one migration per wave is orchestrator-owned).

## Tests
Reset keep/wipe matrix test per table; staged-reset test; needs-repair test; rollback test; blob-outbox test; role/state matrix; foreign-exercise/org tests; RTL for the dialog.
