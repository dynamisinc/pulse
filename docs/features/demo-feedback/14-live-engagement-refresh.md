# Story: Live engagement refresh (counts, notifications, repost notification)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-071 (live feed), D1 notifications  ·  **Decisions:** DF-17, DF-18, DF-19  ·  **Issue:** #515
**Stack:** fullstack  ·  **World:** participant  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 3  ·  **Effort:** M

## Context

Tom, 10/15: on the participant side, like / reply / repost counts and the notifications badge only change on a
reload; new posts do arrive live. A read-only investigation (10/15) found why:

- **Server:** nothing pushes a count change. `ReactionService` broadcasts nothing after a like or repost;
  `PostIngestService` sends `PostReceived` for a reply but never the parent's new reply count. Hub groups are only
  `exercise:{id}` and `exercise:{id}:staff`.
- **Client:** `PostActions` / `useReactionToggle` seed their counts once from the post view; `feedStreamSource`
  (`topLevelOnly`) drops replies, so a reply never touches its parent; `notificationsStore` finds likes only through a
  30 s background re-read that is skipped while the tab is hidden; reposts never notify (the type is
  `'reply' | 'mention' | 'like'`).

The fix adds one exercise-group push, `PostEngagementChanged`, and one small client store that every count reads.
**No migration.**

## Acceptance Criteria

### Backend

- [ ] `IFeedBroadcaster` gains `BroadcastPostEngagementChangedAsync(exerciseId, PostEngagementChangedDto, ct)` as a
      **default interface method that does nothing**, so every existing fake and test double keeps compiling;
      `SignalRFeedBroadcaster` sends `PostEngagementChanged` to `ExerciseRealtimeHub.GroupNameFor(exerciseId)` (the
      exercise group, never the staff group alone).
- [ ] New `Features/Social/Engagement/PostEngagementChangedDto.cs`:
      `{ postId: Guid, counts: { reply: int, repost: int, like: int }, version: long }`, camelCase on the wire.
      `counts` are the **shown** counts participants see (baseline + real), the same numbers the feed projection puts
      in `counts`, read through `IPostEngagementReader` (never a second counting query). **Pins never count** (DF-6).
- [ ] `version` is **monotonic per post** and computed from the database, not from a process counter (DF-18): e.g.
      the sum of the post's reaction rows (`like` + `repost`, including soft-deleted ones, counting each row's
      `DeletedAt` stamp as one more step) plus its reply count. A later state always has a higher `version` than an
      earlier one, and two app instances compute the same number. Document the formula on the DTO.
- [ ] `ReactionService` sends it **after the save commits**, on a like or repost add or remove that changed state.
      **Never** for kind `pin`, never when the call was a no-op (already liked), and the payload never carries
      `viewer`, `active`, the actor, or a baseline/real split.
- [ ] `PostIngestService` sends it for a reply's **parent** after the reply commits (the reply itself still arrives
      as `PostReceived`). A top-level post sends nothing new.
- [ ] Optional, if cheap: `Moderation/PostTakedownService.cs` sends it for a taken-down reply's parent. Skip it if it
      needs anything beyond one call.
- [ ] A broadcast failure is logged and swallowed; it never fails the write (same rule as the existing broadcasts).

### Frontend

- [ ] `realtimeFeed.ts` subscribes to `PostEngagementChanged` on the **existing** connection and validates every frame
      strictly (`postId` a string, three non-negative integer counts, `version` a non-negative integer; anything else
      dropped). It is exposed through a separate `EngagementChangeSource` interface, the same shape as
      `PinChangeSource` (subscribe returns unsubscribe), with a default source wired to `realtimeFeed`.
- [ ] New leaf `social/services/postCountsStore.ts` (`useSyncExternalStore`): `apply(postId, counts, version)` keeps
      a frame only if its `version` is higher than the one held; `usePostCounts(postId, seed)` returns the newest of
      the seed and the store; `reset()` is called from `core/auth/endSession.ts` on sign-out.
- [ ] `PostActions` and `useReactionToggle` / `useReaction` / `useAmplify` accept external counts: a push updates the
      **numbers** only. It **never changes `active`** (whether *I* liked or reposted), and an optimistic toggle in
      flight is not overwritten by an older frame. Feed, thread, profile and Pinned cards all show the new numbers
      without a reload.
