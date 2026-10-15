# Story: Pins: personal and exercise-wide

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** feeds-discovery (new: Pinned)  ·  **Decisions:** DF-5, DF-6, DF-7  ·  **Issue:** #500
**Stack:** backend  ·  **Review:** Tier-1 (reaction isolation checked at Gate 1)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

Participants watch a newscast once, then want to rewatch it. The notes ask for a **Pinned** tab next to All and
Following. Tom decided it holds three things: posts the viewer liked, posts the viewer pinned, and posts a
controller pinned **for everyone**. There is no server read for "posts I liked" today (the profile Likes tab filters
the newest 200 client-side), so this story adds one read for the whole tab, the personal pin, the exercise pin, and a
live `PostPinChanged` push. Shapes are frozen in [`implementation.md`](implementation.md#types).

## Acceptance Criteria

- [ ] **Personal pin (DF-6):** `PUT` / `DELETE /api/posts/{postId}/reactions/pin` work like `like` (idempotent, a
      participant session only, the post must be visible in the exercise) and return `ReactionStateDto` whose
      `viewer.pinned` reflects the change. **Counts never change** for a pin, and no other viewer can see it.
- [ ] **Viewer state:** every participant post projection (feed, following, thread, `PostReceived`, pinned feed) carries
      `viewer.pinned` for the caller's persona; `PostEngagementReader` returns `ViewerPinned` and counts `like` and
      `repost` **explicitly**, never all kinds.
- [ ] **Exercise pin (DF-7):** `PUT /api/staff/posts/{postId}/pin` (controller role) sets `PinnedForAllAt` to the
      current scenario time and `PinnedForAllByHumanId` to the staff user; `DELETE` clears both. Both are idempotent and
      answer `204`; a post outside the exercise or taken down ⇒ `404`. Every projection carries `pinnedForAll: true`
      while set (omitted otherwise).
- [ ] **Push:** after each exercise pin change commits, `PostPinChanged { postId, pinnedForAll }` goes to the exercise
      group (`GroupNameFor`), so connected participants and consoles see it live. A failed push is logged and never
      fails the request (same pattern as `BroadcastPostRemovedAsync`).
- [ ] **Pinned feed:** `GET /api/feed/pinned` returns `PinnedFeedResponse` in DF-5 order: exercise pins first (newest
      pin first), then the caller's `pin` and `like` reactions merged (newest reaction first), each post once (reason
      precedence `exercise` > `pin` > `like`), replies included, taken-down posts excluded, at most 200 items. A staff
      session gets the exercise pins only. No exercise scope ⇒ 401, like `GET /api/feed`.
- [ ] **Takedown:** a taken-down post leaves the pinned feed immediately (the existing `PostRemoved` push already tells
      clients); un-pinning a taken-down post for everyone is still allowed (`DELETE` ⇒ 204).

### Cross-cutting
- [ ] **Isolation (XC-001):** a pin or pinned read never resolves a post, persona or reaction outside the caller's
      exercise; pinning a post id from exercise B ⇒ 404 exactly as an unknown id. Extend the isolation suite.
- [ ] **Two worlds (XC-002):** `PinnedForAllByHumanId` never appears on a participant projection.
- [ ] **Telemetry (XC-004):** `post.pinned` / `post.unpinned {scope}` per change, actor as the reaction/takedown events.

## Out of Scope

The participant tab and Pin button (07), the console action (08). Pin ordering by controllers, pin limits, pin
notifications.

## Tests

Reaction route with `pin` (participant ok, staff/view-only refused, counts unchanged), `viewer.pinned` in each
projection, exercise pin set/clear/idempotent/404, push sent on change and not on a no-op, pinned feed order and
de-duplication, takedown exclusion, staff pinned feed, isolation A/B, telemetry.

All under `src/Pulse.WebApi.Tests/Features/Social/Pins/` unless noted. The DB suites run on the real `Program` host
(`PinsWebApplicationFactory` maps `MapPostPins()` until seam S-2 wires it, and skips mapping once Program does).

