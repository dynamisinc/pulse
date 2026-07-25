# Implementation: World steering

> Staff-world levers over the E2 world + the E8 engine + the exercise clock. Several stories carry
> safety-critical D5 amendments (Break Fiction, tiered pause, dial target). Backend not present —
> steering endpoints + the real-time broadcast are the serial contract seam; mock now.

> **Wave 2 (this pass) — the backend now exists; wire it.** Stories 02/03 shipped Wave 1 entirely
> against mocks (`storylineMock.ts`, the browser-local `pausableExerciseClock`) with no consumer
> ever reached. A UAT audit this session confirmed the backend halves ARE built and simply unused:
> `ExerciseClockService`/`IExerciseClock` + `ReactionLoopHost`'s freeze-aware tick
> (`Features/EngineRuntime/Clock/`, `ReactionLoopHost.cs`), the in-memory `IReactionLoopRegistry`
> holding the live `Storyline` objects the engine ticks (no EF entity, no migration needed to reach
> them), and `Storyline.Tick`'s existing `TickTowardTarget` branch. Stories 07/08/09 wire these —
> see their per-story tech notes, the reuse-map additions, and the Wave Plan rows below. All three
> reuse the SAME orchestrator-owned-wiring caution as the rest of E7 (#310→#317): a merged,
> Gate-2-clean slice is invisible until its `Program.cs` `Add*`/`Map*` pair is wired serially — that
> is exactly how #25/#26 reached the user broken despite green tests.

> **Phase 0 reconciliation (done, this pass — Wave 1 = stories 02/03 only).** Checked against the
> FROZEN backend contracts (`Pulse.Core/Features/Storylines/Models/Storyline.cs`,
> `StorylinePhase.cs`, `Services/StorylineBriefProjection.cs`) and the SHIPPED E7 seams: `@/core/clock`
> (`IExerciseClock`, `getExerciseClock`/`setExerciseClock`/`resetExerciseClock`), the `staff-shell`
> `StaffHeader.tsx` state pill, `ControllerConsole.tsx`'s work-area layout, `@/core/telemetry`'s
> `steering_action` vocabulary (already reserved in `KNOWN_TELEMETRY_EVENT_TYPES`), and
> `@/features/participant-shell`'s `OverlayLayer/overlayState.ts` seam (which explicitly defers its
> trigger to this feature). Stories 01/04/05/06 are **not** reconciled this pass — their file
> ownership/reuse notes below are retained unchanged from the prior draft for planning continuity
> only; they are **out of the Wave-1 file-footprint plan**.
>
> **The one real reconciliation point.** `@/core/clock`'s `IExerciseClock` has no pause primitive —
> only `scenarioNow()` + optional `subscribe()`. Story 03 (tiered pause) owns a small, feature-local
> **pausable exercise clock** (`features/controller/services/pausableExerciseClock.ts`) that
> implements `IExerciseClock` and is installed via the SHIPPED `setExerciseClock()` on Freeze. On
> Resume it STAYS installed and its `resume()` is called (folding the frozen span into an
> accumulated-frozen offset) so scenario time continues with **none lost** — resetting to the
> wall-mirroring default would instead jump scenario time forward by the frozen span. This is the
> mock stand-in for story-01's native pause-aware clock provider (deferred) /
> the backend reaction-loop pause (`BACKEND_ROADMAP` B3) — the later flip swaps which `IExerciseClock`
> is installed, a contract-only change with no consumer edits (`useScenarioTime` already
> polls+subscribes generically). See story 03's Technical Notes for the full mechanics and the safety
> invariant (clock stops on Freeze, and ONLY on Freeze).

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 02 Escalation dial — **Wave 1** | One track (actual fill + target tick), click/drag/keyboard to set target. Actual + phase are read from a TS mock storyline store that mirrors `Storyline.cs` field-for-field (`Intensity` int 0–100, `TargetIntensity` int?, `Phase` label UPPERCASE per `StorylineBriefProjection.PhaseLabel`, `Sentiment` −1..1 carried for future reuse). `useStorylineTarget()` calls the mock's `SetTargetIntensity`-equivalent, logs a `steering_action` telemetry event, and exposes the target for the (deferred, Phase 2) engine-follows-target loop. | `features/controller/components/steering/EscalationDial.tsx`, `features/controller/hooks/useStorylineTarget.ts`, `features/controller/services/storylineMock.ts` | `useStorylineTarget()`, `<EscalationDial>`, the mirrored `StorylineActual`/`StorylinePhaseLabel` types |
| 03 Tiered pause — **Wave 1** | A 4-state pause machine — `running` (unpaused) / `injects` / `engine` / `freeze` (the `PauseTier` union; displayed as RUNNING / INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN) — exposed by `usePauseState()`. Freeze installs `pausableExerciseClock` via `setExerciseClock()` (see the DECISION above) so the header SCENARIO clock stops; every other tier leaves the clock untouched. `<PausePill>` renders the four labels (dot + text, NFR-001). Each tier change logs a `steering_action` telemetry event. Exposes an overlay-register selection (in-fiction/out-of-fiction) as a seam for `participant-shell`'s (deferred) trigger wiring — this story does not call `overlayState` itself. | `features/controller/hooks/usePauseState.ts`, `features/controller/components/steering/PausePill.tsx`, `features/controller/services/pausableExerciseClock.ts` | `usePauseState()` (the primitive; `DraftTimerDriver`/inject-queue/`OverlayLayer` consumers are deferred — this exposes the seam only), `<PausePill>` |
| 07 Pause server-authoritative — **Wave 2** | Backend: `PauseTierRegistry` (in-memory, per-exercise, mirrors `ExerciseClockService`'s keying) + `PauseTierEndpoints` (`POST`/`GET /api/steering/pause-tier`) calling `IExerciseClock.Freeze`/`Unfreeze` on the `freeze` transition; defines `IPauseOverlayPublisher` with a `NullPauseOverlayPublisher` default (story 08 swaps it). Frontend: `usePauseState.ts` grows a live branch (mirrors `useReviewQueue`'s `USE_MOCK_DATA` split) via a new `livePauseTierActions.ts` POST service; composes `useEngineControl()` internally so entering/leaving the `engine` tier calls its `setMode('stop'\|'live')` — the frontend-only unification with the #337 kill switch. | `Pulse.WebApi/Features/EngineRuntime/Steering/PauseTierEndpoints.cs`, `.../PauseTierRegistry.cs`, `.../IPauseOverlayPublisher.cs`; `features/controller/hooks/usePauseState.ts` (extended), `features/controller/services/livePauseTierActions.ts` | `IPauseOverlayPublisher` (the seam story 08 implements), the live-mode `usePauseState()` contract (unchanged shape) |
| 08 Pause participant overlay — **Wave 2**, dep: 07 | Backend: `OverlayStateService` (in-memory, per-exercise) + the REAL `IPauseOverlayPublisher` (registers by removing story 07's no-op default) that updates it and broadcasts `OverlayStateChanged` via `IHubContext<ExerciseRealtimeHub>` scoped to `GroupNameFor(exerciseId)` (mirrors `EngineReviewBroadcaster`). One edit to the existing `ParticipantShellEndpoints.cs`: `GET /api/overlay-state` reads the service instead of the static constant. Frontend: `overlayState.ts` (owned by `participant-shell`, whose own header names this feature as the future wiring owner) gains a live branch mirroring `liveReviewStore.ts`'s GET-seeds/push-reconciles/reconnect-resyncs shape, subscribed on the SAME `core/realtime/connection.ts` connection. `OverlayLayer.tsx` is unchanged. | `Pulse.WebApi/Features/EngineRuntime/Steering/OverlayStateService.cs`, `.../RealOverlayPublisher.cs` (name indicative); one handler edit in `Pulse.WebApi/Features/ParticipantShell/ParticipantShellEndpoints.cs`; `features/participant-shell/components/OverlayLayer/overlayState.ts` (live branch added) | the live `useOverlayState()` (unchanged public shape) |
| 09 Escalation dial live — **Wave 2**, dep: story 02, independent of 07/08 | Backend: `StorylineSteeringEndpoints` (a SEPARATE file from 07/08's, same `Steering/` folder) exposing `GET`/`POST /api/steering/storylines/{id}[/target]` reading/writing directly against the `Storyline` objects in the `IReactionLoopRegistry` registration the loop ticks — no EF entity. Frontend: `useStorylineTarget.ts` grows a live branch via `liveStorylineActions.ts` (POST) + `liveStorylineStore.ts` (GET + interval refetch, no SignalR — stays file-disjoint from 08); `<EscalationDial>` gains the explanatory legend/tooltip (scale, actual-vs-target, phase meaning). | `Pulse.WebApi/Features/EngineRuntime/Steering/StorylineSteeringEndpoints.cs`; `features/controller/hooks/useStorylineTarget.ts` (extended), `features/controller/services/liveStorylineActions.ts`, `.../liveStorylineStore.ts`; `EscalationDial.tsx` (extended, explanatory UX) | the live-mode `useStorylineTarget()` contract (unchanged shape); the explanatory legend as a reusable sub-component if a future Stories flyout needs it |
| 01 Attention levers *(deferred)* | Thin controls over E2 suggested-follows / notifications / trend weight. | `features/controller/components/steering/AttentionLevers.tsx`, `services/steeringActions.ts` | `setSuggestedFollows()`, `flagAsAlert()`, `boostTrend()` |
| 04 Break Fiction *(deferred)* | Guarded/latched Director control + type-to-confirm + all-session broadcast + per-session log. | `features/controller/components/steering/BreakFiction.tsx`, `services/breakFiction.ts` | `<BreakFictionControl>` |
| 05 Takedown *(deferred)* | Staff takedown reusing E2 soft-delete + category + Director notify; replay honors it. | `features/controller/components/steering/TakedownAction.tsx`, `services/takedown.ts` | `takedownContent()` |
| 06 Off-platform marker *(deferred)* | Event write bound to a storyline/inject that satisfies expectations. | `features/controller/components/steering/OffPlatformMarker.tsx` | `markOffPlatformResponse()` |

## Reuse map

- **COBRA theme + `@/theme/styledComponents` + `CobraStyles`** (staff surface only) —
  `src/frontend/src/theme/`. Both Wave-1 stories are staff-world; no participant skin involved.
- **`@/core/clock` (SHIPPED) — the pausable-clock seam.** Story 03 imports `getExerciseClock`,
  `setExerciseClock`, `resetExerciseClock`, and the `IExerciseClock` type; it implements its own
  `pausableExerciseClock.ts` conforming to that interface. The dependency direction is one-way and
  legal: `features/controller` may import `@/core/clock`; `@/core/clock` must NOT import back into
  `features/controller` or any other feature (it stands alone, per its own module header).
  `setExerciseClock()` is documented "not for production" — this is precisely its sanctioned mock
  use until story 01's native pause-aware provider lands (see the DECISION note above).
- **`@/core/telemetry`'s `buildAndEmit` (SHIPPED, XC-004 v0)** — every steering action (dial target
  change, pause-tier change) emits `eventType: 'steering_action'` (already reserved in
  `KNOWN_TELEMETRY_EVENT_TYPES`), `channel: 'system'`, `actor: { kind: 'system', actingHumanId, role
  }` sourced from `useControllerIdentity()`, `target: { entityType: 'storyline' | 'exercise',
  entityId }`, `payload` carrying the action detail. This mirrors
  `features/controller/engine/services/reviewActions.ts`'s `emitReviewed()` shape (same
  `buildAndEmit` call pattern, same `channel: 'system'`) — steering actions are controller/system
  actions on world state, not persona-authored content, so `actor.kind: 'system'` (not `'engine'`,
  which is reserved for engine-authored content/decisions).
