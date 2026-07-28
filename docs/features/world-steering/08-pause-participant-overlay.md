# Story: Freeze is participant-visible — overlay-state write path + SignalR push

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** In Progress — built, Gate-1 clean, merged to its umbrella, Gate-2 clean (2026-07-27). NOT Complete: this story's DoD requires verified-in-UAT.
**Requirements:** CTL-023, COR-001, XC-001, XC-002  ·  **Design decisions:** D5-014/1.3, D7-004 (pause page → `participant-shell`)  ·  **Issue:** #351

> **Definition of done includes verified-in-UAT, not just unit-green.** As with story 07: this is
> not Complete on green tests alone. It must be confirmed live, mock off, with a participant tab
> and a controller tab open against the same exercise — Freeze in the controller tab must show the
> holding page in the participant tab **without a manual refresh**, and Resume must clear it live.

## DECISION — overlay precedence vs. the exercise lifecycle (Tom, 2026-07-27)

`main` has since landed a competing claimant for the single overlay slot: `ParticipantShellConfigService`
resolves `GET /api/overlay-state` through an **`IOverlayStateProjection`** seam implemented by
`LifecycleProjection`, so overlay state is derived from the exercise lifecycle (COR-032 pre-start, COR-054
ENDEX). This story instead **replaced that handler** to read its own pause-driven `OverlayStateService`.

**Ruling: lifecycle wins. One ordered chain — `endex` > `pre-start` > `pause` > `none`.**

Rationale: the lifecycle answers *"is this exercise live at all"*; pause is a control **within** a live
exercise. ENDEX in particular must be terminal — rendering the in-fiction "We'll be right back" after an
exercise has permanently ended would be an outright lie to participants. Pause still wins whenever the
exercise is actually running, which is the only time a Freeze means anything.

**Design consequence — this story gets SMALLER, not bigger.** The pause state becomes an
`IOverlayStateProjection` **contributor** that composes the lifecycle projection rather than bypassing the
seam: consult lifecycle first, and only when it yields `none` consult the pause store. Registered with
`services.Replace(...)` after both, per `main`'s documented contributor convention.

Two things fall out of that:
- **This story stops editing `ParticipantShellEndpoints.cs` entirely.** The one shared-file edit — the
  coordination point flagged throughout, sitting among five unrelated config GETs — simply disappears, and
  with it the `RequestServices.GetService` workaround and its silent-degradation trade-off.
- The `'endex'` state this story explicitly put out of scope as "a separate exercise-lifecycle concern" is
  now `main`'s, correctly, and composes above pause rather than being ignored.

**Status: BUILT (2026-07-28).** The pause write path, the SignalR push, the register plumbing and the client
guards were already Gate-2 clean; only the read-side composition changed. As built:

- `Features/EngineRuntime/Steering/SteeringOverlayPrecedence.cs` — **the ruling, in ONE place**, because this
  story has TWO participant channels. `PauseIsParticipantVisibleIn(status)` is COR-032's own behaviour hook, not
  a new vocabulary: `ExerciseLifecycleStates.BehaviourOf(status).ClockRuns`. That is `live` (and legacy `active`)
  only, so `build`/`staged` are pre-start, `completed`/`archived` are terminal, and an unrecognized status —
  including a missing `Exercise` row and the `Unconfigured` fallback — fails closed. Changing the open `staged`
  question is one line here and both channels follow.
- `Features/EngineRuntime/Steering/SteeringPauseOverlayProjection.cs` — the PULL channel: an
  `IOverlayStateProjection` that DECORATES `LifecycleOverlayStateProjection` (injected as the concrete type, so
  the interface can never resolve back into itself). Lifecycle first and its answer is final; only on `none`
  **and** a running world is `OverlayStateService` consulted, and then only a `pause` state is served (the state
  is allowlisted, symmetrically with the register coercion).