- [ ] **Notifications (DF-19):** `notificationsStore` observes count increases for **my own persona's posts** (using
      `version`, so a replayed or stale frame never notifies twice) and raises the notification without waiting for
      the 30 s re-read; the badge updates live, also while the tab is hidden. Likes behave as they do today, just live.
- [ ] **New `repost` notification type:** "@x reposted your post", built like `like` (row text, icon, grouping), in
      `notificationTypes`, `notificationModel`, `notificationText` and `NotificationRow`. Where the actor's identity is
      not in the push, the store fetches it the same way the like path does today; it never invents a name.
- [ ] Mocks: the `USE_MOCK_*` feed adapter emits `PostEngagementChanged` when the mock like/repost/reply runs, so the
      mock demo shows it.

### Cross-cutting

- [ ] **Two worlds:** participant skin only. **Scenario time:** nothing new renders a time.
- [ ] **Isolation:** the push goes to the one exercise's group only; a test proves a second exercise's client gets
      nothing.

## Out of Scope

The console's Live world column counts (#461 §5; it keeps its 45 s re-read). Per-user groups. A migration.

## Tests

Backend: like / unlike / repost / unrepost each send one frame with the right counts and a higher version; a no-op
and a `pin` send none; a reply sends the parent's frame; isolation across two exercises; a failing broadcaster does
not fail the write. Frontend: validator (good and malformed frames); store ordering (stale version dropped; reset on
sign-out); `PostActions` numbers change on a push while `active` stays; optimistic toggle not overwritten; a like and
a repost on my post notify live once each; repost row text.

**Version formula (DF-18, documented on `PostEngagementChangedDto`):** `version = R + Rd + P + Pd`, where `R` = the
post's `like` + `repost` reaction rows (active and soft-deleted), `Rd` = those with `DeletedAt` set, `P` = its direct
replies (live and taken down), `Pd` = those with `DeletedAt` set. Rows are never un-deleted or hard-deleted, so every
like, unlike, repost, un-repost, reply and reply takedown raises it by exactly one; pins are not counted; all four terms
read through the exercise-scoped sets. The version is read before the counts.

**Held frame vs a card's read (Gate-1 M-3).** A mounted card shows whichever it observed last: a frame that arrives
after its read, or a re-read that re-seeds it after the last frame. On MOUNT, a held frame beats the card's read only
while the push stream has been continuous since the frame arrived: every change that moves a shown count pushes a frame
(like, repost, reply, and - added at Gate-1 - a reply takedown pushes its parent), so an unbroken stream's newest frame is
at least as new as any read. When the hub connection leaves `Connected` (`postCountsStore.markGap()`), frames may have
been missed, so a frame from before the gap no longer beats a fresh read on mount; a frame after the gap is trusted
again. This replaces comparing a receive time with each query's `dataUpdatedAt`, which no card has (feed, thread,
profile and Pinned feed cards through different readers).

**Notifications (Gate-1 M-1 / M-2).** A feed read that started before a frame was applied never moves that post's
counts (it would withdraw the notification and re-announce it). Turning a like / repost on registers it with the
notifications store first, so the rise on the viewer's own post is absorbed into the baseline silently. A failed write,
or one the server answers with a count no higher than the card held before the tap (a no-op), withdraws the note on
settle, and an unmatched note expires after 15 s (`OWN_REACTION_TTL_MS`), so it can never swallow the next person's like
(re-review N-1).

**Known limit (re-review L-A).** A frame lost while the connection stays `Connected` (a send that failed server-side and
was only logged) is not a gap the client can see: a card mounting after it can show the older held number until that
post's next frame, or until a re-read re-seeds a mounted card.

Backend (`src/Pulse.WebApi.Tests/Features/Social/Engagement/`):

- `PostEngagementChangedPushTests.LikeUnlikeRepostUnrepost_EachSendOneFrame_WithTheShownCounts_AndAStrictlyHigherVersion`
  (AC ReactionService, DTO counts = baseline + real, version monotonic)
