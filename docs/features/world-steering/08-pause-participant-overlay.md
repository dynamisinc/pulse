# Story: Freeze is participant-visible — overlay-state write path + SignalR push

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-023, COR-001, XC-001, XC-002  ·  **Design decisions:** D5-014/1.3, D7-004 (pause page → `participant-shell`)  ·  **Issue:** #351

> **Definition of done includes verified-in-UAT, not just unit-green.** As with story 07: this is
> not Complete on green tests alone. It must be confirmed live, mock off, with a participant tab
> and a controller tab open against the same exercise — Freeze in the controller tab must show the
> holding page in the participant tab **without a manual refresh**, and Resume must clear it live.

## Context
`participant-shell`'s `OverlayLayer` (story 05, Complete) and `GET /api/overlay-state`
(added in commit cf9ecf7 as part of the six shell-config UAT endpoints) both already exist and
both already work — but `overlay-state` is a **hardcoded constant** (`state: 'none'`) in
`ParticipantShellEndpoints.cs`. Nothing writes to it. A controller can Freeze the world all day
and no participant will ever notice, which defeats the entire point of Freeze being a safety stop:
the design decision (D5-014/1.3) is explicit that Freeze is guarded specifically **because
participants notice it**.

This story depends on story 07 landing first: it consumes the `IPauseOverlayPublisher` seam story
07 defines (and stubs with a no-op) to make Freeze/Resume actually write per-exercise overlay
state and push it live to connected participants over the ALREADY-SHARED SignalR connection
(`core/realtime/connection.ts`, `/hubs/exercise`) — the same transport `EngineReviewBroadcaster`
and the participant feed already use; this story opens no second connection. The already-built
`OverlayLayer.tsx`/`useOverlayState()` (participant-shell story 05) need **no changes** — they
already render the correct copy for `state: 'pause'` in either register; this story is data
plumbing into an existing, working consumer, not new participant UI.

## Acceptance Criteria
- [ ] Given the controller selects Freeze world (live mode) with the console's currently-selected
      `overlayRegister` (`'in-fiction'` | `'out-of-fiction'`, already exposed by `usePauseState`),
      when story 07's pause-tier transition lands server-side, then the per-exercise overlay-state
      store updates to `{ state: 'pause', register: <selected>, message: '' }` and
      `GET /api/overlay-state` for that exercise reflects it — no longer the static `'none'`
      constant.
- [ ] Given a participant session connected to the shared hub, when overlay state changes
      server-side (Freeze or Resume), then a push reaches every connected participant in that
      exercise's group and `useOverlayState()`'s live variant reconciles it — the participant's
      `OverlayLayer` shows (or clears) the holding page with **no manual refresh**.
- [ ] Given the controller Resumes from Freeze, then the overlay-state store reverts to
      `{ state: 'none', register: 'in-fiction', message: '' }` and the push clears the rendered
      holding page — verified against the existing, unmodified `OverlayLayer.tsx` (it already
      renders `null` for `'none'`).
- [ ] Given a participant reconnects (page refresh, dropped WebSocket) while the world is frozen,
      then the initial `GET /api/overlay-state` — not only the push — reflects the current state,
      so a participant joining mid-Freeze still sees the holding page (mirrors
      `liveReviewStore.ts`'s "GET seeds, push updates, reconnect re-GETs" resilience shape).
- [ ] Given the register the controller selected, the participant sees the matching, already-built
      copy — in-fiction ("We'll be right back") vs. out-of-fiction ("EXERCISE PAUSED") — with no
      change required to `OverlayLayer.tsx`'s copy or layout.
- [ ] Isolation (COR-001/XC-001): overlay state and its push are exercise-scoped; a participant
      session in exercise B never receives exercise A's Freeze push or GET response. The hub-group
      derivation reuses `ExerciseRealtimeHub.GroupNameFor` and the connect-time
      `Context.GetHttpContext()?.GetHostResolvedExerciseId()` resolution already fixed in PR #347 —
      this story does not reintroduce reading the injected, per-request `IExerciseContext` inside
      `OnConnectedAsync` (the confirmed cause of that earlier bug).
- [ ] No new telemetry event type is required — the tier-change `steering_action` event (story 07)
      already covers the causal action; this AC just confirms the overlay write path emits no
      competing/duplicate event.

## Out of Scope
Any new participant-facing UI — `OverlayLayer.tsx` is untouched; this is data plumbing into an
already-built, brand-neutral consumer. Break Fiction's `'broadcast'` overlay state (story 04,
deferred). The `'endex'` overlay state (COR-054, a separate exercise-lifecycle concern, not this
story). Holding-page content authoring (COR-032, still out of scope — the copy stays static,
generic filler). Multi-controller conflict resolution (last-write-wins, same as story 07).
WebSocket transport/App-Service configuration — already fixed in production per the referenced
PRs; this story does not re-touch hosting config, only application code.

