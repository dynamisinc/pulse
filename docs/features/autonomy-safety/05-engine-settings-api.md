# Story: Engine settings API (autonomy default + tier policy, runtime-settable)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP §2.3 (v1 subset), ADP-025/NFR-005 (governed tier boundary)  ·  **Design decisions:** none  ·  **Issue:** #353

## Context
Audit finding (this session): **Delayed-auto is currently unreachable.** `EngineAutonomyState.Create`
(`Pulse.Core/Features/Autonomy/Services/EngineAutonomyState.cs`) always seeds an exercise at
`AutonomyLevel.Suggest`, and the fully-built `SetExerciseDefault`/`SetStorylineOverride` are never
called from `Pulse.WebApi` — the only three autonomy endpoints (`swamped-mode`, `kill-switch`,
`restore`) only ever apply or lift a **clamp**; `restore` lifts back to the (permanently Suggest)
default. The result: the frontend `EngineControlBar`'s **LIVE** and **SUGGEST-ONLY** positions are
behaviourally identical today (see story 06) — a pre-existing UX lie this feature must fix at the
source, not just relabel.

A second, structurally identical gap exists on the model-tier side: `ITierPolicy`/`TierPolicy`
(`Pulse.Core/Features/Generation/Services/TierPolicy.cs`) is registered in DI but **nothing calls
it**. The actual tier decision lives in `Pulse.Core/Features/ReactionLoop/Services/IntentComposer.cs`'s
private `TierFor(ReactionTriggerKind)`, hardcoded by trigger kind (`AmbientFloor` → Ambient, else
Standard) — it does not consult `ITierPolicy.PickTier` at all. So "runtime tier choice" needs a real
seam at the loop's existing call site (`IntentComposer.Compose` → `ReactionLoopHost.cs:541`), not a
config knob nobody reads.

This story builds the **operator-facing settings API** the user asked for when trying to administer
the engine: flip autonomy posture at runtime (Suggest ↔ Delayed-auto, no redeploy — the explicit
decision), choose a per-exercise tier policy (Standard / Ambient / auto-by-purpose) **without**
touching which concrete deployment/model each tier resolves to (that stays governed `appsettings` +
bicep, behind `GenerationGovernance.Validate`'s fail-closed startup gate — full runtime model config
was explicitly rejected because it would let an operator route traffic to an unattested endpoint,
defeating the Tier-2 sign-off), and a read model reporting what the engine is actually running. It
also **folds in and closes #297** ("[security] Restrict engine cockpit autonomy controls to
controller-role staff", open) — this story adds two more safety-critical mutations to the same
`/api/engine` cockpit group, so this is the natural point to fix the gate rather than adding a third
under-gated endpoint.

Owns `EngineReviewEndpoints.cs` / `EngineReviewService.cs` (the review-cockpit's existing home for the
autonomy controls). A concurrent `world-steering` story deliberately avoids those two files to keep
this slice's file footprint disjoint from that feature's wave — coordinate before touching either
file outside this story's stated scope.

## Acceptance Criteria
- [ ] Given a controller-role staff session, when they `POST` a new **exercise autonomy default**
      (`suggest` | `delayed-auto`), then the handler resolves the SHARED per-exercise
      `EngineAutonomyState` via `EngineAutonomyRegistry.GetOrCreate` (never a fresh `Create`) and
      calls the built `SetExerciseDefault(level, actingHumanId, scenarioMinute)` — the same shared
      instance the reaction loop and the auto-HOLD tick already read, so the change is live for the
      next burst with **no redeploy, no restart**. This is what makes Delayed-auto reachable at all.
      `level` outside `{suggest, delayed-auto}` (including an attempt to select `auto`, v1.1) is
      rejected 400 via `AutonomyLevels.EnsureSelectable`, never silently clamped or ignored.
- [ ] Given the same control, when a safety clamp (kill switch / degraded mode) is currently active,
      then setting a higher default does **not** lift the clamp — the base level is set underneath
      exactly as `SetExerciseDefault`'s contract documents; only an explicit `RestoreFromSafety` call
      lifts it (§8.2: automation never raises, and a routine default change can never silently
      release a kill switch).
