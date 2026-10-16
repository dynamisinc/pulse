# Story: Build workspace (author the world staff-only)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-040  ·  **Design decisions:** none  ·  **Issue:** #71

## Context
During Build, planners and controllers author everything the world needs — personas/casts, backdated
post history, scheduled scenario content, portal filler, the weather timeline, outlet branding, and
theming — using the **same composers used during conduct**, with all content in a staff-only
unpublished state (COR-040).

## Acceptance Criteria
- [ ] During the Build state, staff can author all world content (personas/casts, backdated history,
      scheduled content, theming) using the same composers used during conduct.
- [ ] All content authored during Build is **staff-only and unpublished** until go-live/fire — never
      visible to participants (XC-002).
- [ ] The build workspace is exercise-scoped and reflects the current lifecycle state
      (exercise-configuration COR-032).
- [ ] Phase 1 scope covers Social + persona content; other channels' authoring plugs in as E4–E6 land.

## Out of Scope
Preview-as-participant (story 02); the readiness dashboard (story 03); the go-live actions (story 04);
the individual composers (channel epics / persona-management).

## Technical Notes
Staff world (COBRA). A workspace that hosts the same composers with an unpublished/held content state.
See implementation.md (story 01).

## Dependencies
exercise-configuration lifecycle (COR-032); persona-management; channel composers (E2 now). Feeds the
readiness dashboard (story 03).

## Tests
- Integration: Build-authored content is staff-only/unpublished; visible only after go-live/fire.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.4, §5.2, §6.1 (Tier-2 signed off by Tom, 2026-10-16). Wave A3.
- [ ] **Setup content is stamped in build only.** Given the exercise is in `build`, when a post is written (composer, backdated, or content pack), then the server sets `Post.IsSetupContent = true`; posts written in `staged` or later are conduct (`false`). The client cannot set the flag.
- [ ] **Staged-state edits.** Planners who need to add setup content after staging must **unstage** first (story 07); the workspace says so.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR, or the PR states "no guide impact".