- `PauseOverlayPublisher` — the PUSH channel, **also gated (Gate-1 CR-001)**. Gating only the GET was no fix:
  nothing disconnects hub clients at EndEx (`ExerciseLifecycleGatingMiddleware` calls "nothing publishes into a
  closed exercise" an assumption, not an invariant), so a Freeze after `live → completed` pushed the in-fiction
  holding page onto a permanently ended exercise with no refresh, while that same tab's re-GET said `none`. A
  suppressed Freeze now writes **nothing** and pushes **nothing**; the tier and clock freeze still stand. It
  reads the status through an `ExerciseLifecycleStatusReader` delegate (the `PauseTierReader` idiom), which opens
  its own scope — so the singleton takes no captive dependency and its constructor still names no persistence
  type, keeping AC7's assertion honest.
- **Clearing is never gated**, deliberately asymmetric: a Resume publishes in every lifecycle state, because it
  is the only thing that can rescue a tab which was legitimately frozen before the exercise ended.
- Registered from this story's existing `AddPauseParticipantOverlay()`, so **no `Program.cs` edit is
  required**: that call already sits after `AddExerciseLifecycle()`. ⚠ That order is now **load-bearing**
  (two contributors `Replace` the same seam, so the last one wins) and is asserted against the real host.
- `ParticipantShellEndpoints.cs` is byte-identical to `main`. The `RequestServices.GetService` workaround and
  its silent-degradation trade-off are gone with it.
- `ISteeringOverlaySource` is deliberately LEFT at its `NoSteeringOverlaySource` floor. It looks like the
  intended merge seam, but `LifecycleOverlayComposer`'s rule 2 makes the composed state a `pause` if *either*
  side asks, and the source is never told the lifecycle status — so a frozen world that later reached EndEx
  would compose to `pause` and show the holding page after ENDEX. Pinned by a test so nobody "finishes the
  merge".

**Accepted consequences:**

(a) In lifecycle `paused` the composed lifecycle register stands, so a controller's `in-fiction` selection does
not override its fail-closed `out-of-fiction` — the safe direction, since an out-of-fiction notice cannot HIDE a
real stop.

(b) **`sequence` is no longer on the GET body, and this one fails OPEN in a narrow window (Gate-1 WR-002).** The
frozen `OverlayStateResponse` is three fields and two of `main`'s own tests assert exactly three, so the store's
additive `sequence` is not projected. The client's guards mostly cover it: its generation+watermark check drops a
superseded GET body *whole* before it can re-base anything, so an in-flight GET overtaken by a push is not the
problem. The residual is real, though: **after an ACCEPTED sequence-less GET the client's stale-push cutoff is 0**,
so a late out-of-order push #5 arriving after #6 was already applied is now accepted, showing a spurious holding
page over a world the controller has already resumed. It heals on the next transition or reconnect, so it is not
*stuck* — but it fails open on precisely this story's subject. Putting `sequence` back on `main`'s DTO is the real
fix and is with the orchestrator/Tom as a contract question; this story does not change `main`'s wire shape
unilaterally.

(c) ~~Residual, `staged` only: a half-applied Freeze (tier + frozen clock, no participant overlay).~~
**ELIMINATED by Tom's WR-003 ruling below** — the transition is now refused outright, so no half-applied state
can exist.

## Tom's follow-on rulings (2026-07-28, Gate-1)

**WR-003 — a Freeze outside a running world is REFUSED, loudly; `staged` stays pre-start.** Suppressing only the
participant overlay was not enough: it left tier=`freeze` plus a frozen clock plus no participant signal — a
half-applied state worse than either clean outcome, which in `staged` also started a scenario clock COR-032 says
must not run. So `POST /api/steering/pause-tier` now **refuses the whole transition**: nothing recorded, no clock
started or frozen, no overlay on either channel, and the controller is TOLD.

- **Only the Freeze transition is gated.** Resume and the other tiers apply in every lifecycle state — the ruling
  is about making a participant-visible world stop, not about locking the console.
- **`409 Conflict`** with a `{ outcome, reason }` body. 409 because the request is well-formed and authorized and
  conflicts with the exercise's *current state* — and because the console's guarded-revert machinery already hangs
  off a rejected promise, so both refusals share one client path. The sibling `clock-unavailable` refusal was moved
  onto the same body shape so the console has exactly one 409 parser and both reasons are showable.
- **The gate is the ONE shared predicate** (`SteeringOverlayPrecedence.PauseIsParticipantVisibleIn`), so the
  endpoint refusal, the participant read and the overlay push cannot disagree. The publish-path gate stays as
  defence in depth.
- **Console:** `usePauseState` exposes `refusal: { tier, outcome, reason } | null` + `dismissRefusal()`, and
  `<PausePill>` renders it beside the pill as TEXT next to a non-colour icon in a `role="status"` /
  `aria-live="polite"` region with a real keyboard-reachable Dismiss (NFR-001) — mirroring how the disabled
  `injects` tier carries its honest inline reason. It persists until the controller's next action or an explicit
  dismiss, never a timer. A definitive refusal reverts **directly** (the server promised it recorded nothing);
  every other failure still takes the ask-don't-guess re-GET path, and an *unparseable* 409 counts as ambiguous.

**WR-002 — the `sequence` window is accepted.** `main`'s `OverlayStateResponse` stays a three-field contract; the
narrow fail-open window described in (b) above is documented rather than fixed here.

**⚠ UAT precondition this creates:** a Freeze only applies — and is only participant-visible — when the exercise's
`Status` is `live` (or legacy `active`). The UAT exercise must be transitioned past StartEx before the two-tab
check. Unlike before, a controller who tries it too early now gets a clear on-screen reason instead of a Freeze
that silently does nothing.

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
story ~~also makes **one edit** to the existing, shared `ParticipantShellEndpoints.cs`~~ — **superseded by the
DECISION above.** The read side is instead a contributed `IOverlayStateProjection`
(`SteeringPauseOverlayProjection`) that composes `main`'s lifecycle projection behind the UNCHANGED handler, so
this story edits neither `ParticipantShellEndpoints.cs` nor `Program.cs` and the shared-file coordination point
is gone. **Frontend:**
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

## Follow-ups recorded during build

- **A register change WHILE already frozen does not re-push (accepted, not a defect of this story).**
  The register rides a tier TRANSITION: `usePauseState`'s `setOverlayRegister` only updates the
  console's local selection, and the selection is sent with the next pause-tier POST. So a
  controller who freezes in `out-of-fiction` and then flips the toggle to `in-fiction` sees no
  change on the participant tab until the next transition (Resume, or a re-Freeze). This is outside
  AC1, which is transition-scoped ("*when* the pause-tier transition lands"), and outside AC5, which
  is about the register the controller selected *for that Freeze*. **A UAT tester who flips the
  register mid-Freeze and sees nothing should file it against a follow-up story, not this one.**
  Making it live needs either a register-only POST + publish, or the console re-POSTing the current
  tier on a register change — both un-specced here. Noted in `usePauseState.ts`'s module header.
- **`OverlayStateService` is in-memory (a singleton), like `PauseTierRegistry`/`ExerciseClockService`.**
  An App Service restart clears overlay state; the participant's next reconnect re-GETs and heals to
  `'none'` (never a stuck holding page), and the client re-bases its sequence cutoff on that GET so
  the restarted host's re-numbered pushes are still accepted.

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
  `Get_WhenTheOverlaySliceIsNotWired_TheLifecycleProjectionStillServes_AndPauseIsSimplyAbsent`).
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
  "drops a STALE push…", "keeps the previous snapshot when the GET fails…", and the Gate-1 CR-001/SG-002
  guards: "drops a SUPERSEDED seed GET body that resolves last, keeping the newer truth", "drops a GET
  body that a push overtook while it was in flight", "drops a push with no sequence", "still accepts a
  sequence-less GET body — the pre-wiring fallback shape".
