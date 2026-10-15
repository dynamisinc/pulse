# Story: Edit own post: backend

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** D1 parity (X edit), COR-053, NFR-004, XC-002, XC-004  ·  **Decisions:** DF-29..DF-33, DF-39  ·  **Issue:** #537
**Stack:** backend  ·  **World:** participant (API)  ·  **Review:** Tier-1 (new write route; Gate-1 checks authz closely)  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** M
**Owner:** planning session · **Branch:** `build/demo-feedback/19-edit-post-api` → `feature/demo-feedback-w4`

## Context

Tom wants players to fix a typo in their own post, as on X. Today there is no edit concept anywhere
(`Post` has no edit fields; `POST /api/posts` is the only write). Agreed 10/15: own posts **and replies**, **text
only**, a **15-minute** window, history visible to everyone, participants only (controllers keep takedown).

## Acceptance Criteria

- [x] `PATCH /api/posts/{postId:guid}` `{ text }`, in a new `Features/Social/Editing/` slice
      (`PostEditService`, `PostEditEndpoints`). The caller must be a **participant session** whose
      `CurrentSessionPersona.PersonaId == post.AuthorPersonaId` (resolved through `ICurrentSessionPersonaAccessor`, as
      `PostAttributionResolver` does) and `post.Origin == participant`. Otherwise 403; a post in another exercise or
      taken down (`DeletedAt` set) is 404. Staff sessions get 403 (DF-32). Read-only sessions are refused like other
      participant writes.
- [x] Text goes through `PostSanitizer.Sanitize` and the same length/empty rules as create (400 on violation).
- [x] Window and limit (DF-30): refused with 409 `{ reason: "window-closed" }` when `utcNow − CreatedWallClock >
      15 min`, `{ reason: "edit-limit" }` when `EditCount == 5`, `{ reason: "frozen" }` whenever posting is refused:
      pause tier Freeze, a frozen clock, or a lifecycle that is paused or ended (Tom 10/15 evening). The 15-minute window
      keeps running while edits are blocked.
- [x] Identical sanitized text ⇒ 200 with the current post, nothing written, nothing pushed (DF-33).
- [x] On a real edit, one transaction: insert `PostEdit { EditNumber = EditCount + 1, PreviousBody = old Body,
      EditedAt = utcNow, EditedScenarioTime = IExerciseClock.CurrentScenarioTime (fallback as create) }`, set
      `Body`, increment `EditCount`, set `LastEditedAt` / `LastEditedScenarioTime`. Media, parent, author, origin and
      counts are untouched.
- [x] After commit, `IFeedBroadcaster.BroadcastPostEditedAsync` (new **default no-op interface method**, as DF-17)
      sends `PostEdited { postId, text, edited { count, scenarioTime }, version = count }` to the exercise group only.
      A broadcast failure is logged and swallowed. No `PostReceived`, no mention notification, no engagement push.
- [x] Read contract: `ParticipantPostDto` and the staff post DTO carry `edited: { count, scenarioTime } | null`
      wherever posts are projected (feed, thread, profile, Pinned, Live world reads). `viewer.editableForSeconds` is
      present **only for the viewer's own participant-origin posts**: seconds left in the window, 0 when closed or at
      the limit. `LastEditedAt` (wall) is never in a participant DTO.
- [x] `GET /api/posts/{postId:guid}/edits` → `PostEditHistoryDto`: versions newest first, the current text as
      `editNumber = EditCount` with `LastEditedScenarioTime`, then each `PostEdit` (its `PreviousBody` is the text of
      version `EditNumber − 1`), down to the original (`editNumber 0`, `CreatedScenarioTime`). Any session in the
      exercise; 404 for another exercise or a taken-down post. Scenario times only.
- [x] Export (`Features/Exports`): three columns appended to `Posts`: `Edits`, `Last edited (scenario)`,
      `Original text` (the `PreviousBody` of edit 1; blank when never edited). Text written as values, never formulas.