- **`@/core/exerciseContext`'s `useExerciseContext()` (SHIPPED)** — `exerciseId`/`timeZone` are
  STAMPING-ONLY (COR-001) on the mock storyline store and every telemetry event; never a
  client-supplied query-scoping parameter.
- **`@/core/auth`'s `useRole()` (SHIPPED)** — gates both surfaces to staff roles (XC-002). Freeze's
  guard in Wave 1 is a **deliberate confirm step** (per D5 "Pause popover": 3 radio tiers, Freeze
  styled amber, Cancel/Pause), **not** a Director role-gate — Break Fiction (story 04, deferred) owns
  the Director-gate pattern; do not invent one for Freeze here.
- **`useControllerIdentity()` (SHIPPED, `@/features/controller/identity/controllerIdentity`)** —
  supplies `actingHumanId`/`role`/`callSign` for both stories' telemetry actor and (story 02) the
  target-change attribution.
- **The FROZEN `Storyline` contract (`Pulse.Core/Features/Storylines/Models/Storyline.cs`)** —
  story 02's `storylineMock.ts` mirrors it field-for-field: `Intensity` (int, 0–100, clamped),
  `TargetIntensity` (int?, null = unset), `Phase` (mirrors `StorylinePhase` — Dormant/Seeded/
  Escalating/Peak/Addressed/Decaying/Resolved), phase LABEL uppercased per
  `StorylineBriefProjection.PhaseLabel`. `SetTargetIntensity`'s detail-string convention (`"78 → 60"`,
  `"none → 60"`) is mirrored in the mock's telemetry payload.
