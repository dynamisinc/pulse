# Story: Controller takedown (soft delete + PostRemoved)

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** CTL-025, XC-010, COR-001, XC-002  ·  **Design decisions:** DP-9 (implementation.md §0), D1-009  ·  **Issue:** #428
**Story ID:** B6  ·  **Stack:** backend  ·  **Priority:** Should  ·  **Effort:** S  ·  **Wave:** 1b
**Home story:** [`world-steering/05`](../world-steering/05-content-takedown.md) (slice: soft delete + broadcast; category in telemetry only; no Director notification).

## Context
**As** a controller, **I want** to take a post down and have it vanish from every participant feed live, **so
that** the demo's moderation beat works ("it disappears from the participant feed live", plan beat 5). Soft
delete only: the row and its media stay, staff-only, for the record (XC-010). Wire shape: implementation.md
§1.5.5. The console (C5) emits the one `steering_action` telemetry event; this endpoint emits none (DP-9, to
avoid a double count).

## Acceptance Criteria
- [ ] **Soft delete.** `DELETE /api/staff/posts/{postId:guid}?category=` sets `Post.DeletedAt` to the exercise's
      **scenario** time and returns 204; nothing is ever hard-deleted; the post, its `PostMediaItem`s and blobs
      remain. `category ∈ inappropriate|pii|real-world-reference|other` (default `other`), anything else is 400.
- [ ] **Idempotent.** Repeating the call returns 204, does not move `DeletedAt`, and does **not** broadcast
      again.
- [ ] **Authorization.** A live staff session **assigned to the resolved exercise with the controller role**
      only (`EngineCockpitStaffAuthorizationFilter` + `EngineCockpitControllerRoleFilter`): anonymous,
      participant and shared read-only sessions → 401 (no staff session); an evaluator/planner, or staff not
      assigned to the resolved exercise → 403 (the UI hides the control for them — "absent, not disabled",
      CTL-033).
- [ ] **Isolation (always-Critical).** An unknown id and another exercise's post both return 404 and change
      nothing; a controller of exercise A cannot take down exercise B's post.
- [ ] **Live removal.** A takedown broadcasts `PostRemoved { postId }` to `exercise:{id}` only, through
      `IFeedBroadcaster.BroadcastPostRemovedAsync` (a **default interface method**, so the ~9 existing
      `IFeedBroadcaster` test doubles keep compiling) implemented by `SignalRFeedBroadcaster`; nothing is sent
      to other exercises or to the staff-only group.
- [ ] **Reads honour it.** After takedown the feed, Following feed, profile/hashtag sources and the focused
      thread omit the post; a taken-down *reply* is a tombstone in its parent thread (B2); counts exclude it; no
      participant payload carries any of its content.

## Out of Scope
The takedown UI (C5), the incident-category column or report (category is telemetry-only, DP-9), notifying the
Director, restore/undo, participant self-delete (SOC-005), blob deletion, replay/AAR filtering (E10),
server-side telemetry (the console emits `steering_action`).

## Technical Notes
- Staff API (COBRA world on the UI side). Files: implementation.md §4.1 row B6 — new
  `Features/Social/Moderation/**` plus the two-method addition in
  `Features/Realtime/{IFeedBroadcaster,SignalRFeedBroadcaster}.cs` (B6 is their only Wave-1b editor; **B5 has
  already merged**). Ships `AddSocialModeration()`/`MapSocialModerationEndpoints()` for the orchestrator's
  `Program.cs` wiring. Scenario time via the `FollowService` clock pattern.
- `/api/staff/**` is not in `ExerciseLifecycleGatedRoutes`, so staff can take down in any lifecycle state —
  intended.

## Dependencies
B1 (the entities/`DeletedAt` already exist; B1 for the build base), B5 merged first. Runs with BM, BP, B2, B3.
C5 depends on this.

## Tests
- **Isolation (first):** `Features/Social/Moderation/TakedownIsolationTests.cs` — cross-exercise 404, controller
  of A vs post of B.
- Authorization matrix, idempotency (no second broadcast: a fake `IFeedBroadcaster` counts calls), category
  validation, `DeletedAt` equals the clock's scenario time.
- Broadcaster: `SignalRFeedBroadcasterTests` — `PostRemoved` goes to `exercise:{id}` only (hub test double).
- Read-path regression: feed/thread/profile sources exclude the post; reply tombstone via B2's reader.
- Wiring test: route answers 401 unauthenticated.