- Composition, story-07 standalone (WR-001) —
  `PauseOverlayCompositionTests.AddPauseTierSteering_Alone_StillResolvesAWorkingNoOpPublisher`.
- Participant-payload hygiene (SG-001) —
  `OverlayStateServiceTests.NextSequence_IsCountedPerExercise_NeverLeakingAnotherExercisesActivity`.

### Overlay precedence — the DECISION's test matrix (added 2026-07-28)

Every cell is proven twice: once pure (`SteeringPauseOverlayProjectionTests`, plain `[Fact]`, all six lifecycle
states) and once end to end over the real controller POST → participant GET with real SQL
(`PauseTierEndpointsTests`).

| Cell | Result | Pure test | End-to-end test |
|---|---|---|---|
| ENDEX (`completed`) + Freeze | **refused 409**; lifecycle overlay untouched, never `pause` | `.Endex_WithTheWorldFrozen_ServesTheLifecyclesTerminalAnswer_NeverThePauseHoldingPage` | `.Post_FreezeAfterEndEx_IsRefusedWithAReason_AndRecordsNothing` |
| pre-start (`build` / `staged`) + Freeze | **refused 409**; clock never started, never `pause` | `.PreStart_WithTheWorldFrozen_ServesTheLifecyclesAnswer_NeverPause` | `.Post_FreezeBeforeStartEx_IsRefusedWithAReason_AndNeverStartsTheClock` |
| running (`live`) + frozen | `pause`, in the controller's selected register | `.Running_WithTheWorldFrozen_ServesPause_InTheControllersSelectedRegister` | `.Post_FreezeInARunningWorld_ShowsTheParticipantThePausePage_InTheSelectedRegister` |
| running + not frozen | `none` (byte-identical to the shipped constant) | `.Running_WithNothingFrozen_ServesNone_ByteIdenticalToTheShippedConstant` | `.Get_InARunningWorldWithNoFreeze_ServesNone` |