- **Integration seam (orchestrator-owned, like `App.tsx` — NOT a story here).**
  - `StaffHeader.tsx`'s state pill: at integration, the pill's label is driven by `usePauseState()`
    (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN), overriding the `STATE_PILL_CONFIG[status]` label
    while paused; `running` leaves the existing RUNNING/LIVE/STAGED/etc. behavior untouched. Story 03
    builders do NOT edit `StaffHeader.tsx` — they only build `usePauseState()`/`<PausePill>` to the
    contract the orchestrator wires in.
  - `ControllerConsole.tsx`'s main content region (the `flex: 1` Box left of the 336px review-queue
    column, NOT that column) is where `<EscalationDial>` mounts at integration. **Contract note /
    resolved mismatch:** the D5 design brief places the actual+target intensity bar inside the
    toolstrip's consult-on-demand **"Stories" flyout** (a storyline-board card list, D5-016/017);
    the shipped `ControllerConsole.tsx` has no Stories flyout yet. For Wave 1, `<EscalationDial>` is
    built as a container-agnostic widget (it does not assume a flyout vs. inline mount) so it can be
    re-parented into the future Stories flyout with no rework; the orchestrator's interim integration
    step mounts it directly in the work-area's `flex: 1` region for this wave. Story 02 builders do
    NOT edit `ControllerConsole.tsx` — they only build `<EscalationDial>`/`useStorylineTarget()` to a
    props/hook contract the orchestrator wires in.