- `PostEngagementChangedPushTests.TheFramesCounts_EqualWhatTheCallReturns_AndTheVersionIsWhatAnotherInstanceReads`
  (counts via `IPostEngagementReader`, version derived from the DB so two instances agree)
- `PostEngagementChangedPushTests.ANoOpLike_AndAPin_SendNothing` (never for `pin`, never for a no-op)
- `PostEngagementChangedPushTests.AReply_SendsItsParentsFrame_AfterItsOwnPostReceived_AndATopLevelPostSendsNone`
  (AC PostIngestService)
- `PostEngagementChangedPushTests.ThePush_TargetsOnlyTheWritingExercise_AndAnotherExercisesRowsNeverMoveIt` (isolation)
- `PostEngagementChangedPushTests.ATakenDownReply_SendsItsParentsFrame_WithTheLowerReplyCount_AndAHigherVersion`
  (optional takedown AC, done at Gate-1)
- `PostEngagementChangedPushTests.AFailingBroadcaster_NeverFailsTheReactionTheReplyOrTheTakedown_AndEachFailureIsLogged`
  (failure logged at Warning and swallowed, for all three pushes; Gate-1 L-5)
- `PostEngagementChangedWireTests.PostEngagementChanged_SerializesToExactlyPostIdCountsAndVersion` (wire shape, XC-002)
- `PostEngagementChangedWireTests.BroadcastPostEngagementChanged_SendsToTheOwningExercisesGroupOnly` (exercise group
  only; a second exercise's group and the staff group get nothing)
- `PostEngagementChangedWireTests.IFeedBroadcaster_DefaultEngagementChanged_IsANoOp_SoOlderDoublesStillWork`
  (default interface method)

Frontend (`src/frontend/src/features/social/`):

- `services/realtimeFeed.engagementChanged.test.ts`: strict validator (good frame rebuilt with only `postId`/`counts`/
  `version`; 18 malformed shapes dropped); `subscribeEngagementChanged` on the existing connection, handler isolation,
  unsubscribe and `stop()`.
- `services/postCountsStore.test.ts`: version gate (stale and equal versions dropped, per post), per-post listeners,
  `usePostCounts` newest-of seed and store, reset on sign-out through `resetClientSession()`, the reset generation
  (`pinState` pattern: a frame or mock toggle started before a reset is dropped), the 500-entry cap (Gate-1 L-3),
  the mount rule across a stream gap (M-3), the default source wired
  into the store, and the mock adapter emitting on a mock like / repost / reply.
- `components/post/PostActions.liveCounts.test.tsx`: a push moves reply / repost / like numbers while `aria-pressed`
  (`active`) stays; stale frame dropped; inert counts follow; an optimistic toggle in flight is not overwritten by an
  older frame, and a newer frame after it settles still lands; Gate-1 H-1 (a card mounted after a frame, and a remount
  from cached data, show the frame and follow later ones), M-3 (after a gap a fresher read wins on mount), M-2 (the
  toggle registers / withdraws the own reaction with the notifications store), N-1 (a server no-op like releases the
  note on settle; a real like keeps it).
- `notifications/notificationsStore.engagement.test.ts`: a like and a repost on my post notify live once each (replayed
  and stale frames and the next re-read do not re-notify); the badge moves while the tab is hidden; frames that beat
  the baseline are held and replayed; someone else's post is ignored; unsubscribe on stop; Gate-1 M-1 (frame +1, stale
  read, fresh read: one notification, the badge never dips) and M-2 (my own like and repost are silent through the
  frame and the read; a withdrawn one does not swallow the next like); N-1 (a note released after a no-rise frame, and
  an unmatched note after its 15 s TTL, both let the next +1 notify; a note matched inside the TTL stays silent).
- `services/realtimeFeed.streamGap.test.ts` (re-review L-B): with a fake shared connection, `Reconnecting` /
  `Disconnected` call `markGap()` so a held frame no longer wins on mount, `Connected` does not, and a frame after the
  gap is trusted again.
- `notifications/notificationText.test.ts` (repost row text) and `notifications/NotificationRow.repost.test.tsx`
  (Repost label, sentence, excerpt, thread link).
- Updated: `notifications/notificationsStore.test.ts` (announcement wording for reposts; the persisted record list now
  holds a `repost:`-keyed record per own post).
