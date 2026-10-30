# Story: Refuse participant writes in Freeze and pause (#379)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress (#379: server-side refusal done; see the ACs)
**Requirements:** CTL-023, COR-032, SOC-001  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.1, §8.2 (L: live or staged (dry run); refused when paused or frozen), §10 (A5)  ·  **Issue:** #379
**Stack:** backend  ·  **Review tier:** Tier-2 (correctness, security)  ·  **Wave:** A5

## Context
Sim writes are lifecycle-gated: allowed in `live` and `staged` (dry runs), refused when paused or at the Freeze tier ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.1 "A5 adds that Freeze and pause refuse participant writes", tracker #379). Pause tiers per D5-amended CTL-023.

## Acceptance Criteria
- [x] Given Freeze world (and the tier that pauses participant activity), when a participant posts, replies, reacts, follows or uploads an avatar, then the request is refused (409 `exercise-frozen`) with no state change and a participant-visible, in-fiction-safe message.
      **As built:** the wire token is **`frozen`** (`409 {"reason":"frozen"}`), not `exercise-frozen`. It reuses the
      token `PATCH /api/posts/{id}` already returned (`PostEditRefusalReasons.Frozen`), so the client sees one
      refusal shape across every participant write. The refusal is the shared `ParticipantWriteGate`, applied by
      `.RefuseWhenWritesPaused()` before each handler runs. The covered routes are post/reply, reaction PUT/DELETE,
      follow POST/DELETE, `POST /api/media` and the post edit. The participant message is the composer's existing
      generic in-fiction refusal copy (`classifyPublishFailure` → `'refused'`). Reactions and follows roll back
      optimistically. No new tier-specific copy was added (see the a11y/two-worlds ACs below).
- [x] Given Pause injects or Pause engine only, participant writes remain allowed (per tier definitions).
- [x] Given `live` or `staged` (and not paused or Freeze), participant writes are allowed. Given `build`, `completed` or `archived`, or lifecycle `paused`, or the Freeze pause tier, participant writes are refused; readonly sessions remain read-only.
      *(`build`/`completed`/`archived` were already refused with 403 by `ExerciseLifecycleGatingMiddleware`, and the
      gate refuses them too. `paused` and Freeze are the new 409s. A read-only session is still 403 from
      `DenyReadOnlySessions()`, which runs first.)*
- [x] Controller and staff writes are unaffected by Freeze except where the matrix says otherwise.
      *(A live staff session passes the filter. See the Freeze-semantics ruling below.)*
- [ ] Refusals are telemetered (XC-004) with the actor and tier, stamped with the **server** scenario time (never a client value); no content from the refused body is stored.
- [x] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
      *(No new routes or ids. The gate reads only the server-resolved scope. The Freeze tier is per exercise, pinned
      over HTTP: Freeze on A leaves a participant post in B at 201.)*
- [ ] Accessibility (NFR-001): the refusal message is announced in a live region and is not color-only.
- [ ] Two worlds: participant message uses the brand skin; no COBRA.
- [ ] User guide (C5): `controller-guide.md` (tiers) and `participant-guide.md` updated in the same PR.

### Copilot review 2 fold (2026-10-16, ADMIN-IDENTITY-MODEL §8.2) (superseded in place by review 3: the AC above now says the same)
- [ ] Participant sim writes stay **allowed in `staged`** (dry runs, matching `ExerciseLifecycleStates.BehaviourOf(Staged)` today) and in `live`. They are refused only when paused or frozen. The route × role matrix test (story 17) encodes staged as allowed.

### Tom decision (2026-10-16, via orchestrator): no client-controlled participant `scenarioTime` (tracked under #379)
*(Revised after the orchestrator review CR-001. A ±window was rejected: the participant client sends wall-clock
time, from the Wave-0 clock mock `scenarioNow() = new Date()`, while the server clock freezes on Freeze and moves on
Jump, so every post after a Freeze would get a 400.)*
- [ ] **Bring `PostIngestService` (origin `participant`, ~:281-287 and ~:352) into line with the rest of the
      participant write paths: the server stamps scenario time and ignores the client value.** PIO is a *role*
      that also posts with origin `participant`. **Reactions, reposts/amplifies and edits already stamp
      server-side**: `ReactionService.cs` (~:283-289) and `PostEditService.cs` (~:221-225, "NEVER the wall clock").
      The reaction routes (`PUT/DELETE /api/posts/{id}/reactions/{kind}`) carry no `scenarioTime` at all. So this
      story changes **post ingest only**, and the client field stays in the contract, ignored.
- [ ] **Use the existing chain, not a new one:** `IExerciseClock.CurrentScenarioTime(exerciseId)` ??
      `Exercise.CurrentScenarioTime` ?? (for a **reply**) the parent's `CreatedScenarioTime`, with the same clamp
      the reaction path uses, so a reply is **never earlier than its parent**. Only for a **top-level post with no
      clock and no stored scenario time** is server UTC now the deliberate last resort (documented in code). The
      wall clock is never used when a scenario source exists (COR-053).