- **Deferred, not touched this wave:** E2 mechanisms (SOC-041/053/072, SOC-005/XC-010) for stories
  01/05; the real-time broadcast host (SignalR) + Director role for story 04; E8 escalation profiles
  (ADP-010) for the dial's Phase-2 follow loop; E8 expectations + E10 sink for story 06.

### Wave 2 reuse map additions (stories 07/08/09)

- **`IExerciseClock`/`ExerciseClockService` (SHIPPED backend, `Features/EngineRuntime/Clock/`)** —
  story 07's `PauseTierEndpoints` calls `Freeze(exerciseId)`/`Unfreeze(exerciseId)` on it directly;
  no new clock implementation. `ReactionLoopHost.TickExerciseAsync` already reads
  `IsFrozen(exerciseId)` to skip a tick — story 07 needs no reaction-loop code change at all, only
  the endpoint that reaches the clock the loop already checks.
- **`IReactionLoopRegistry` (SHIPPED backend, `ReactionLoopHost.cs`)** — story 09's
  `StorylineSteeringEndpoints` reads/writes the live `Storyline` objects held in a registration's
  `Storylines` list. No EF entity, no migration — storylines are process-memory only (an accepted,
  pre-existing limitation: an App Service restart clears them, requiring the existing
  `POST /api/ops/seed-engine-content` re-seed).
