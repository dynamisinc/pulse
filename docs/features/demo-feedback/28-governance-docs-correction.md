# Story: Correct the "drafts leak to participants" statements

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-001, XC-002 (staff-only data), AI governance  ·  **Decisions:** DF-38  ·  **Issue:** #546
**Stack:** docs  ·  **World:** —  ·  **Review:** **Tom reviews the brief before it goes to the customer**  ·  **Priority:** Should  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** planning session · **Branch:** `build/demo-feedback/28-governance-docs` → readiness PR to `main`

## Context

`docs/demo/AI-GOVERNANCE-BRIEF.md` (written for the customer PM's CISA review) says that before any live use a known
defect must be fixed: unapproved engine drafts are broadcast on the shared participant SignalR channel
(social-api/05, "Not Started"). `PARTICIPANT-FIRST-DEMO-PLAN.md` repeats it. **That defect was fixed** by demo-polish
B5 (#423, commit `14810d3d`, "keep staff-only pushes off participant connections"):

- `ExerciseRealtimeHub.OnConnectedAsync` joins every connection to `exercise:{id}` and joins `exercise:{id}:staff`
  only when `IsVerifiedStaffForExerciseAsync` verifies a staff session with a staff assignment for that exercise;
- `EngineReviewBroadcaster` sends `ReviewItemChanged` to `StaffGroupNameFor(exerciseId)` only (also
  `NoiseBroadcaster`);
- tests: `ExerciseRealtimeHubRoleIsolationTests`, `EngineReviewBroadcasterScopeTests`.

The story file `docs/features/social-api/05-realtime-role-scoped-groups.md` (#346) was never updated.

## Acceptance Criteria

- [x] The brief states the current position: drafts and other staff-only pushes go only to verified staff
      connections, with the mechanism in one plain sentence and the test names as evidence. The "known defect before live
      use" item is removed from the go-live list; every other governance item (§8 sign-off, Azure evidence, model pin)
      is unchanged. The change is called out at the top as "Corrected 10/16" so a reader of an earlier copy sees it.
- [x] `PARTICIPANT-FIRST-DEMO-PLAN.md` line(s) on the leak corrected the same way.
- [ ] `social-api/05` status → Complete, "Delivered by demo-polish/04 (#423)", ACs ticked with the test that proves
      each; #346 closed as completed with a comment linking #423 and the tests. *(Doc part done; closing #346 is
      left to the orchestrator after review.)*
- [x] Before claiming it, the builder re-reads the hub and broadcaster on `main` and runs the two test classes
      (localdb), and quotes the result in the PR.
- [ ] **Tom decides whether and when the corrected brief is sent to the customer**; this story does not send it.

## Out of Scope

Any code change. Any other edit to the brief.

## Dependencies

None.

## Tests

`dotnet test --filter "FullyQualifiedName~ExerciseRealtimeHubRoleIsolationTests|FullyQualifiedName~EngineReviewBroadcasterScopeTests"`
green, quoted in the PR.

## Build record (10/15)

**Verified (branch cut from `feature/demo-feedback-readiness`):**
- `ExerciseRealtimeHub.cs:162` joins every connection to `GroupNameFor` = `exercise:{id}` (`:125`); `:174`/`:186` join
  `StaffGroupNameFor` = `exercise:{id}:staff` (`:136`) only when `IsVerifiedStaffForExerciseAsync` (`:200-224`) finds a
  `staff`-kind server-resolved principal, a live session row for the same staff user, and an assignment to the same
  host-resolved exercise; a failed check aborts (`:176-181`). Membership is decided at connect time.
- Staff group only: `EngineReviewBroadcaster.cs:80-82` (`ReviewItemChanged`), `NoiseBroadcaster.cs:50-52`
  (`NoiseStateChanged`).
- Exercise-wide group carries participant-safe payloads only: `SignalRFeedBroadcaster.cs:51,69,86` (`ParticipantPostDto`,
  `PostRemovedDto`, `PostPinChangedDto`) and `PauseOverlayPublisher.cs:220` (`ParticipantOverlayStateDto`). No staff-only
  data on `exercise:{id}` found. Engine drafts reach the feed only via `EnginePublishService` → `PostIngestService` on publish.
- Client: `core/realtime/connection.ts:194` sends the session token (`accessTokenFactory`); a participant token yields a
  participant-kind principal, which `IsVerifiedStaffForExerciseAsync` rejects before any DB read.

**Test run** (SQL Server container, not localdb):
`dotnet test src/Pulse.WebApi.Tests --filter "FullyQualifiedName~ExerciseRealtimeHubRoleIsolationTests|FullyQualifiedName~EngineReviewBroadcasterScopeTests"`
→ `Passed! - Failed: 0, Passed: 8, Skipped: 0, Total: 8`. Also
`ExerciseRealtimeHubTests.OnConnectedAsync_AnonymousConnection_JoinsOnlyTheExerciseGroup_NeverTheStaffGroup` → 1/1 passed.