- [ ] **Freeze, resume and jump:** after a 15-minute Freeze and resume, and after a +60-minute jump, participant
      posts are accepted and stamped from the chain (tests). Plus a test that a participant reply is never
      stamped earlier than its parent.
- [ ] Staff origins (`controller-as-persona`, `inject`, `engine`, `noise`) keep their existing rules, including
      build-time backdated setup posts.
- [ ] When this lands, telemetry that records a participant write stamps the **server** scenario time, never a
      client-supplied value.
**Technical note (orchestrator review L-3):** backend tests that send a fixed participant `scenarioTime`
(`PostIngestServiceObserverTests`, `PostIngestPostCommitTests`, `PostMediaWriteTests`) need an `IExerciseClock` stub
once ingest stops honouring the client value. None is known to assert a round-trip of the client value.

### Ruling (Tom, 2026-10-19)
- **Personal pin: "Allow pins".** `kind=pin` on `PUT/DELETE /api/posts/{id}/reactions/{kind}` is a private
  bookmark, not a world write, so it is **exempt** from the held-world refusal: pin and unpin work while paused or
  frozen. Every other reaction kind (`like`, `repost`) stays refused. The exemption is an exact, case-sensitive
  match on `kind`, so `PIN` stays refused.
- **Freeze semantics: "Participants held"** (CTL-023; recorded in world-steering story 03 too). Freeze holds
  PARTICIPANTS. Staff-as-persona posts still publish and reach the held world.
- **No separate frozen-clock condition.** A Freeze tier refuses whatever the clock reads. A clock frozen without a
  Freeze tier or a paused lifecycle does not refuse.

## Out of Scope
Changing tier semantics; client-side optimistic UI beyond showing the refusal.

## Technical Notes
Backend (+ small participant UI message). One write-gate filter on participant write routes. Orchestrator clearance for route-group wiring.

## Dependencies
Wave A5, after identity 17 (matrix) and A3.

## Tests
Tier x state x route matrix tests; participant RTL for the message.

As built (#379):
- `ParticipantWriteGateTests.IsRefused_ForEveryTierAndLifecycleStatus` (AC-1, AC-2, AC-3)
- `ParticipantWriteGateTests.FreezeTier_RefusesRegardlessOfTheClockState` (AC-1, ruling)
- `ParticipantWriteGateTests.AFrozenClockWithoutAFreezeTier_DoesNotRefuse` (ruling)
- `ParticipantWriteGateTests.FreezeInOneExercise_DoesNotRefuseAnother` (AC-6)
- `ParticipantWriteGateSqlTests.IsRefusedAsync_ReadsTheStoredStatus_AndFailsClosedOnAnUnknownExercise` (AC-3)
- `ParticipantWritePauseEndpointTests.TopLevelPost_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing` (AC-1)
- `ParticipantWritePauseEndpointTests.Reply_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing` (AC-1)
- `ParticipantWritePauseEndpointTests.Reaction_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing` (AC-1)
- `ParticipantWritePauseEndpointTests.Unreact_WhileHeld_Is409Frozen_AndTheReactionStaysActive` (AC-1)
- `ParticipantWritePauseEndpointTests.Follow_WhileHeld_Is409Frozen_AndWritesNothing` (AC-1)
- `ParticipantWritePauseEndpointTests.Unfollow_WhileHeld_Is409Frozen_AndTheFollowStays` (AC-1)
- `ParticipantWritePauseEndpointTests.TopLevelPost_AtTheFreezeTier_WithTheClockRunning_IsStill409Frozen` (ruling)
- `ParticipantWritePauseEndpointTests.PersonalPin_PutAndDelete_WhileHeld_Succeed` (ruling: allow pins)
- `ParticipantWritePauseEndpointTests.NearMissPinKind_WhileHeld_IsStillRefused` (ruling: allow pins)
- `ParticipantWritePauseEndpointTests.InjectsOrEngineTier_ParticipantWrites_AreStillAccepted` (AC-2)
- `ParticipantWritePauseEndpointTests.StaffControllerAsPersonaPost_WhileHeld_IsNotRefused` (AC-4, ruling)
- `ParticipantWritePauseEndpointTests.FreezingExerciseA_DoesNotRefuseAParticipantPostInExerciseB` (AC-6)
- `MediaPausedUploadTests.ParticipantUpload_WhileHeld_Is409Frozen_AndStoresNothing` (AC-1)
- `MediaPausedUploadTests.ParticipantUpload_AtTheInjectsOrEngineTier_IsStillAccepted` (AC-2)
- `MediaPausedUploadTests.StaffUpload_WhileHeld_IsNotRefused` (AC-4)
- `PostEditEndpointTests.FreezeTier_WithTheClockRunning_StillRefusesTheEdit_WithFrozen` (AC-1, ruling)
- `PostEditEndpointTests.FrozenClock_WithNoFreezeTierAndALiveLifecycle_DoesNotRefuseTheEdit` (ruling)

### Copilot review 3 fold (2026-10-16)
- Fixed in place: the Context and the lifecycle AC no longer say live-only or refuse `staged`; writes are allowed in `live` and `staged`, refused when paused/Freeze and in build/completed/archived. The review-2 note is now consistent, not contradictory.