WR-003 refusal, additionally: `PauseTierEndpointsTests.Post_FreezeInAnArchivedWorld_IsRefused_AndRecordsNothing`,
`.Post_ANonFreezeTierInANonRunningWorld_IsStillApplied` (only Freeze is gated). Console:
`usePauseState.test.tsx` "SURFACES the reason when the server refuses a Freeze outside a running world", "does NOT
re-GET on a definitive refusal", "clears the refusal notice on the controller's NEXT action", "clears the refusal
notice when the controller dismisses it", "reverts a Freeze the server REFUSED (an UNPARSEABLE 409), after ASKING
what is true"; `PausePill.test.tsx` "shows the server's reason as TEXT, never colour alone", "is ANNOUNCED without
stealing focus (role=status, aria-live=polite)", "dismisses from the KEYBOARD through a real button", "still shows
the honest RUNNING pill beneath the notice", "renders no refusal notice when there is nothing to report".

**The PUSH channel, per suppressed cell (Gate-1 CR-001) — every one asserts the hub received NOTHING**
(`PauseOverlayPublisherTests`): `.PublishAsync_FreezeAfterEndEx_WritesNothingAndPushesNothing`,
`.PublishAsync_FreezeBeforeStartEx_WritesNothingAndPushesNothing` (`build`, `staged`),
`.PublishAsync_FreezeInATerminalOrUnreadableWorld_PushesNothing_FailingClosed` (`archived`, a bogus literal, and a
missing row), with the positive control
`.PublishAsync_FreezeInARunningWorld_StillPushesToThatExercisesGroup_WithTheSelectedRegister` (so the suppression
tests cannot pass on a publisher that never pushes) and
`.PublishAsync_ResumeIsNeverSuppressed_SoAStrandedHoldingPageCanAlwaysBeCleared` (which also asserts the clear path
never even reads the lifecycle). Registration: `PauseOverlayCompositionTests.AddPauseParticipantOverlay_RegistersTheLifecycleStatusReaderThePrecedenceGateNeeds`.

Story-04 forward collision (Gate-1 SG-003) —
`SteeringPauseOverlayProjectionTests.ABroadcastStateInTheStore_IsNotYetReachable_AndIsTheDocumentedStory04Collision`.

Supporting: `SteeringPauseOverlayProjectionTests.LifecyclePaused_KeepsTheCor032HoldingPage_WhetherOrNotAControllerAlsoFroze`,
`.TerminalOrUnrecognizedStates_SuppressTheFreeze_FailingClosed` (incl. `archived` and a bogus literal),
`.TheLegacyActiveLiteral_IsStillARunningWorld_SoAFreezeReachesParticipants`,
`.ANonContractRegisterInTheStore_IsCoercedOnTheReadPath`,
`.SteeringPauseAppliesIn_IsTrueOnlyWhereScenarioTimeActuallyAdvances` (the gate, one row per state);
`PauseTierEndpointsTests.Get_InALifecyclePausedWorld_StillServesTheCor032HoldingPage`.

Isolation (COR-001, always-Critical) — `SteeringPauseOverlayProjectionTests.ExerciseB_NeverSeesExerciseAsFreeze`,
`.TheEmptyScope_ReadsTheClearedOverlay_NeverAnExercisesFreeze`, plus the unchanged endpoint-level
`OverlayStateEndpointTests.Get_ParticipantInExerciseB_NeverSeesExerciseAsFreeze` /
`.Get_AsExerciseB_NeverSeesAFreezeAppliedToExerciseAThroughTheRegistry` (each asserting the store DOES hold A's
freeze, so the zero is the scope closing the door).

XC-002 — `OverlayStateEndpointTests.Get_ResponseCarriesOnlyParticipantSafeKeys` (exactly
`state`/`register`/`message`; no `actingHumanId`, no `exerciseId`, no `tier`),
`SteeringPauseOverlayProjectionTests.TheServedBody_IsTheFrozenThreeFieldShape`.

Composition (the ordering trap) —
`SteeringCompositionRootWiringTests.ProgramCs_ResolvesTheSteeringPauseOverlayProjection_NotTheLifecycleProjectionAlone`
(the real `Program.cs` host, the only place a reversed `Add*` order is visible),
`.ProgramCs_LeavesTheSteeringOverlaySourceAtItsNoOpFloor_ByDesign`, and
`ExerciseConfiguration/CompositionRootWiringTests.ProgramCs_CallsAddExerciseLifecycle_...` (updated to expect the
decorator, still asserting it is not 01b's constant).

Default-deny gate integration (identity-auth-roles/11, #361) —
`SteeringCompositionRootWiringTests.SteeringRoute_WithNoCredential_IsRefusedByTheDefaultDenyGate_BeforeTheEndpointFilter`
(all four `/api/steering/*` routes),
`.SteeringRoute_WithALiveParticipantSession_ReachesTheStaffFilter_NotTheGate`,
`.OverlayStateRoute_IsGated_ButCarriesNoStaffOnlyAuthorizationMetadata`.
