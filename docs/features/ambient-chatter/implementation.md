# Implementation: Ambient chatter

> Wave C2 (rewritten 2026-10-16). ADP-005 background posting, now **autonomous within a human-set tier policy**.
> Backend .NET exists; this plugs into the reaction-loop decide registry as a lowest-priority policy and adds a
> gated autonomous publish branch. **No schema / EF migration** (brief C1 rule 1; persistence is wave C3).

## Per-story tech notes

| Story | Approach | Key files it will own | Exports |
|-------|----------|-----------------------|---------|
| 01 Ambient background posting | Two edges. **A (policy + settings):** `AmbientTierPolicy` + in-memory `EngineAmbientPolicyRegistry` (sibling of `EngineTierPolicyRegistry`), `ambientPolicy` on `EngineSettingsDto`, `POST /api/engine/settings/ambient-policy` in the already-wired `EngineReviewEndpoints`, panel section. **B (decide + gates + publish):** `AmbientBehavior` decide policy (below-floor trigger, caps, allow-lists), then in `ReactionLoopDriver` an autonomous branch ONLY for `Trigger == AmbientFloor` AND `mode == autonomous`: re-check kill switch / degraded clamp / lifecycle gate / Freeze / Pause-engine immediately before `EnginePublishService.PublishBurstAsync`. Everything else keeps the review-queue path unchanged. | A: `Pulse.WebApi/Features/EngineRuntime/EngineAmbientPolicy.cs` (new), additive lines in `EngineReviewEndpoints.cs` + `EngineSettingsContracts.cs`, `features/controller/engine/components/EngineSettingsPanel.tsx` (+ service/hook). B: `Pulse.Core/Features/Ambient/*` (new), `ReactionLoopHost.cs` (`ReactionLoopDriver` branch), `GenerationIntent.cs` (additive optional topic seed), `EngineEventPayloads.cs` (+`publishPath`) | `AmbientTierPolicy`, `IEngineLifecyclePublishGate` (A5 replaces its registration), `AmbientBehavior` |

## Reuse map
- **`storyline-model` 04** — `RateGovernanceConfig` / `RateGovernance` (quiet floor + global cap); the ambient caps are *additional*, never larger.
- **`persona-voice-engine`** — voiced ambient posts; allow-listed personas only.
- **`engine-generation-infra` 03/04** — untrusted-data isolation and Ambient tier; `GenerateStage` + `ContentGuard.InspectBurst` unchanged; extend `InjectionRedTeam` catalog.
- **`autonomy-safety`** — `EngineAutonomyState.IsGenerationStopped` / `IEngineSafetySwitch`, `EngineAutonomyRegistry`; settings API + panel pattern from 05/06 (`EngineTierPolicyRegistry` is the template: singleton, `TryAddSingleton`, from→to audit event, `InMemoryStateNote`).
- **`engine-runtime`** — `EnginePublishService` (the ONLY publish path, `Origin = "engine"`), `EngineCockpitControllerRoleFilter` / staff auth filters, XC-004 `EngineEventTypes`/`EngineEventPayloads`.
- **`world-steering` 07** — `PauseTierRegistry` + `IExerciseClock.IsFrozen` for Pause-engine / Freeze.
- **Lifecycle** — `ExerciseLifecycleStates` literals (no second vocabulary); interim `IEngineLifecyclePublishGate` reads `Exercise.Status`; A5 swaps the registration.
- Frontend: COBRA `@/theme/styledComponents`, FontAwesome, React Query hooks already used by `EngineSettingsPanel`; axios client `core/services/api.ts`.
- `docs/guide/controller-guide.md` §10 + `tools/guide-screenshots`.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|------|
| 01-A Policy + settings API + panel | `EngineAmbientPolicy.cs`, additive lines in `EngineReviewEndpoints.cs` / `EngineSettingsContracts.cs`, `EngineSettingsPanel.tsx` (+service/hook), guide + screenshot | autonomy-safety 05/06 (built), C1 (live provider verified on UAT) | — (serial: it defines the contract B reads) | C2 | M |
| 01-B Decide policy + gated autonomous publish | `Pulse.Core/Features/Ambient/*`, `ReactionLoopHost.cs` (driver branch), `GenerationIntent.cs`, `EngineEventPayloads.cs`, `InjectionRedTeam` ambient cases | 01-A (policy contract), storyline-model 04, engine-runtime 02, world-steering 07 | frontend half of 01-A once the DTO is frozen | C2 | M |

**Orchestrator-owned files:** none expected. If a new `Map*`/`Add*` pair is introduced it is one additive
`Program.cs` line in the wave-end wiring commit, cleared by the orchestrator. `App.tsx` and
`staffRouteRegistry.tsx` are not touched (the panel already has its route).
**Collision notes:** `EngineReviewEndpoints.cs`, `EngineReviewService.cs` and `ReactionLoopHost.cs` are shared
with autonomy-safety and world-steering; keep edits additive and merge `main` first. Session A's frozen types
(`PostView`, session/role types, `ExerciseScopeDto`) are not touched.