- [ ] Given a controller-role staff session, when they `POST` a **tier-policy mode** for the exercise
      (`standard` | `ambient` | `auto`), then a per-exercise override is recorded and applied at
      `IntentComposer`'s existing call site (`ReactionLoopHost.cs`, immediately after
      `IntentComposer.Compose` returns an intent) so it takes effect on the next generated burst;
      `auto` clears the override, restoring the purpose-based static map's role (today `IntentComposer.
      TierFor`'s trigger-kind mapping; the seam is ready for `TierPolicy.PickTier` if/when the loop
      is refactored to call it). The concrete deployment/model each tier resolves to is **never**
      settable here — only `Standard`/`Ambient`/`auto` selection; `Generation:Tiers:*` stays governed
      config, so `GenerationGovernance.Validate`'s startup gate is untouched.
- [ ] Given a controller-role staff session, when they `GET /api/engine/settings`, then the response
      reports (read-only): the active provider name (`IGenerationProvider.Name`), the `Generation:
      Tiers:*` model/deployment mapping straight from config (informational, not editable here), the
      exercise's current autonomy default, the current tier-policy mode, and the active safety
      clamp/degraded reason (`EngineAutonomyStateDto`'s existing fields) — the "what is this
      exercise's engine actually running" read the user asked for when no admin surface existed.
- [ ] Fail-closed scope + attribution (COR-001/COR-018): every settings endpoint resolves the
      exercise ONLY from `IExerciseContext` (401 on unresolved, never a default/unscoped result) and
      requires `actingHumanId` (400 if missing) — identical discipline to the sibling kill-switch/
      swamped-mode/restore endpoints.
- [ ] **Closes #297.** A controller-role check (`StaffAssignment.Role == "controller"`, read off the
      existing `StaffAssignmentDto.Role` the filter already has in hand) gates every **mutating**
      `/api/engine` cockpit endpoint — the existing review actions (approve/edit/veto/re-roll/
      batch-approve), the existing autonomy controls (swamped-mode/kill-switch/restore), and this
      story's two new settings `POST`s — while `GET /api/engine/review-queue` and `GET /api/engine/
      settings` stay open to any assigned staff for observation (an evaluator can watch; only a
      controller can steer). Extends `EngineCockpitStaffAuthorizationFilter` (or a sibling filter
      applied only to the mutating routes) rather than inventing a second auth mechanism.
- [ ] **Telemetry — flagged for reviewer sign-off, not silently decided.** The existing swamped-mode/
      kill-switch/restore endpoints deliberately emit **no** backend telemetry (no autonomy XC-004
      vocab exists there; the frontend's `engine.autonomy_changed`/`engine.swamped_mode_changed`
      emits are the sole audit trail — see `useEngineControl.ts`/`useSwampedMode.ts`). This story's
      two new endpoints sit in the SAME service, which already has `IEngineTelemetryEmitter` wired in
      and an established additive-vocabulary convention (`EngineEventTypes.{Observed,Decided,
      Generated,Reviewed,Published,Measured}`, `Pulse.WebApi/Features/EngineRuntime/Telemetry/
      EngineEventTypes.cs`) — unlike the legacy trio, adding `EngineEventTypes.AutonomyDefaultChanged`
      / `TierPolicyChanged` here costs one constant + one payload record, not a new integration.
      **Recommendation: introduce the vocab** (log both the default/tier changes server-side,
      alongside the frontend's existing emit, giving a durable audit record that survives a process
      restart even though the in-memory autonomy state itself does not) — but this is a divergence
      from the established pattern in this exact feature, so implement it only after an explicit
      reviewer go-ahead, and if rejected, document the "frontend-only, matches the trio" choice
      here instead of leaving it ambiguous.

## Out of Scope
Full runtime model/deployment configuration (explicitly rejected — would defeat
`GenerationGovernance.Validate`'s fail-closed Tier-2 gate); per-storyline autonomy override endpoint
(`SetStorylineOverride` is equally unreached today but out of scope — no operator ask for it yet;
note it as a follow-up if one surfaces); `AutonomyLevel.Auto` (v1.1); refactoring `IntentComposer` to
call `ITierPolicy.PickTier` instead of its own `TierFor` (the override wraps the existing call site;
the refactor is a separate, non-safety-critical cleanup); reconciling the frontend's optimistic
engine-control store against this endpoint's authoritative response (story 06's job); process-
restart persistence of autonomy/tier state (stays in-memory per the existing `EngineAutonomyRegistry`
`ConcurrentDictionary` — state this honestly in the GET response rather than solving it here).

## Technical Notes
Staff (COBRA cockpit; XC-002). Two new `POST`s + one `GET` on the existing `/api/engine` group in
`EngineReviewEndpoints.cs`, backed by two new `EngineReviewService` methods that mirror
`SetSwampedModeAsync`/`EngageKillSwitchAsync`'s shape exactly (`TryResolveScope` → validate
`actingHumanId` → `_autonomy.GetOrCreate(exerciseId)` → mutate → project a DTO). The tier-policy
override needs a small new per-exercise store (a `ConcurrentDictionary<Guid, TierPolicyMode>`
alongside — or folded into — `EngineAutonomyRegistry`) and a one-line read at `ReactionLoopHost.cs`'s
existing `Tier = intent.Tier` assignment (`intent.Tier` overridden by the exercise's mode when not
`auto`). Extend `EngineAutonomyStateDto` additively (new `ExerciseDefaultLevel` field) rather than
inventing a parallel DTO — it is already the shared wire shape every autonomy-control response
returns. `GET /settings` composes this DTO with `IOptions<GenerationOptions>` (provider name + the
`Tiers` dict) and the new tier-policy-mode read — no new persistence, no EF entity; everything here
is process-memory config + the registries, exactly like the kill switch it sits beside. See
`implementation.md` (story 05) and architecture §8.1/§8.2, §3.2 (tiering).

## Dependencies
Story 01 (`EngineAutonomyState`, `AutonomyLevel`); story 03 (kill switch — shares
`EngineAutonomyRegistry`/`EngineAutonomyStateDto`); engine-generation-infra story 04 (`TierPolicy`,
`GenerationTier`, `GenerationGovernance`); engine-runtime (`ReactionLoopHost.cs`/`IntentComposer.cs`,
the tier-override read site); B2 staff identity (`StaffAssignmentService`, `StaffAssignmentDto.Role`
— the controller-role gate); #297 (closed by this story).

## Tests
- Unit: `POST` autonomy-default calls `SetExerciseDefault` on the SAME registry instance the loop
  reads; rejects `auto`/invalid levels with 400 and no mutation; does not lift an active safety clamp.
- Unit: `POST` tier-policy records/clears the per-exercise override; `GET /settings` reflects
  provider/tiers/autonomy-default/tier-policy-mode/clamp state accurately.
- Unit: the controller-role gate rejects a non-controller assigned staff session (403) on every
  mutating route in this group and allows it through on the two GETs; a cross-exercise attempt on
  any route still fails closed (401/403) per the existing COR-001 scope resolution.
- Integration: setting Delayed-auto then generating a burst produces a counting-down draft (not
  Suggest-queued) — the end-to-end proof the "unreachable" gap is closed.
- **UAT (required — not just unit-green; this feature's own root-cause lesson).** Deployed to UAT
  with `mock=false`: as a controller, flip the exercise default to Delayed-auto via this API (curl or
  the story 06 panel once it lands), confirm a live-generated burst counts down instead of queuing;
  flip a tier-policy mode and confirm `GET /settings` reflects it; restart the App Service and confirm
  the GET response honestly reports the reset-to-Suggest/auto state (documented behavior, not a
  silent surprise). Do not mark Complete on unit-green alone.
