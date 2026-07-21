# Implementation: Reaction loop

> The scenario-time orchestration wiring storyline-model + persona-voice-engine + generation-infra
> into the E7 cockpit (#34–36) and E2 publish. Backend .NET absent; this is a scheduler, not a
> request/response service. The reactive-behavior features register the decide-stage trigger→intent
> policies.
>
> **Back-half now built in `engine-runtime/01` (Phase B3).** Backend .NET now exists (Phase B0/B1),
> so the plan below's stories 03/04 are no longer speculative `services/loop/*` sketches — the real
> generate/publish/measure stages are built as `docs/features/engine-runtime/01-reaction-loop-host.md`'s
> `GenerateStage`/`MeasureStage`/`EnginePublishService`, wired to this feature's built `ObserveStage`/
> `DecideStage` output and publishing through B1's `PostIngestService`. The rows below are kept for
> historical/planning context; they are not the as-built file layout for 03/04.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Observe stage | Subscribe to clock + pause state + E2 activity; raise inaction triggers in scenario time. | `services/loop/observe` | `observe(exercise) → Signals` (triggers, timers, addressing candidates) |
| 02 Decide stage | Compose intent from storyline rules + curve + caps + target + autonomy; behaviors register policies. | `services/loop/decide`, policy registry | `decide(signals) → Intent[]`; `registerBehavior(policy)` |
| 03 Generate→review→publish | Generate burst → guard → route by autonomy → E2 publish. **Realized by `engine-runtime/01`** (`GenerateStage.cs`, `EnginePublishService.cs`) against the real `IGenerationProvider`/`ContentGuard`/`PostIngestService` — see that feature's `implementation.md` for the as-built files. | `services/loop/dispatch` *(superseded — see `engine-runtime/01`)* | `dispatch(intent) → queued \| published` *(realized as `IEnginePublishService.PublishBurstAsync`)* |
| 04 Measure stage | Observe downstream signals; update storyline; emit `engine.measured`. **Realized by `engine-runtime/01`** (`MeasureStage.cs`) against `Storyline.Tick`/`IntensityModel`/`SentimentModel`. | `services/loop/measure` *(superseded — see `engine-runtime/01`)* | `measure(published) → storyline update + telemetry` |

## Reuse map
- **`storyline-model`** — state, curves (03), caps (04), target-follow (05); `tickIntensity`/`computeSentiment`.
- **`persona-voice-engine`** — burst generation + diversity gate + eligible personas.
- **`engine-generation-infra`** — provider + prompt assembly + pre-review guard + tiering.
- E1 **exercise clock (COR-050/051)** + **tiered-pause state (#26)** — scenario-time ticks, freeze halts timers.
- **engine-review-cockpit (#34–36)** — the review queue / Delayed-auto countdown / auto-HOLD target.
- **autonomy-safety** — the autonomy level per storyline; Delayed-auto + auto-HOLD semantics.
- E2 **publish pipeline** — output path (persona-authored, origin hidden SOC-003); amplification/reaction signals for measure.
- Telemetry emitter (`XC-004`) — `engine.observed/decided/generated/published/measured`.
- off-platform marker (#29) — an addressing candidate in observe.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Observe stage | services/loop/observe | E1 clock/pause, storyline-model, E2 activity | — | 1 | M |
| 02 Decide stage | services/loop/decide, policy registry | 01, storyline-model, autonomy-safety, voice-engine | — | 2 | M |
| 03 Generate→review→publish | services/loop/dispatch | 02, generation-infra, voice-engine, cockpit #34–36, E2 | — | 3 | L |
| 04 Measure stage | services/loop/measure | 03, storyline-model 02, E2 signals | — | 4 | S |

Strictly sequential — it's a pipeline (observe→decide→generate→measure). The reactive-behavior
features depend on the decide-stage policy registry (wave 2 export). Frontend→backend edge serial;
the `dispatch` seam integrates with the already-built cockpit (#34–36).

> **Pointer (Phase B3).** Waves 3 and 4 above are superseded by `engine-runtime`'s Wave Plan: the
> generate/publish/measure work is built as `engine-runtime/01` (Wave 2 there), depending on this
> feature's built observe/decide output plus `engine-runtime/03` (scenario clock) and `engine-runtime/04`
> (live generation provider) from `engine-runtime`'s Wave 1. See
> `docs/features/engine-runtime/implementation.md` for the as-built Wave Plan and reuse map.