## Technical Notes
World: participant surface (`OverlayLayer`, brand-neutral, never COBRA — untouched by this story);
the write/push side is staff-triggered backend plumbing. **Backend:** adds an `OverlayStateService`
(in-memory per-exercise store, alongside story 07's `PauseTierRegistry` under
`Features/EngineRuntime/Steering/`) and the REAL `IPauseOverlayPublisher` implementation, which (a)
updates that store and (b) broadcasts a new client event (e.g. `OverlayStateChanged`) via
`IHubContext<ExerciseRealtimeHub>` scoped to `ExerciseRealtimeHub.GroupNameFor(exerciseId)` — this
mirrors `EngineReviewBroadcaster` field-for-field (same hub context, same group derivation, no
second hub). Registers the real publisher by REMOVING story 07's `NullPauseOverlayPublisher`
registration (`services.RemoveAll<IPauseOverlayPublisher>(); services.AddSingleton<...>();`),
mirroring `EngineReviewEndpoints.AddEngineReview`'s existing `IProviderHealthListener` swap. This
story also makes **one edit** to the existing, shared `ParticipantShellEndpoints.cs`: the
`GET /api/overlay-state` handler swaps its static `OverlayState` field read for a call into the
new `OverlayStateService` — coordinate this edit if `participant-shell` has concurrent work on
that file (it currently owns five other unrelated config GETs in the same file). **Frontend:**
adds the live branch to `overlayState.ts` (owned today by `participant-shell`, but that module's
own header already names this feature as the documented future owner of exactly this wiring) —
mirrors `liveReviewStore.ts`'s `ensureStarted()`/`subscribe`/`reconcile`/`resetForTests` shape,
subscribing to the SAME shared `realtimeConnection` (`core/realtime/connection.ts`) rather than a
new connection. `useOverlayState()`'s public contract (`{state, register, message}`) is unchanged
— only its data source flips behind `USE_MOCK_DATA`, exactly like `useReviewQueue`. See
`implementation.md` for the reuse map and Wave Plan.

