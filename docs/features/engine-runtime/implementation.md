# Implementation: Engine runtime (backend)

> Phase B3 of `docs/BACKEND_ROADMAP.md` — "wire the E8 engine into the host (make the world talk
> back)." A backend-heavy feature: three `[backend]` stories and one `[fullstack]` story that also
> flips a frozen frontend seam (`useReviewQueue` mock→live). **B3 is connective tissue only** — the
> `Pulse.Core` engine sub-systems are mature and out of scope for changes (BACKEND_ROADMAP §8 Risk 4).
> Two stories carry an elevated bar: **02 is `[SAFETY-CRITICAL]`** (the E8 §8.2 invariants) and **04 is
> `[TIER-2]`** (the NFR-005 governance contract — human sign-off). All four hard-depend on delivered
> Phase B0 + B1; the built engine slices are referenced by name and never edited.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 Reaction-loop host | A hosted `BackgroundService` in `Pulse.WebApi` driving `observe → decide → generate → publish → measure` in scenario time. Observe/decide are the built pure stages (`ObserveStage`/`DecideStage`/`IntentComposer` → `GenerationIntent`). **Builds** generate (call `IGenerationProvider.GenerateAsync` with a `PromptAssembler`+`WorldFeedFence` prompt; guard-filter every draft through `ContentGuard` + `BurstAcceptancePolicy` **before** it becomes a review item — re-roll/drop on fail), publish (through B1's `PostIngestService.IngestAsync` with `origin:'engine'`), and measure (`Storyline.Tick`/`IntensityModel`/`SentimentModel` + telemetry). Publish scope for the non-request-bound worker: create a per-exercise `IServiceScope`, set `ExerciseContext.CurrentExerciseId`, resolve `PostIngestService` in-scope (open question (b)). | `Pulse.WebApi/Features/EngineRuntime/{ReactionLoopHost.cs, GenerateStage.cs, MeasureStage.cs, EnginePublishService.cs}` (+ xUnit) | `IEnginePublishService.PublishBurstAsync(...)` — the single publish funnel 02's approve/edit/batch/auto-send also call; the `EngineReviewItem` persistence write (02 reads it) |
| 02 Review-cockpit API | Persist + serve real `EngineReviewItem`s to the shipped cockpit; drive the built autonomy/safety services from endpoints; push disposition/countdown changes over SignalR; flip `useReviewQueue` live. GET queue (scoped) + approve/edit/veto/re-roll/batch-approve (edit sanitizes NFR-004, then calls 01's `IEnginePublishService`) + swamped-mode + kill-switch. Auto-HOLD-on-expiry via `AutoHoldPolicy.Evaluate` on the scenario tick — **never** auto-send. | Backend: `Pulse.WebApi/Features/EngineRuntime/{EngineReviewEndpoints.cs, EngineReviewService.cs, EngineReviewBroadcaster.cs}` (+ xUnit). Frontend (flip): `features/controller/engine/hooks/useReviewQueue.ts` | The review-queue REST + SignalR contract the cockpit consumes (JSON must deserialize into the frozen `reviewContracts.ts` shapes) |
| 03 Scenario-clock service | The native COR-050 exercise clock as a backend service (StartEx + freeze/pause + discrete time-jump), behind a swappable `IExerciseClock`; adapt the engine's `IScenarioClock` onto it so `ObserveStage`/`Storyline.Tick`/`DelayedAutoCountdown` read one clock. Freeze holds the minute; a jump leaps it. | `Pulse.WebApi/Features/EngineRuntime/Clock/{ExerciseClockService.cs, ScenarioClockAdapter.cs}` (+ xUnit) | `IExerciseClock` (the native clock 01's loop + 02's countdown subscribe to); the `IScenarioClock` adapter the engine reads |
| 04 Provider live-config | Land Azure OpenAI in-tenant as the v1 default live provider via `ai.bicep`; `AddEngineGeneration` config-selects it and **fails closed** on ungoverned config; run the built `EngineEval` harness against the live provider to replace *modeled* cost/latency with *measured*, validate the §3.5 trip threshold, and keep the injection red-team green. No new provider code. | `infrastructure/modules/ai.bicep` (activation/params); `Generation:*` `appsettings` keys; the live-provider `EngineEval` run config (+ xUnit for the fail-closed gate) | The live `IGenerationProvider` selection (01's generate stage consumes it via DI); the measured cost/latency + trip-threshold record |

## Reuse map

**Built `Pulse.Core` engine services (mature — DO NOT change; reference by exact symbol):**
- **Reaction loop (front stages built):** `ObserveStage`, `DecideStage`, `IntentComposer`,
  `Models/GenerationIntent.cs`, `ReactionContext.cs`, `ReactionSignals.cs`
  (`Pulse.Core/Features/ReactionLoop/**`) — observe + decide only; 01 builds generate/publish/measure.
- **Generation:** `IGenerationProvider.GenerateAsync`, `AzureOpenAIGenerationProvider`,
  `ClaudeFoundryGenerationProvider`, `FakeGenerationProvider`, `GenerationGovernance.Validate`,
  `PromptAssembler`, `WorldFeedFence.Fence` (the §3.4 fence), `TierPolicy`, `ProviderHealth`
  (`Pulse.Core/Features/Generation/**`). DI entry `AddEngineGeneration(config)`
  (`Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs`) — config-selects the provider, Fake by
  default; `AddHttpProvider<T>` runs the governance gate first and wires the Polly circuit-breaker that
  raises the degraded-mode signal.
- **Autonomy/safety:** `EngineAutonomyState` (level resolution + `EngageKillSwitch` + `DegradeToSuggest`
  clamp + `SwampedModeEnabled`), `AutoHoldPolicy.Decide`/`Evaluate` (the load-bearing auto-HOLD),
  `AutonomyProviderHealthListener` (bridges `IProviderHealthListener` → clamp), `WorkloadDemandMeter`
  (`BudgetPerMinute = 6`) + `DemandAccounting`, `IEngineSafetySwitch`; the frozen models
  `EngineReviewItem` (+ `NeedsController`), `DraftDisposition`, `DelayedAutoCountdown`, `AutonomyLevel`,
  `EffectiveAutonomy`, `TimeoutDisposition` (`Pulse.Core/Features/Autonomy/**`).
- **PersonaVoice:** `BurstAcceptancePolicy` (the burst diversity gate), `PersonaCasting`
  (`Pulse.Core/Features/PersonaVoice/**`).
- **Storylines:** `StorylineStateMachine`, `IntensityModel`, `SentimentModel`, `TargetFollow`,
  `RateGovernance`, `EscalationCurves`, `Storyline.Tick`, and the hand-cranked
  `Services/IScenarioClock.cs` (story 03 replaces the implementation, adapts the interface)
  (`Pulse.Core/Features/Storylines/**`).
- **EngineEval (release-gating):** `ContentGuard` (fiction/injection filter), `InjectionRedTeam`,
  `VoiceDiversityRegression`, `VoiceMetrics` (`Pulse.Core/Features/EngineEval/**`).

**B1 publish path (reuse verbatim — engine posts "as an ordinary post," SOC-003):**
- `PostIngestService.IngestAsync(CreatePostRequest)` — the blessed funnel; its `AllowedOrigins` already
  includes `"engine"`, and it reads scope **only** from `IExerciseContext` and **fails closed** on an
  unresolved scope (`PostIngestService.cs:33-39,79-85` — the load-bearing caveat for 01).
- `IFeedBroadcaster.BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, ct)` + the
  `SignalRFeedBroadcaster` impl (`Pulse.WebApi/Features/Realtime/**`); `ParticipantPostDto.FromPost` —
  the single server-side XC-002 narrowing (provenance projected out on read; #270).
- `ExerciseRealtimeHub` mapped at `/hubs/exercise` (`GroupNameFor(exerciseId) => "exercise:{id}"`,
  server-derived, never client-supplied) — 02's SignalR push reuses this pattern; the frontend
  `core/realtime` connection module is the one shared connection (no second connection).
- `ExerciseContext` (scoped, `CurrentExerciseId` settable) + `AddExerciseScoping()` + the fail-closed
  `PulseDbContext` global query filter (`Pulse.WebApi/Data/**`) — the isolation seam every story inherits.

**Shipped controller cockpit UI (story 02 flips, does not rewrite):**
- `reviewContracts.ts` — the field-for-field TS mirror of the frozen C# `EngineReviewItem` /
  `DraftDisposition` / `DelayedAutoCountdown` / `AutonomyLevel` (the swap seam; do not change its shapes).
- `useReviewQueue.ts` — reads the mock `reviewStore` via `useSyncExternalStore`, delegates actions to
  `reviewActions`; **story 02 flips this hook** to the live GET + realtime subscribe.
- `ReviewQueue.tsx`, `EngineDraftEditComposer.tsx`, `SwampedModeToggle.tsx`, `services/reviewActions.ts`,
  `services/reviewStore.ts` — unchanged by the flip (`reviewStore` retires as a live path only, kept
  behind `USE_MOCK_DATA`) (`src/frontend/src/features/controller/engine/**`).

**Composition root + infra:**
- `Pulse.WebApi/Program.cs` — orchestrator-owned; already wires `AddEngineGeneration`,
  `AddPulsePersistence`, `AddExerciseScoping`, the `AddSocial*`/`MapSocial*` extensions, and the
  `ExerciseRealtimeHub`. Each engine-runtime story exposes its own `Add*/Map*` extension; the
  orchestrator wires the one-line calls serially between waves.
- `infrastructure/modules/functionapp.bicep` (dormant — the eventual out-of-process host target for 01,
  open question (a)); `ai.bicep` (dormant — 04 activates it); `signalr.bicep` (active since B1).

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|----------------|------------|---------------|------|--------|
| 03 Scenario-clock service | backend | `Pulse.WebApi/Features/EngineRuntime/Clock/{ExerciseClockService.cs, ScenarioClockAdapter.cs}` (+ xUnit) | B0 (`backend-host/01`); built `Storylines`/`Autonomy` | 04 | 1 | M |
| 04 Provider live-config | backend | `infrastructure/modules/ai.bicep` (params); `Generation:*` appsettings; live-provider `EngineEval` run config (+ xUnit for the fail-closed gate) | B0; built `engine-generation-infra` + `engine-eval-harness` | 03 | 1 | M |
| 01 Reaction-loop host | backend | `Pulse.WebApi/Features/EngineRuntime/{ReactionLoopHost.cs, GenerateStage.cs, MeasureStage.cs, EnginePublishService.cs}` (+ xUnit) | B0 + B1 (`PostIngestService`, `IFeedBroadcaster`); 03 (`IExerciseClock`) + 04 (live `IGenerationProvider`) via DI wired between waves; contract-first `EngineReviewItem` + `IEnginePublishService` seam with 02 | 02\* | 2 | L |
| 02 Review-cockpit API | fullstack | Backend: `Pulse.WebApi/Features/EngineRuntime/{EngineReviewEndpoints.cs, EngineReviewService.cs, EngineReviewBroadcaster.cs}` (+ xUnit). Frontend: `features/controller/engine/hooks/useReviewQueue.ts` (flip) | B0 + B1 (`ExerciseRealtimeHub`, `core/realtime`); built `autonomy-safety`; shipped `engine-review-cockpit`; 03 (countdown clock); contract-first `IEnginePublishService` + `EngineReviewItem` seam with 01 | 01\* | 2 | L |

`Stack` (`backend | fullstack`) tells the orchestrator which builder to spawn and which Gate-0 command
to run (`ORCHESTRATION_MECHANICS.md §5`): `03/04/01` run `dotnet build + dotnet test`; `02` also runs
the frontend gate (the `useReviewQueue` flip).

**Wave 1 = the two backend foundations the loop consumes** — 03 (behind `IExerciseClock`) and 04
(behind the live `IGenerationProvider`). File-disjoint (03 owns the clock namespace; 04 owns infra
params + the eval run config + appsettings — no overlap), so they fan out together.

\* **Wave 2 = 01 ↔ 02, a contract-first seam, not a file dependency** (mirroring social-api's
`IFeedBroadcaster` 02↔03 precedent). Two shapes are **agreed upfront in this doc** so both stories build
in the same wave against them rather than serializing:
- **`IEnginePublishService.PublishBurstAsync(...)`** — 01 owns the implementation (publish through B1's
  `PostIngestService`); 02's approve/edit/batch/auto-send call it. One publish funnel.
- **The `EngineReviewItem` persistence seam** — 01 writes review items as bursts are decided; 02 reads +
  serves + mutates disposition. The C# `EngineReviewItem` record is already frozen (`autonomy-safety`)
  and already mirrored in `reviewContracts.ts`, so the JSON contract is settled.

01 consumes 03's `IExerciseClock` and 04's live `IGenerationProvider` **via DI wired at the composition
root between Wave 1 and Wave 2** (a serial `Program.cs` edit, not a file dependency). 02's frontend flip
(`useReviewQueue` mock→live) lands only when 02's endpoints are **Gate-2 clean**. If a seam shape must
change once a builder is underway, it is coordinated as a short serial patch (the Wave-1 cross-feature
convention), not a re-plan.

### Wave-0 seam-freeze (decided — lands before the fan-out)

The **XC-004 engine event-type extension** (`engine-telemetry-tuning/01`, #173) lands **first**, as this
feature's seam-freeze: story 01's `engine.observed/decided/generated/published/measured` +
`storyline.state_changed` and story 02's `engine.reviewed` all emit against it, and "a schema mistake is
a cross-phase migration" (open question (d), decided). Treat it exactly as B1 treated
`ParticipantPostDto`/`IFeedBroadcaster` — a serial, reviewed seam commit on the umbrella before Waves 1/2
fan out, not a per-story choice. It is a hard prerequisite for the fan-out.

### Integration seam (orchestrator-owned — never a wave story)

Every surface-adding story would touch these, so no builder owns them; the orchestrator edits them
serially, between waves, in its own commit.

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `Pulse.WebApi/Program.cs` (+ DI) | Each story exposes its own extension — `AddExerciseClock()` (03), the live-provider selection (04 flips `AddEngineGeneration`'s `Generation:Provider` from Fake to `AzureOpenAI`), `AddReactionLoopHost()`/`MapEngineRuntime()` (01, registers the `BackgroundService` + `IEnginePublishService`), `AddEngineReview()`/`MapEngineReview()` (02, endpoints/DI + SignalR push). The orchestrator wires the one-line calls between waves, exactly as B1 wired the `AddSocial*`/`MapSocial*` calls. No builder edits `Program.cs`. |
| Frontend mock→live flip | `features/controller/engine/hooks/useReviewQueue.ts` (`reviewStore` → live GET + `core/realtime` subscribe); `core/config/mockData.ts` (`USE_MOCK_DATA`) | Flip `useReviewQueue` only when story 02's endpoints are Gate-2 clean; `reviewStore` stays behind `USE_MOCK_DATA`. `reviewContracts.ts` / `ReviewQueue.tsx` are **not** touched — the flip is a data-source swap behind the frozen mirror. Never a builder-owned edit. |
| Infra activation | `infrastructure/modules/ai.bicep` (`deployAi` toggle, 04); `functionapp.bicep` (dormant — the eventual out-of-process 01 host, open question (a)) | The orchestrator flips the deploy toggles; `signalr.bicep` is already active (B1). |

## Decisions & open questions

**Resolved with the product owner (2026-07-21):** (a) the loop host is **in-process** for v1; (d) the
XC-004 engine-event schema lands **schema-first, as a Wave-0 seam-freeze**; and **B3 builds after Phase
B2** (identity) — so story 02's controller endpoints and the loop's publish scope resolve against B2's
real session→exercise binding (see `feature.md` Dependencies + open question (b)). (b) stays an
engineering call at build time; (c) is resolved.

- **(a) [DECIDED — in-process for v1].** The loop host runs **in-process in `Pulse.WebApi`** (simplest,
  one composition root, `signalr.bicep` already active). `functionapp.bicep` stays the dormant scale-out
  target — revisit out-of-process only when multi-exercise concurrency or independent loop scaling is a
  real need.
- **(b) BackgroundService exercise-scope resolution for `PostIngestService` (COR-001) — the load-bearing
  01 concern.** `PostIngestService` reads scope only from a scoped `IExerciseContext` and fails closed
  when unresolved (no HTTP request → no populated scope). Two COR-001-honest options: **(i)** per-exercise
  `IServiceScope` with `ExerciseContext.CurrentExerciseId` set before resolving `PostIngestService`
  in-scope (uses the existing seam, no new API surface — **recommended**); **(ii)** a trusted server-side
  overload on the ingest path that takes an explicit `exerciseId` (the loop always knows it), gated so
  only a trusted server caller can use it. Either way the scope is server-authoritative and never
  client-derived. Decide before 01 builds; it also governs how 02's server-side auto-HOLD tick + publish
  establishes scope.
- **(c) Who owns the publish call on manual approve.** Resolved to the shared
  `IEnginePublishService` seam (01 owns it; 02 calls it) so there is exactly one publish funnel through
  B1's `PostIngestService`. Confirm the seam shape at Wave-2 kickoff.
- **(d) [DECIDED — schema-first seam-freeze].** The engine event types
  (`engine.observed/decided/generated/reviewed/published/measured` + `storyline.state_changed`) are
  **added to** the locked XC-004 v0 envelope, not forked — "a schema mistake is a cross-phase migration"
  (adversarial review D2). `engine-telemetry-tuning/01` (#173) lands its extension **first, as this
  feature's Wave-0 seam-freeze** (the way B1 froze `ParticipantPostDto`/`IFeedBroadcaster` before its
  fan-out), so 01/02 emit against a settled envelope rather than churning it — a hard prerequisite for
  the Wave-2 fan-out (see the Wave-0 seam-freeze subsection above).
