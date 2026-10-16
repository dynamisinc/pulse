# Story: Delete an exercise that never ran

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032, COR-074  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.2, §8.2  ·  **Issue:** #581
**Stack:** fullstack  ·  **Review tier:** Tier-2 (data deletion, isolation)  ·  **Wave:** A3

## Context
A build-only exercise created by mistake needs removing ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.2). Only exercises that never ran can be deleted; ones that ran are retired by archive.

## Acceptance Criteria
- [ ] Given an exercise in `build` with `FirstLiveAt` null, when a planner of it or an org admin deletes it with typed-name confirmation, then the exercise and every exercise-scoped row and blob are removed and the hostname is freed.
- [ ] Given `FirstLiveAt` is set (it ran, then was reset) or the state is not `build`, then delete returns 409 and the dialog points to **archive from build**.
- [ ] Controller, evaluator, participant and readonly callers are refused (403/matrix).
- [ ] Runs as one service transaction through `PulseDbContext` with an outbox step for blob deletes; no other exercise's rows or blobs are touched (proved by a two-exercise fixture).
- [ ] Note on soft delete (XC-010): this is the one permitted hard delete; it applies only to never-ran exercises with no conduct data to retain for AAR. Recorded in an `OrgAuditEvent` (kind, actor, name hash).
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` (delete vs archive) updated in the same PR.

## Out of Scope
Deleting exercises that ran; bulk delete; undelete.

## Technical Notes
Staff world; COBRA type-to-confirm. Paths: `Features/ExerciseLifecycleAdmin/ExerciseDelete*.cs`, list row action. Orchestrator clearance for route-group lines.

## Dependencies
Wave A3, after A1 and 07 shares the transaction/outbox helper (build the helper in 07 or a shared file owned by 07; serial edge on that file).

## Tests
Delete matrix by state/FirstLiveAt; blob-outbox; two-exercise isolation fixture; foreign-org 404.
