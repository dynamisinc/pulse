# Story: Reaction-loop host — generate / publish / measure back-half  `[backend]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** Not Started
**Requirements:** E8 arch §1.2/§2, SOC-003 (COR-001, XC-004, XC-002, ADP-023, ADP-024, CTL-034)  ·  **Design decisions:** D5-014/1.1 (inherited)  ·  **Issue:** #285

> **Reconciles `reaction-loop` #159/#160.** Those two stories are "Blocked" pending the E2 publish
> pipeline (now B1's `PostIngestService`) and the E7 review cockpit (now `engine-review-cockpit` +
> story 02). This story builds the missing `generate → publish → measure` stages and the host that
> drives them; it does not re-implement observe/decide (built — `ObserveStage`/`DecideStage`).

## Context
The engine's reaction loop (E8 arch §1.2) is `observe → decide → generate → review → publish →
measure`. `Pulse.Core/Features/ReactionLoop` ships the pure front stages — `ObserveStage` (scenario-time
inaction triggers + addressing candidates) and `DecideStage`/`IntentComposer` (which fold curve/phase,
dial-target follow, rate caps, and resolved autonomy into a `GenerationIntent` or null). The back half
was deliberately not built because "neither the E2 publish pipeline nor the E7 review cockpit exists
yet" (`ReactionLoop/README.md`). Both now exist.

This story stands up a hosted `BackgroundService` in `Pulse.WebApi` that drives the whole loop in
**scenario time** (a scheduler, not a request/response service — E8 arch §1.2, so nothing is on a
participant's synchronous path) and builds the three missing stages: **generate** (via the built
`IGenerationProvider`, every draft guard-filtered before it can reach a human), **publish** (through
B1's blessed `PostIngestService.IngestAsync` with `origin: 'engine'` — no new publish path, SOC-003),
and **measure** (update storyline intensity/sentiment + emit telemetry). It exposes a contract-first
`IEnginePublishService.PublishBurstAsync(...)` that story 02's approve endpoint also calls, so there is
one publish funnel. Backend/staff — no participant surface. See `feature.md` and `implementation.md`.

## Acceptance Criteria
- [ ] **Scenario-time loop.** Given a running exercise with seeded/controller storylines, When the
  scenario clock (story 03's `IExerciseClock`) advances, Then the host ticks `ObserveStage` →
  `DecideStage` on the loop cadence; a **Freeze** (story 03) halts ticking so no observe/generate runs
  and silence windows do not accrue, and a **time-jump** advances the timers so a storyline that blew
  its response window during the skipped span is surfaced on the next tick.
- [ ] **Generate stage (guard-before-human).** Given a non-null `GenerationIntent`, When the host runs
  generate, Then it assembles the prompt via `PromptAssembler` + `WorldFeedFence` (untrusted world/
  participant content only inside the fenced turn, §3.4), calls `IGenerationProvider.GenerateAsync`, and
  every draft passes the `EngineEval.ContentGuard` fiction/injection filter (§9) **and** the
  `PersonaVoice.BurstAcceptancePolicy` diversity gate **before** it becomes a review item; a
  guard-failing or diversity-failing burst is auto-re-rolled (bounded retries) or dropped — **never
  surfaced** (§8.5 pre-filtering).
- [ ] **Publish reuses B1 (SOC-003).** Given an approved / auto-sent burst, When the host publishes,
  Then each post is ingested through `PostIngestService.IngestAsync` with `origin: 'engine'` and fans
  out via `IFeedBroadcaster` — no new publish path; the result is indistinguishable to participants
  from any other post.
- [ ] **Measure stage.** Given a published burst and subsequent participant reactions/amplification,
  When the host runs measure, Then it advances storyline `intensity`/`sentiment` via `Storyline.Tick` /
  `IntensityModel` / `SentimentModel` and records the storyline phase transition.
- [ ] **Shared publish seam.** The host exposes `IEnginePublishService.PublishBurstAsync(...)`; a
  manual approve in story 02 publishes through the **same** seam (one publish funnel, not two).
- [ ] **Isolation — the BackgroundService scope resolution (COR-001).** Given the loop publishes for
  exercise A, When it calls `PostIngestService.IngestAsync` (which reads scope only from
  `IExerciseContext` and fails closed when unresolved), Then the host has established exercise scope for
  that unit of work by creating a per-exercise `IServiceScope` and populating
  `ExerciseContext.CurrentExerciseId = A` — never a default/unscoped write; a tick for exercise A never
  observes, generates, or publishes into exercise B, and this extends the standing cross-exercise suite.
- [ ] **Telemetry (XC-004).** Given each stage runs, Then it emits its engine event type against the
  XC-004 v0 envelope (extended by `engine-telemetry-tuning/01`): `engine.observed` (trigger, storyline,
  scenario time), `engine.decided` (intent: personas/tone mix/count, autonomy level, rate-cap state),
  `engine.generated` (model/provider, token usage, latency, guard result), `engine.published` (post
  ref, `origin`, storyline), `engine.measured` (intensity/sentiment delta, amplification observed), and
  `storyline.state_changed` (from→to phase, cause) — each carrying wall + scenario time, actor, channel.
- [ ] **Injection-hardening stays green (ADP-024).** Given the guard-filter runs before any human sees
  a draft, Then the `EngineEval.InjectionRedTeam` suite remains **green** against whichever provider the
  host runs (Fake in CI) — a regression here blocks release (§12.2).
- [ ] **CTL-034 workload.** Given a burst of N posts, When the host enqueues it for review, Then it
  enqueues **one** `EngineReviewItem` per burst (`PostCount` informational — one burst = one decision),
  and demanded decisions stay ≤6/min sustained (`WorkloadDemandMeter`) at NFR-002 load; a design that
  pushes demand past ~6/min is flagged, not shipped.
- [ ] **XC-002.** The engine `origin` is captured but never rendered on a participant surface (inherited
  from B1's server-side read projection); the loop never emits a participant-visible provenance signal.

## Out of Scope
- **Auto mode (v1.1, `auto-mode`).** The loop routes only **Suggest** and **Delayed-auto**; it never
  publishes without a human gate or a Delayed-auto countdown.
- **`rumor-model` propagation, `contradiction-reaction`, storyline auto-detection** (E8 arch §13.1) —
  v1.1/later; the loop drives only pre-seeded / controller-created storylines.
- **The review UI and the autonomy state machine internals** — story 02 serves the queue; the
  `Autonomy`/`Storylines`/`Generation`/`PersonaVoice` domain logic is built and reused unchanged.
- **Out-of-process Function host.** v1 runs in-process in `Pulse.WebApi`; `functionapp.bicep` is the
  eventual scale-out target — flagged as `implementation.md` open question (a), not built here.
- **News / press / weather reaction hooks** — Phase 3 channels; the storyline `expectation` is
  channel-agnostic but only the Social channel is wired.

## Technical Notes
Backend / staff world — no participant skin, no COBRA (no UI at all). Owns
`src/Pulse.WebApi/Features/EngineRuntime/**`: `ReactionLoopHost.cs` (the `BackgroundService`),
`GenerateStage.cs`, `MeasureStage.cs`, `EnginePublishService.cs` (`IEnginePublishService`), and the
`AddReactionLoopHost()` / `MapEngineRuntime()` composition-root extensions.

**Reuse, do not reinvent** (see `implementation.md` reuse map): `ObserveStage`, `DecideStage`,
`IntentComposer`, `GenerationIntent`, `ReactionContext`, `ReactionSignals`
(`Pulse.Core/Features/ReactionLoop`); `IGenerationProvider.GenerateAsync`, `PromptAssembler`,
`WorldFeedFence`, `GenerationGovernance`, `TierPolicy` (`.../Generation`); `BurstAcceptancePolicy`,
`PersonaCasting` (`.../PersonaVoice`); `ContentGuard`, `InjectionRedTeam` (`.../EngineEval`);
`Storyline.Tick`, `IntensityModel`, `SentimentModel`, `StorylineStateMachine` (`.../Storylines`).
Publish: `PostIngestService.IngestAsync(CreatePostRequest)` + `IFeedBroadcaster` +
`ParticipantPostDto` (`Pulse.WebApi/Features/Social`, `.../Realtime`).

**The scope-resolution mechanism (COR-001, load-bearing).** `PostIngestService` reads
`IExerciseContext.CurrentExerciseId` and returns `PostIngestOutcome.ScopeUnresolved` when it is null/
empty (`PostIngestService.cs:79-85`). `ExerciseContext` is scoped and its `CurrentExerciseId` is
settable (`Data/ExerciseContext.cs`). So the host's publish unit of work is: create an `IServiceScope`
→ resolve the concrete `ExerciseContext` and set `CurrentExerciseId = exerciseId` → resolve
`PostIngestService` from that scope → `IngestAsync`. The engine loop always knows its `exerciseId`;
scope must stay COR-001-honest. A trusted server-side overload is an acceptable alternative — see
`implementation.md` open question (b).

**Timers are scenario-time (COR-053).** Nothing in the loop reads wall-clock; the cadence and every
silence/response window read story 03's clock. MUI/frontend conventions do not apply (backend).

## Dependencies
- **Delivered:** Phase B0 (`backend-host/01`,`02`, `exercise-isolation/01`, `telemetry/02` — #268/#269/#44/#274);
  Phase B1 (`social-api` — `PostIngestService`, `IFeedBroadcaster`, #270–#273); the built engine slices
  (`reaction-loop` observe/decide #157/#158, `engine-generation-infra`, `persona-voice-engine`,
  `storyline-model`, `autonomy-safety`, `engine-eval-harness`).
- **This feature (Wave-1 foundations for this Wave-2 story):** story 03 (`IExerciseClock` — the loop's
  timers) and story 04 (the live `IGenerationProvider` — generate runs against Fake in CI, the live
  provider in a governed deployment).
- **Contract-first, same wave:** story 02 — the `EngineReviewItem` persistence seam (the host produces
  what 02 serves) and the `IEnginePublishService` seam (02's approve calls it).
- **Foundation:** `engine-telemetry-tuning/01` (#173) — the XC-004 v0 extension the engine event types
  are added to (open question (d)).

## Tests
xUnit beside the engine (`testing-agent`; CI runs on `ubuntu-latest` with `FakeGenerationProvider`):
scenario-time loop tick + freeze-halts / jump-advances (reuse the storyline `Tick` end-to-end pattern);
guard-and-diversity gate fails a deliberately-blended / injection burst and it never reaches a review
item; publish routes through `PostIngestService` with `origin:'engine'`; the per-exercise scope is set
before ingest and a cross-exercise publish is rejected (extends the standing isolation suite);
`engine.observed/decided/generated/published/measured` + `storyline.state_changed` each emit once
against the v0 envelope; `InjectionRedTeam` green; one `EngineReviewItem` per burst (CTL-034).
