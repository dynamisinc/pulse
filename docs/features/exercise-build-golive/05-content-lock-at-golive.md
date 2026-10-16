# Story: Content lock at go-live

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-044  ·  **Design decisions:** none  ·  **Issue:** #75

## Context
Content created during Build is versioned/locked at go-live, consistent with any linked Cadence MSEL
approval state (INT-003, Phase 4). Post-lock changes during conduct are controller actions (E7),
audit-logged (COR-044).

## Acceptance Criteria
- [ ] At go-live, Build content is versioned/locked so the world entering conduct is a known, stable set.
- [ ] Post-lock changes during conduct are made as **controller actions** (E7), each audit-logged
      (XC-004) — not silent edits to the locked baseline.
- [ ] When linked to a Cadence MSEL (Phase 4, INT-003), the lock is consistent with the MSEL approval
      state; in standalone mode the lock is native.

## Out of Scope
Cadence MSEL integration itself (E9, Phase 4); the controller edit actions (E7 inject-queue
edit-then-fire); the lifecycle transition (story 04).

## Technical Notes
Foundation. A versioning/lock boundary at go-live; conduct edits are attributed controller actions.
See implementation.md (story 05).

## Dependencies
Story 04 (go-live); E7 (conduct edits); E9/INT-003 (Phase 4 MSEL consistency).

## Tests
- Integration: go-live locks/versions Build content; a conduct edit is recorded as an attributed
  controller action.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §6.1, §5.4 (Tier-2 signed off by Tom, 2026-10-16). Wave A3.
- [ ] **Content packs are build-only.** Given an exercise not in `build`, when a content pack is uploaded or applied, then it is refused (409 `content-locked`), so pack posts are always setup content; to add pack content to a staged exercise, unstage first. (The upload story is persona-management 06.)
- [ ] The lock message names "unstage" as the way back to editing.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR, or the PR states "no guide impact".