## Dependencies
Story 07 (the `IPauseOverlayPublisher` seam + the pause-tier transition that triggers it) — hard,
serial dependency; this story cannot start meaningfully before 07 lands. The shipped
`core/realtime/connection.ts`, `ExerciseRealtimeHub`, `SignalRFeedBroadcaster` /
`EngineReviewBroadcaster` (the reused broadcast pattern, including the PR #347 hub-scope fix). The
shipped `participant-shell` `OverlayLayer.tsx`/`overlayState.ts`/`types.ts` (story 05, Complete) —
extended, not rebuilt. The orchestrator-owned `Program.cs` wiring (the new `Add*`/`Map*` pair plus
the `RemoveAll<IPauseOverlayPublisher>` swap) lands as a serial step after Gate-2 — same #310→#317
caution as story 07.

## Tests
- Unit (backend): `OverlayStateService` reflects Freeze/Resume transitions correctly, keyed
  independently per exercise.
- Unit (backend, composition): registering the real publisher actually replaces the no-op default
  (a DI-resolution test mirroring how the #310→#317 gap should have been caught) — the resolved
  `IPauseOverlayPublisher` is the real type, not `NullPauseOverlayPublisher`, once this story's
  registration runs.
- Unit (backend): `GET /api/overlay-state` returns the live per-exercise value instead of the
  static constant, and still fails closed (`401`) on an unresolved scope.
- Unit (frontend): `overlayState.ts`'s live branch reconciles a pushed `OverlayStateChanged`
  payload, defensively validates it (a malformed payload is dropped, mirroring
  `liveReviewStore.ts`'s `isWireReviewItem` pattern), and re-GETs on hub reconnect.
- Component (RTL): `OverlayLayer` renders the correct register's copy given a live `'pause'` state
  — proves the wiring reaches an unmodified consumer correctly.
- **Manual/UAT (required for Complete):** with mock off, open a participant tab and a controller
  tab against the same exercise; Freeze in the controller tab; confirm the participant tab shows
  the holding page in the selected register with no manual refresh; Resume; confirm it clears
  live; refresh the participant tab mid-Freeze and confirm it still shows the holding page
  (GET-seeds-on-reconnect).

### AC ↔ test linkage (as built)

Backend (`src/Pulse.WebApi.Tests/Features/EngineRuntime/Steering/`):
- AC1 — `OverlayStateServiceTests.Apply_Pause_ThenGet_ReflectsTheHoldingPageState`,
  `OverlayStateServiceTests.Apply_EitherRegister_IsStoredVerbatim`,
  `PauseOverlayPublisherTests.PublishAsync_Freeze_WritesThePauseOverlay_AndPushesToTheExercisesGroup`,
  `PauseOverlayCompositionTests.AFreezeThroughTheWiredRegistry_WritesTheParticipantOverlay_PerExercise`,
  `OverlayStateEndpointTests.Get_AfterAFreeze_ReturnsTheLiveHoldingPageState_NotTheStaticConstant`.
- AC1 (the SELECTED register, plumbed end to end) — the console's `overlayRegister` now rides the
  pause-tier POST (`PauseTierRequest.OverlayRegister` → `PauseTierTransition.OverlayRegister` →
  `PauseOverlayPublisher`), validated server-side and coerced to `out-of-fiction` unless it is
  exactly `in-fiction`:
  `PauseTierEndpointsTests.Post_FreezeWithInFictionSelected_MakesTheParticipantGetReportInFiction`,
  `.Post_FreezeWithOutOfFictionSelected_MakesTheParticipantGetReportOutOfFiction`,
  `.Post_FreezeWithAnInvalidOrMissingRegister_CoercesToOutOfFiction_AndStillFreezes`,
  `.Post_Resume_ClearsTheParticipantOverlay`, `.Post_FreezeInExerciseA_LeavesExerciseBsParticipantOverlayCleared`
  (full HTTP: controller POST → registry → real publisher → participant `GET /api/overlay-state`);
  `OverlayStateEndpointTests.Get_AfterAFreezeThroughTheWiredRegistry_ReportsTheSelectedRegister`,
  `.Get_AfterAFreezeWithAnInvalidRegister_ReportsOutOfFiction`,
  `.Get_AfterAResumeThroughTheWiredRegistry_ClearsToNoneInFiction`,
  `.Get_AsExerciseB_NeverSeesAFreezeAppliedToExerciseAThroughTheRegistry`;
  `PauseTierRegistryTests.SetTierAsync_CarriesTheSelectedOverlayRegister_ToThePublisher`,
  `.SetTierAsync_AnInvalidOrMissingOverlayRegister_CoercesToOutOfFiction`,
  `.SetTierAsync_AnInvalidOverlayRegister_StillAppliesTheFreeze`;
  `PauseOverlayPublisherTests.PublishAsync_Freeze_UsesTheRegisterTheControllerSelected`,
  `.PublishAsync_Freeze_WithANonContractRegister_FallsBackToOutOfFiction`; and console-side
  `usePauseState.test.tsx` "sends the SELECTED overlay register with the Freeze POST",
  "sends the register selection as of the moment of the POST, never a stale one",
  `livePauseTierActions.test.ts` "POSTs the tier + acting human + time zone + overlay register…",
  "POSTs the in-fiction register when that is the console selection".
- AC2 — `PauseOverlayPublisherTests.PublishAsync_Freeze_WritesThePauseOverlay_AndPushesToTheExercisesGroup`,
  `PauseOverlayPublisherTests.PublishAsync_DerivesTheGroupName_ExactlyAsTheHubJoinsIt`.
- AC3 — `PauseOverlayPublisherTests.PublishAsync_Resume_ClearsTheOverlay_AndPushesTheClearedState`,
  `OverlayStateEndpointTests.Get_AfterAResume_ReturnsTheClearedStateAgain`,
  `OverlayStateServiceTests.Apply_None_AfterAPause_ClearsTheOverlay`.
- AC4 — `OverlayStateEndpointTests.Get_AfterAFreeze_ReturnsTheLiveHoldingPageState_NotTheStaticConstant`
  (+ `Get_BeforeAnyFreeze_ReturnsTheClearedNoneState`,
  `Get_WhenTheOverlaySliceIsNotWired_StillServesThePreStoryNoneConstant`).
- AC6 — `OverlayStateServiceTests.Apply_IsKeyedPerExercise_AFreezeInANeverTouchesB`,
  `OverlayStateServiceTests.Get_EmptyScope_ReadsTheClearedState_NeverAnExercisesOverlay`,
  `PauseOverlayPublisherTests.PublishAsync_TargetsOnlyTheOwningExercisesGroup_NeverAnothers`,
  `OverlayStateEndpointTests.Get_ParticipantInExerciseB_NeverSeesExerciseAsFreeze`,
  `OverlayStateEndpointTests.Get_UnresolvedScope_Returns401_NeverAnEmptyButOk200`.
- AC7 (XC-004) — `PauseOverlayPublisherTests.PauseOverlayWritePath_TakesNoTelemetryOrPersistenceDependency`.
- XC-002 — `PauseOverlayPublisherTests.PublishAsync_PayloadIsTheParticipantProjection_WithNoStaffFieldAtAll`,
  `PauseOverlayPublisherTests.ParticipantOverlayStateDto_ExposesNoStaffProperty`,
  `OverlayStateEndpointTests.Get_ResponseCarriesOnlyParticipantSafeKeys`.
- Composition (the #310→#317 lesson) — `PauseOverlayCompositionTests.ResolvedPauseOverlayPublisher_IsTheRealImplementation_NotTheNoOpDefault`,
  `.AddPauseParticipantOverlay_AfterStory07_ReplacesTheNoOpDefault`,
  `.AddPauseParticipantOverlay_BeforeStory07_StillWins`,
  `.ResolvingThePauseTierRegistry_DoesNotDeadlockOnTheOverlayPublisherCycle`.
- Out-of-order publishes (story-07 review SG-206) —
  `OverlayStateServiceTests.Apply_AnOlderSequence_DoesNotOverwriteANewerState`,
  `PauseOverlayPublisherTests.PublishAsync_ReadsTheAuthoritativeTier_NotTheTransitionsPossiblyStaleTarget`,
  `PauseOverlayPublisherTests.PublishAsync_BroadcastsTheStoresCurrentState_NotTheStateItTriedToWrite`.
- WR-004 — `PauseOverlayPublisherTests.PublishAsync_WhenTheHubThrows_SwallowsTheFailure_SoTheFreezeStands`.

Frontend (`src/frontend/src/features/participant-shell/components/OverlayLayer/`):
- AC2 — `OverlayLayer.live.test.tsx` "renders nothing until a Freeze arrives, then shows the
  out-of-fiction holding page live", `overlayState.live.test.ts` "reconciles a Freeze push …".
- AC3 — `OverlayLayer.live.test.tsx` "clears the holding page when the Resume push arrives",
  `overlayState.live.test.ts` "reconciles a Resume push back to \"none\"".
- AC4 — `overlayState.live.test.ts` "seeds a mid-Freeze holding page from the GET…",
  "re-GETs the authoritative state on every (re)connect", "treats the re-GET as ground truth…",
  `OverlayLayer.live.test.tsx` "shows the holding page from the SEEDING GET alone…".
- AC5 — `OverlayLayer.live.test.tsx` "renders the in-fiction register's copy…" (against an
  UNMODIFIED `OverlayLayer.tsx`), `overlayState.live.test.ts` "carries the in-fiction register
  verbatim".
- Defensive validation / ordering — `overlayState.live.test.ts` "drops a malformed push payload…",
  "drops a STALE push…", "keeps the previous snapshot when the GET fails…".
