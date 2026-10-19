# Story: Build workspace (author the world staff-only)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-040  ·  **Design decisions:** none  ·  **Issue:** #71

## Context
During Build, planners and controllers author everything the world needs — personas/casts, backdated
post history, scheduled scenario content, portal filler, the weather timeline, outlet branding, and
theming — using the **same composers used during conduct**, with all content in a staff-only
unpublished state (COR-040).

## Acceptance Criteria
- [ ] During the Build state, staff can author all world content (~~personas/casts~~ *persona creation is out of scope here: persona-management A4*; backdated history,
      scheduled content, theming) using the same composers used during conduct. *Server-side persona-post/follow/pin already exist; this story adds the workspace entry points.*
- [ ] ~~All content authored during Build is **staff-only and unpublished** until go-live/fire~~ **Superseded by the currency check below:** build content is invisible to participants because participants have no access in `build` (lifecycle gate) and setup posts are marked `IsSetupContent`; there is no per-post publish state (XC-002).
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
- [ ] **Setup content is stamped in build only.** *(BLOCKED on the A3 migration, PR-4.)* Given the exercise is in `build`, when a post is written (composer, backdated, or content pack), then the server sets `Post.IsSetupContent = true`; posts written in `staged` or later are conduct (`false`). The client cannot set the flag.
- [ ] **Staged-state edits.** ~~Planners who need to add setup content after staging must **unstage** first (story 07); the workspace says so.~~ **BLOCKED on story 07.** Until 07 exists the workspace says staged exercises cannot take new setup content; once 07 lands the copy becomes "unstage first".
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR, or the PR states "no guide impact".

## Currency check 2026-10-19 (post-A1, Session D)

Audit of main after the A1 identity wave ([`ADMIN-IDENTITY-MODEL`](../../design/ADMIN-IDENTITY-MODEL.md) is the source). Slice plan: PR-2 = story 03, PR-3 = story 04, PR-4 = A3 migration + story 09, **PR-5 = this story**.

**Already on main (do not rebuild):**
- Staff persona-post / follow / pin in build exist server-side (`StaffAuthoringRoleFilter.PersonaAuthoring` on `POST /api/posts`; planner or controller). The client may send `ScenarioTime` (backdating).
- `/staff/plan` (`features/planner`) is a sectioned settings workspace (identity/schedule, channels, theming, chrome, practice, account import). It has no lifecycle, readiness or composer. Exercise creation is at `/staff/exercises` (org admin).

**Not built / out of scope:**
- No staff persona-CREATE endpoint (only `PATCH /api/staff/personas...`). Persona creation is persona-management (A4), not this story.
- Nothing on main for `IsSetupContent` (needs the A3 migration, PR-4) or unstage (story 07).

**Blockers:** `IsSetupContent` stamping is BLOCKED on the A3 migration (PR-4); staged-edit-requires-unstage is BLOCKED on story 07.

**PR-5 scope:**
- A workspace "Overview" section on `/staff/plan` showing current lifecycle state, a readiness summary (from story 03), and entry links to the authoring surfaces that exist (personas edit, run sheet, compose-as-persona in the console).
- The server-side `IsSetupContent` stamp (build only; client cannot set it).
- Keep the user-guide docs-as-done AC.

**Dependencies (updated):** story 03 (readiness summary); PR-4 A3 migration (stamp); story 07 (unstage copy).
