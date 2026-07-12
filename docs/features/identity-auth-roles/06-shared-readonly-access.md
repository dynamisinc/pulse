# Story: Shared read-only access (view-only session)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-015  ·  **Design decisions:** none  ·  **Issue:** #63

## Context
For the "hundred passive participants" case: each exercise can enable a generic credential (exercise
URL + shared password) granting a **view-only session** — full read access to all enabled channels,
no posting/reacting/following/DMs. Account-management burden must be near zero. Read-only sessions get
an **ephemeral session identity** so telemetry (XC-004) can still count views/reach without per-user
provisioning; default landing is **All Posts** (or the Portal once E3 lands), never the Following feed
(COR-015).

## Acceptance Criteria
- [ ] An exercise can enable a shared credential (URL + password) that grants a view-only session with
      read access to all enabled channels.
- [ ] A read-only session cannot post, react, follow, or DM (write paths denied), and requires no
      per-user provisioning.
- [ ] Each read-only session gets an **ephemeral identity** so views/reach are counted in telemetry
      (XC-004) without a named account.
- [ ] The default read-only landing/feed is **All Posts** (or the Portal once E3 lands) — never the
      Following feed (which is empty for non-following accounts).

## Out of Scope
The credential lifecycle — rotation/revocation/lockout (story 07); the feeds themselves (E2 SOC-080/081).

## Technical Notes
The ephemeral identity is telemetry-bearing but not a provisioned account. Landing defaults to All
Posts. See implementation.md (story 06).

## Dependencies
Story 03 (sessions); exercise-isolation (scope); E2 feeds for landing. Lifecycle in story 07.

## Tests
- Integration: a shared-credential session is read-only, gets an ephemeral telemetry identity, and
  lands on All Posts.