- **`Storyline.Tick`'s existing `TickTowardTarget` branch (`Pulse.Core/Features/Storylines/Models/Storyline.cs`)**
  — already drives actual intensity toward `TargetIntensity` when the storyline is `Escalating`/
  `Peak`. Story 09 needs no new intensity-model or reaction-loop code; it only needs the endpoint
  that lets a controller reach the live object `SetTargetIntensity` mutates.
- **`EngineCockpitStaffAuthorizationFilter` (SHIPPED, `Features/EngineRuntime/`)** — reused
  UNMODIFIED by all three new endpoint files (07's `PauseTierEndpoints`, 08's overlay-state change,
  09's `StorylineSteeringEndpoints`) for the staff-plus-assigned-exercise gate (COR-005/COR-001);
  none of the three invents its own authorization.
- **`useEngineControl()`/`liveEngineControlActions.ts` (SHIPPED, #337)** — story 07's
  `usePauseState()` composes `useEngineControl()` internally so the `engine` tier drives the SAME
  kill-switch/restore POSTs and the SAME `engineControlStore` module singleton
  `<EngineControlBar>` reads — the frontend-only unification; no new backend engine-control
  endpoint.
- **`ExerciseRealtimeHub`/`IHubContext<ExerciseRealtimeHub>` + `EngineReviewBroadcaster`'s pattern
  (SHIPPED, `Features/Realtime/`)** — story 08's overlay broadcaster reuses the SAME hub context and
  `GroupNameFor(exerciseId)` derivation, opening no second connection. Mind the PR #347 fix already
  in place: the hub resolves a connection's exercise scope from
  `Context.GetHttpContext()?.GetHostResolvedExerciseId()` at `OnConnectedAsync` time, never the
  per-request injected `IExerciseContext` (which is empty in the hub's own DI scope) — this is
  already correct and must not be "fixed" back to the broken read.
- **`core/realtime/connection.ts` (SHIPPED frontend)** — story 08's live `overlayState.ts` branch
  subscribes on the SAME shared `realtimeConnection` singleton `liveReviewStore.ts` already uses;
  no second `HubConnection`.
- **Deferred, not touched this wave:** `participant-shell`'s `OverlayLayer`/`overlayState.ts`
  consumer wiring is exactly what story 08 now builds (that seam's module header explicitly names
  this feature as the future owner of the trigger) — no longer deferred as of this pass, but
  `OverlayLayer.tsx` itself needs no code change, only its data source.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 03 Tiered pause | `features/controller/hooks/usePauseState.ts`, `features/controller/components/steering/PausePill.tsx`, `features/controller/services/pausableExerciseClock.ts` | shipped `@/core/clock` (`setExerciseClock` seam), `@/core/telemetry`, `useControllerIdentity()` | 02 | 1 | M |
| 02 Escalation dial | `features/controller/components/steering/EscalationDial.tsx`, `features/controller/hooks/useStorylineTarget.ts`, `features/controller/services/storylineMock.ts` | shipped `@/core/telemetry`, `useControllerIdentity()`, `useExerciseContext()` (self-contained mock otherwise) | 03 | 1 | M |
| — Integration seam (orchestrator) | `StaffHeader.tsx` (state-pill wiring), `ControllerConsole.tsx` (dial mount) | 02, 03 | — | 2 (serial, not a builder wave) | S |
| 01 Attention levers *(deferred)* | `AttentionLevers.tsx`, `steeringActions.ts` | E2 SOC-041/053/072 | — | deferred | M |
| 05 Takedown *(deferred)* | `TakedownAction.tsx`, `takedown.ts` | E2 soft-delete; E10 replay filter | 06 | deferred | M |
| 06 Off-platform marker *(deferred)* | `OffPlatformMarker.tsx` | E8 expectations; E10 sink | 05 | deferred | S |
| 04 Break Fiction *(deferred)* | `BreakFiction.tsx`, `breakFiction.ts` | 03 (Freeze); SignalR broadcast host (B1); Director role (B2) | — | deferred | L |
| 07 Pause server-authoritative | `Pulse.WebApi/Features/EngineRuntime/Steering/PauseTierEndpoints.cs`, `.../PauseTierRegistry.cs`, `.../IPauseOverlayPublisher.cs`; `features/controller/hooks/usePauseState.ts` (extended), `features/controller/services/livePauseTierActions.ts` | shipped `IExerciseClock`/`ExerciseClockService`, `EngineCockpitStaffAuthorizationFilter`, `useEngineControl()`/`liveEngineControlActions.ts` (#337); story 03 (`usePauseState`'s mock path, unchanged) | 09 | 3 | M |
| 08 Pause participant overlay | `Pulse.WebApi/Features/EngineRuntime/Steering/OverlayStateService.cs`, the real `IPauseOverlayPublisher` implementation; one handler edit in `Pulse.WebApi/Features/ParticipantShell/ParticipantShellEndpoints.cs`; `features/participant-shell/components/OverlayLayer/overlayState.ts` (live branch) | **07** (the `IPauseOverlayPublisher` seam — hard, serial dependency); shipped `ExerciseRealtimeHub`/`EngineReviewBroadcaster` pattern, `core/realtime/connection.ts`; shipped `OverlayLayer.tsx`/`types.ts` (participant-shell story 05, unchanged) | — | 4 (after 07 lands) | M |
| 09 Escalation dial live | `Pulse.WebApi/Features/EngineRuntime/Steering/StorylineSteeringEndpoints.cs`; `features/controller/hooks/useStorylineTarget.ts` (extended), `features/controller/services/liveStorylineActions.ts`, `.../liveStorylineStore.ts`; `EscalationDial.tsx` (extended) | shipped `IReactionLoopRegistry`/`ReactionLoopHost`, frozen `Storyline`/`TargetFollow`, `EngineCockpitStaffAuthorizationFilter`; story 02 (mock path, unchanged) | 07 | 3 | M |
| — Integration seam (orchestrator), Wave 2 | `Program.cs` (`AddPauseTierSteering()`/`MapPauseTierSteering()`, the `IPauseOverlayPublisher` swap, `AddStorylineSteering()`/`MapStorylineSteering()`) | 07, 08, 09 | — | 5 (serial, not a builder wave) | S |

Stories 02 and 03 are file-disjoint (`steering/EscalationDial.tsx` vs. `steering/PausePill.tsx`;
`hooks/useStorylineTarget.ts` vs. `hooks/usePauseState.ts`; `services/storylineMock.ts` vs.
`services/pausableExerciseClock.ts`) and have no import relationship between them — they build in
parallel in Wave 1. Docking either into the shipped shell (`StaffHeader.tsx`/`ControllerConsole.tsx`)
is a serial, orchestrator-owned integration step after both land, mirroring the `App.tsx`
composition-root rule used elsewhere in E7.

**Wave 2 DAG note.** 07 and 09 are file-disjoint (different endpoint files under the same
`Steering/` folder, different frontend service files) and share no import relationship, so they can
run in the same wave (3) despite the table above listing 09's "Can-run-with" as 07 only for
readability — 07 does not block 09 in either direction. **08 is strictly serial after 07** because
it consumes the `IPauseOverlayPublisher` interface 07 defines and its no-op default; 08 cannot be
Gate-1'd against a seam that does not yet exist. The composition-root edit (wave 5) is the
orchestrator's alone, exactly like Wave 1's integration seam — no builder branch touches
`Program.cs`.