- [x] Export second sheet **`Edit history`** (DF-39, amends DF-8's one sheet): one row per version of every edited
      post or reply (`Post id`, `Edit number` with 0 = original, `Scenario time`, `Wall clock (UTC)`, `Text`,
      `Current` yes/no), as specified in WAVE-4.md "Export columns". Never-edited posts have no rows. Autofilter and
      frozen header; text as values, never formulas.
- [x] The `PostEdit.ExerciseId` is copied from the loaded, exercise-filtered `Post`, never from the request; the DB
      does not tie them (17 Gate-1 L-1). `EditNumber` stays within 1..5 in code (L-3). A test proves an edit row always
      carries its post's exercise.
- [x] Telemetry `post.edited` (postId, editNumber, wall + scenario time, session kind); no text.

## Out of Scope

Editing media, controller/staff editing, editing engine/noise/inject posts, re-running mention notifications,
moderation of edits (takedown still removes the whole post), engine reaction to an edit. Frontend (20).

## Technical Notes

`Social/PostWriteEndpoints.cs` (create at :80) for route style and session checks; `PostIngestService.cs:321`
sanitizer call; `Social/ParticipantPostDto.cs` (`FromPost` :128) and `PostWireDtos.cs`;
`Realtime/SignalRFeedBroadcaster.cs` event consts (:25-34) for the `PostEdited` name; `PostEngagementVersion` is
**not** used (the edit version is `EditCount`). Reuse `NoStoreEndpointFilter` on the history read if the other post
reads use it.

## Dependencies

17. Seam S-5 maps the routes. 20 consumes the contract.

## Tests

`src/Pulse.WebApi.Tests/Features/Social/Editing/`: own post and own reply edit; another participant's post 403;
staff session 403; engine/noise/controller-as-persona origin 403; taken down 404; other exercise 404 (isolation);
window closed at 15:01 (`FakeTimeProvider`); sixth edit refused; Freeze refused; identical text no-op with no push;
sanitizer applied (a `<script>` edit stored inert); history order and texts across 3 edits; DTO `edited` and
`editableForSeconds` (own only, never `LastEditedAt`); `PostEdited` wire shape and exercise-group-only target; failing
broadcaster does not fail the edit; export columns (formula-looking edit stays text); `Edit history` sheet (rows per version, version texts and times
match the history read, current flag on the last version only, never-edited posts absent, a `=` edit stays text);
edit refused while the lifecycle is paused or ended, and the window still closes at 15:01 after a pause; telemetry has no text.

**Linked tests (story 19 build).** E = `Editing/PostEditEndpointTests`, C = `Editing/PostEditContractTests`,
W = `Editing/PostEditWorkbookTests`, X = `Editing/PostEditExportEndToEndTests` (real SQL tests are `[RequiresDockerFact]`;
the wall clock is the repo's hand-advanced `ManualTimeProvider`, its stand-in for `FakeTimeProvider`).

- AC-1 (route, who may edit): E.OwnPost_Edit_Returns200_WritesOneEditRow_AndUpdatesThePostInOneTransaction,
  E.OwnReply_EditsTheSameWay_AndKeepsItsParent, E.AnotherParticipantsPost_Returns403_AndWritesNothing,
  E.StaffSession_Returns403_EvenWhenBoundToTheAuthorPersona, E.ReadOnlySession_IsRefused_LikeEveryParticipantWrite,
  E.NonParticipantOrigins_Return403, E.TakenDownPost_Returns404,
  E.AnotherExercisesPost_Returns404_AndIsNeverWritten_EvenForTheSamePersonaId, E.UnresolvedScope_Returns401
- AC-2 (sanitizer, length/empty): E.Sanitizer_IsApplied_AScriptEditIsStoredInert,
  E.EmptyMissingOrTooLongText_Returns400_AndWritesNothing
- AC-3 (window, limit, frozen): E.Window_IsOpenAt14m59_AndClosedAt15m01, E.SixthEdit_IsRefused_WithEditLimit,
  E.FreezeTier_RefusesTheEdit_WithFrozen, E.FrozenClock_RefusesTheEdit_WithFrozen,
  E.PausedOrEndedLifecycle_RefusesTheEdit_WithFrozen, E.TheWindowKeepsRunningThroughAPause_AndStillClosesAt15m01,
  C.Window_ClosesStrictlyAfterFifteenMinutes, C.EditableForSeconds_CountsDown_AndIsZeroWhenClosedOrAtTheLimit
- AC-4 (identical no-op): E.IdenticalSanitizedText_Is200_WithNothingWrittenAndNothingPushed
- AC-5 (one transaction): E.OwnPost_Edit_Returns200_WritesOneEditRow_AndUpdatesThePostInOneTransaction
- AC-6 (PostEdited push): E.ARealEdit_PushesOnePostEdited_ToItsExerciseOnly_AndNeverAPostReceived,
  E.AFailingBroadcaster_DoesNotFailTheEdit, C.SignalRBroadcaster_SendsPostEdited_ToTheExerciseGroupOnly_WithTheFrozenShape,
  C.DefaultInterfaceMethod_IsANoOp_ForOlderBroadcasterDoubles
- AC-7 (read contract): E.FeedAndThread_CarryEdited_AndEditableForSecondsOnlyOnTheViewersOwnParticipantPosts,
  C.ParticipantPostDto_FromPost_CarriesEditedNullWhenNeverEdited_AndTheScenarioSummaryOnceEdited,
  C.StaffPostDto_CarriesEdited_TheSameWay, C.ViewerState_OmitsEditableForSeconds_UnlessSet,
  C.OnlyTheViewersOwnParticipantPost_IsEditableForThem
- AC-8 (history read): E.History_AcrossThreeEdits_IsNewestFirst_WithEveryVersionsTextAndScenarioTime,
  E.History_OfANeverEditedPost_IsTheOriginalAlone_AndATakenDownPostIs404,
  E.AnotherExercisesPost_Returns404_AndIsNeverWritten_EvenForTheSamePersonaId
- AC-9 (Posts columns): W.PostsSheet_AppendsTheThreeEditColumns_AndAFormulaLookingOriginalStaysText,
  X.Export_CarriesTheEditColumns_AndOneEditHistoryRowPerVersion_MatchingTheHistoryRead,
  `Exports/PostExportWorkbookTests` (header list + filter range updated)
- AC-10 (Edit history sheet): W.EditHistorySheet_HasItsColumns_BoldFrozenHeader_Autofilter_AndTextValuesNeverFormulas,
  W.AnExportWithNoEdits_StillHasTheEditHistoryHeaderAndAFilter,
  X.Export_CarriesTheEditColumns_AndOneEditHistoryRowPerVersion_MatchingTheHistoryRead
- AC-11 (PostEdit scope, EditNumber 1..5): E.EveryEditRow_CarriesItsPostsExercise, E.SixthEdit_IsRefused_WithEditLimit
- AC-12 (telemetry): E.Telemetry_IsOnePostEditedEvent_WithIdsAndTimes_AndNoText

**Build notes.** Routes are exposed as `AddPostEditing()` / `MapPostEditing()` for seam S-5 (the PATCH carries its own
`DenyReadOnlySessions()`). "Posting is refused" is computed in `PostEditService` (pause tier Freeze, a frozen clock, or
`ExerciseLifecycleBehaviour.ParticipantWritesAccepted == false`): `POST /api/posts` itself has no server-side
Freeze/paused refusal to reuse. `ParticipantPostProjector.cs` (not in the wave-plan row) carries the read-side
`edited` / `editableForSeconds` because every feed/thread/Pinned/Live-world read goes through it. A concurrent
double-submit that loses at the (`PostId`, `EditNumber`) unique index is a bodiless 409 and writes nothing.