| AC | Tests |
|---|---|
| Personal pin (DF-6) | `PersonalPinTests.PinThenUnpin_Participant_FlipsViewerPinned_CountsNeverMove_OneEventPerChange`, `.APin_IsInvisibleToEveryOtherViewer_AndNeverChangesTheirCounts`, `.StaffAndReadOnlySessions_AreRefused_AndWriteNothing`, `.TakenDownOrUnknownPost_Returns404`; `Reactions/ReactionServiceAuthorizationTests.ThePinKind_FollowsTheSameParticipantOnlyAllowlist`, `.ThePinKind_WithNoScope_FailsClosed` |
| Viewer state | `PinProjectionTests.EveryParticipantProjection_CarriesViewerPinned_AndPinnedForAll_NeverWhoPinnedIt` (feed, following, thread, pinned feed); `PinEngagementReaderTests.Pins_AreNeverCounted_AndOnlyTheViewersOwnPinIsReported`, `.AnUnpinnedRow_IsNotReportedAsPinned`; `PinWireShapeTests.ViewerState_SerializesLikedRepostedAndPinned` |
| Exercise pin (DF-7) | `ExercisePinEndpointTests.Pin_Returns204_StampsScenarioTimeAndTheStaffUser_EmitsOneEvent_AndPushesOnce`, `.Pin_Repeated_Returns204_DoesNotMoveThePin_AndNeitherEmitsNorPushesAgain`, `.Unpin_ClearsBothColumns_EmitsUnpinned_PushesFalse_AndARepeatIsANoOp`, `.Unpin_NotPinned_Returns204_AndNeitherEmitsNorPushes`, `.Pin_ClockNotRunning_StampsTheStoredScenarioTime_NeverTheWallClock`, `.Pin_TakenDownPost_Returns404_AndWritesNothing`, `.Pin_UnknownPost_Returns404`, `.Evaluator_Gets403_AndNothingChanges`, `.Participant_ReadOnly_And_Anonymous_Get401_AndNothingChanges`; `PinProjectionTests.AStaffFeedRead_CarriesPinnedForAll_WithoutViewerOrWhoPinnedIt`; `PinWireShapeTests.FromPost_PinnedForAll_IsTrueWhenSet_AndOmittedOtherwise_NeverCarryingWhoPinnedIt` |
| Push | `ExercisePinEndpointTests` (push once on change, none on a no-op), `.Pin_PushFails_StillReturns204_KeepsThePin_AndLogsAWarning`; `PinWireShapeTests.BroadcastPostPinChanged_SendsPostPinChanged_ToTheExerciseWideGroupOnly`, `.PostPinChanged_SerializesToExactlyPostIdAndPinnedForAll`, `.IFeedBroadcaster_DefaultPinChanged_IsANoOp_SoOlderDoublesStillWork` |
| Pinned feed | `PinnedFeedTests.Participant_GetsExercisePinsFirst_ThenOwnPinsAndLikesNewestFirst_EachPostOnce`, `.StaffAndReadOnly_GetTheExercisePinsOnly_WithNoViewerState`, `.TheTab_IsCappedAt200_KeepingTheNewest`, `.Anonymous_Gets401_NeverAnEmpty200`; `PinWireShapeTests.PinnedFeedResponse_SerializesItemsOfReasonAndPost`, `.PinnedFeedService_WithNoScope_ReadsNothing` |
| Takedown | `PinnedFeedTests.ATakenDownPost_LeavesTheTabImmediately`; `ExercisePinEndpointTests.Unpin_TakenDownPost_IsStillAllowed_Returns204_AndClearsThePin` |
| Isolation (XC-001) | `PinIsolationTests.ExercisePin_OnAnotherExercisesPost_Is404LikeAnUnknownId_AndTouchesNothing`, `.PersonalPin_OnAnotherExercisesPost_Is404_AndWritesNoReaction`, `.PinnedFeed_InA_NeverShowsBsExercisePins_OrAnyReactionRowStampedB` |
| Two worlds (XC-002) | `PinProjectionTests` (both tests assert the pinner never reaches the wire); `PinWireShapeTests.FromPost_PinnedForAll_*` |
| Telemetry (XC-004) | `PersonalPinTests.PinThenUnpin_*` (`post.pinned`/`post.unpinned {scope:'personal'}`, persona actor); `ExercisePinEndpointTests.Pin_Returns204_*`, `.Unpin_ClearsBothColumns_*` (`{scope:'exercise'}`, system actor with the staff user as acting human) |

## Tech notes

Own new `Features/Social/Pins/**` (`PinEndpoints.cs` with `AddPostPins()` / `MapPostPins()`, `PinService.cs`,
`PinnedFeedService.cs`), and the listed edits to `ReactionService.TryParseKind`, the engagement reader, the post
DTOs/projector, and `SignalRFeedBroadcaster` + its interface. The staff route follows `ModerationEndpoints.cs:79-87`.
