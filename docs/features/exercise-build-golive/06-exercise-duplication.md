# Story: Exercise duplication

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-045  ·  **Design decisions:** none  ·  **Issue:** #76

## Context
Exercises are duplicable: clone an exercise's world (cast, theming, filler, scheduled content, config)
as the starting point for the next exercise — **not** participant data or conduct history. The build
investment compounds (COR-045).

## Acceptance Criteria
- [ ] A planner can clone an exercise into a new exercise that copies the **world**: cast/personas,
      theming, filler/backdated content, scheduled content, and configuration.
- [ ] The clone **excludes** participant accounts/data and conduct history (posts fired during conduct,
      telemetry, AAR).
- [ ] The cloned exercise is a fresh, isolated instance (exercise-isolation) in Build state ready to
      adjust.
- [ ] Cloning is a staff/planner action, staff-only (XC-002).

### Copilot review 2 fold (2026-10-16, ADMIN-IDENTITY-MODEL §5.5)
- [ ] Duplicate copies only **setup** follows (`Follow.IsSetupContent`) between the copied personas, never conduct follows.

### Orchestrator review fold (2026-10-16)
- [ ] Copied staff enrollments keep their `IsLead` flag.

## Out of Scope
AAR export of the source (E10); template/cast library management (persona-management); the lifecycle
of the new exercise (exercise-configuration).

## Technical Notes
Foundation. A deep-copy of world-definition entities, excluding conduct/participant data. See
implementation.md (story 06).

## Dependencies
Stories 01/04; exercise-configuration (new exercise in Build); persona-management (cast). Compounds
build investment. **`exercise-lifecycle-admin/01-exercise-creation.md` (COR-074) is a hard
prerequisite, filed 2026-08-01:** duplication has always presupposed a create path, and until that
story none existed as a requirement, a story, or a customer-facing endpoint — only the secret-gated
ops bootstrap seam could create an `Exercise` row. Duplication targets the same creation path
(hostname allocation, `Build` status, creator `StaffAssignment`, org ownership) that story
establishes; it does not invent a second one.

## Tests
- Integration: cloning copies world definition and config but not participant data or conduct history;
  the clone is isolated.

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.5, §5.4a, §8.2, Q4 (Tier-2 signed off by Tom, 2026-10-16). Wave A3. Amends C2's "never posts" to "never **conduct** posts".
- [ ] **Planner of the source or org admin** may duplicate from any state; the result is a new exercise in `build` named "Copy of X", with a new hostname and a generated, disabled view-only code. Controllers and evaluators are refused.
- [ ] **Copied with new ids and every reference remapped:** settings, chrome, sign-in methods; personas (avatar/banner remapped); staff library media (blobs server-side copied into the new prefix); run sheet (all items pending, except reply items needing repair); noise pool; follow graph between personas; staff enrollments (default on); **setup posts** (`IsSetupContent`) with their media, pins and baselines remapped.
- [ ] **A setup post is copied only if its whole parent chain is setup.** A setup post whose parent chain includes a conduct post (dry-run post in `staged`, unstage, staff reply in `build`) is treated as conduct and not copied; its descendants are not copied either. Test: that sequence yields no copy of the reply.
- [ ] **Persona avatar/banner pointing at participant-uploaded media is cleared to the default** on the copy (that asset is not copied).
- [ ] **Run-sheet reply items:** a reply whose target is a setup post is remapped to the copied post; one whose target is a conduct post arrives `needs-repair` (§5.4a) and blocks staging until fixed.
- [ ] **Never copied:** conduct posts, participant accounts, links, day words, sessions, telemetry, participant-uploaded media. Optional "copy participant roster" re-creates directory-linked accounts with persona bindings and no links; one-offs are not copied.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR, or the PR states "no guide impact".
- [ ] Foreign-exercise and foreign-org source ids return the bare 404.

### Copilot review 3 fold (2026-10-16)
- Added: duplicate copies a setup post only if its whole parent chain is setup (replies to conduct posts are not copied) + sequence test.
