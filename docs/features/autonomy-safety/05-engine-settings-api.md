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

**Written (backend, `src/Pulse.WebApi.Tests/Features/EngineRuntime/`):**

AC1 (autonomy default settable at runtime, on the SHARED registry, `auto`/invalid → 400 no mutation)
- `EngineSettingsServiceTests.SetAutonomyDefault_DelayedAuto_MutatesTheSameSharedStateTheLoopReads (AC-1)`
- `EngineSettingsServiceTests.SetAutonomyDefault_BackToSuggest_LowersItAgain (AC-1)`
- `EngineSettingsServiceTests.SetAutonomyDefault_Auto_IsRejected400_AndMutatesNothing (AC-1)`
- `EngineSettingsServiceTests.SetAutonomyDefault_UnknownLiteral_IsRejected400_AndMutatesNothing (AC-1)`
- `EngineSettingsEndpointsTests.PostAutonomyDefault_DelayedAuto_Returns200_AndTheSnapshotReportsTheNewDefault (AC-1)`
- `EngineSettingsEndpointsTests.PostAutonomyDefault_Auto_Returns400_AndChangesNothing (AC-1)`

AC2 (a default change never lifts an active safety clamp, §8.2)
- `EngineSettingsServiceTests.SetAutonomyDefault_WhileKillSwitchClamped_SetsTheBaseUnderneath_ButNeverLiftsTheClamp (AC-2)`
- `EngineSettingsLoopIntegrationTests.WhileAKillSwitchClampIsActive_SettingDelayedAuto_StillProducesNoAutonomousBurst (AC-2)`

AC3 (tier-policy override recorded + applied at the loop's `IntentComposer` call site; `auto` clears it)
- `EngineSettingsServiceTests.SetTierPolicy_RecordsThePerExerciseOverride_AndAppliesItToAComposedTier (AC-3)`
- `EngineSettingsServiceTests.SetTierPolicy_Auto_ClearsTheOverride_RestoringThePurposeBasedMap (AC-3)`
- `EngineSettingsServiceTests.SetTierPolicy_UnknownMode_IsRejected400_AndMutatesNothing (AC-3)`
- `EngineSettingsLoopIntegrationTests.AfterSettingTheTierPolicy_TheNextBurstIsGeneratedAtThatTier_AndAutoRestoresThePurposeMap (AC-3)`
- `EngineTierPolicyTests.*` (store semantics, wire literals, and the **shared-singleton** composition:
  `WiringBothSlices_ConvergesOnOneSharedTierPolicyRegistry_EitherOrder`) `(AC-3)`
- `EngineSettingsEndpointsTests.PostTierPolicy_Returns200_AndTheSnapshotReportsTheMode (AC-3)`
- `EngineSettingsEndpointsTests.PostTierPolicy_UnknownMode_Returns400 (AC-3)`

AC3 / WR-002 (a forced tier must be one this deployment actually bound)
- `EngineSettingsServiceTests.SetTierPolicy_ForATierWithNoConfiguredDeployment_IsRejected400_NamingTheMissingKey (AC-3)`
- `EngineSettingsServiceTests.SetTierPolicy_ForATierBoundWithAnEmptyDeployment_IsAlsoRejected400 (AC-3)`
- `EngineSettingsServiceTests.SetTierPolicy_ForABoundTier_IsAccepted (AC-3)`
- `EngineSettingsServiceTests.SetTierPolicy_Auto_IsAlwaysAccepted_EvenWithNoTierBound (AC-3)`
- `EngineSettingsServiceTests.SetTierPolicy_WithNoTiersConfiguredAtAll_IsAccepted_SoTheOfflineProviderIsUnaffected (AC-3)`

AC4 / WR-003 (the wire reports the EFFECTIVE level, so no consumer re-derives the clamp)
- `EngineSettingsServiceTests.SetAutonomyDefault_WhileClamped_ReportsAnEffectiveLevelBelowTheBase_SoNoConsumerReDerivesIt (AC-4)`
- `EngineSettingsServiceTests.GetSettings_WhenGenerationIsFullyStopped_ReportsNoEffectiveLevel (AC-4)`
- `EngineSettingsServiceTests.GetSettings_AfterRestore_ReportsTheEffectiveLevelBackAtTheBase (AC-4)`
- `EngineSettingsEndpointsTests.GetSettings_ReportsBothTheBaseDefaultAndTheEffectiveLevel_WhileAClampIsActive (AC-4)`
- `EngineSettingsEndpointsTests.GetSettings_WhenFullyStopped_SerializesEffectiveLevelAsJsonNull (AC-4)`

AC4 (`GET /settings` read model: provider, governed tiers, autonomy default, tier-policy mode, clamp)
- `EngineSettingsServiceTests.GetSettings_ReportsProvider_GovernedTiers_AutonomyDefault_TierPolicyMode_AndClamp (AC-4)`
- `EngineSettingsServiceTests.GetSettings_WithNoTiersConfigured_ReportsAnEmptyMapping_NotAFailure (AC-4)`
- `EngineSettingsEndpointsTests.GetSettings_ReturnsTheFullSnapshot_InTheDocumentedWireShape (AC-4)`
- `EngineSettingsEndpointsTests.SettingsRoutes_AreMappedExactlyOnce_OnTheExistingEngineGroup (AC-4)`

AC5 (COR-001 fail-closed scope + COR-018 attribution)
- `EngineSettingsServiceTests.SetAutonomyDefault_UnresolvedScope_FailsClosed_AndMutatesNothing (AC-5)`
- `EngineSettingsServiceTests.SetTierPolicy_UnresolvedScope_FailsClosed_AndMutatesNothing (AC-5)`
- `EngineSettingsServiceTests.GetSettings_UnresolvedScope_FailsClosed_WithNoSnapshot (AC-5)`
- `EngineSettingsServiceTests.SetAutonomyDefault_MissingActingHumanId_ReturnsInvalid (AC-5)`
- `EngineSettingsServiceTests.SetTierPolicy_MissingActingHumanId_ReturnsInvalid (AC-5)`
- `EngineSettingsServiceTests.SetAutonomyDefault_InExerciseA_NeverMovesExerciseB (AC-5)`
- `EngineSettingsServiceTests.GetSettings_InExerciseA_ReportsAsPosture_NotBs (AC-5)`
- `EngineSettingsEndpointsTests.GetSettings_UnresolvedScope_Returns401_FailClosed (AC-5)`
- `EngineSettingsEndpointsTests.SettingsPosts_UnresolvedScope_Return401_FailClosed (AC-5)`
- `EngineSettingsEndpointsTests.PostAutonomyDefault_MissingActingHumanId_Returns400 (AC-5)`
- `EngineSettingsEndpointsTests.PostAutonomyDefault_MissingBody_Returns400 (AC-5)`
- `EngineSettingsLoopIntegrationTests.ATierPolicySetOnExerciseA_NeverChangesExerciseBsBursts (AC-5)`

AC6 (#297 controller-role gate on every mutating route; both GETs stay open)
- `EngineSettingsEndpointsTests.EveryMutatingRoute_FromANonControllerAssignedStaffSession_Returns403 (AC-6)`
  — loops **all ten** mutating routes (approve / edit / veto / re-roll / batch-approve / swamped-mode /
  kill-switch / restore / settings-autonomy-default / settings-tier-policy)
- `EngineSettingsEndpointsTests.BothGets_FromANonControllerAssignedStaffSession_Are200_SoAnEvaluatorCanWatch (AC-6)`
- `EngineSettingsEndpointsTests.EveryMutatingRoute_FromAControllerAssignedStaffSession_IsNotBlockedByTheRoleGate (AC-6)`
- `EngineSettingsEndpointsTests.EveryRoute_FromAStaffSessionAssignedToADifferentExercise_FailsClosed (AC-6)`
- `EngineSettingsEndpointsTests.SettingsPosts_FromANonStaffSession_Return401 (AC-6)`
- `EngineSettingsEndpointsTests.EveryMutatingEngineRouteInTheRealRouteTable_IsCoveredByTheRoleGateTests (AC-6)`
  — WR-001 drift guard: derives the mutating surface from the real `EndpointDataSource`, both directions
  (an uncovered new route AND a stale covered entry red the build)

AC7 (the two additive XC-004 events)
- `EngineSettingsServiceTests.SetAutonomyDefault_EmitsExactlyOneAutonomyDefaultChangedEvent_WithTheFromToAndActor (AC-7)`
- `EngineSettingsServiceTests.SetTierPolicy_EmitsExactlyOneTierPolicyChangedEvent_WithTheFromToModes (AC-7)`
- `EngineSettingsServiceTests.SetAutonomyDefault_EmitsNoOtherEngineEvent (AC-7)`

AC7 / WR-005 (audit-persist failure is loud, non-fatal, and cancellation still propagates — fault-injected,
Docker-free so the contract is provable on any machine)
- `EngineSettingsAuditFailureTests.SetAutonomyDefault_WhenTheAuditRowCannotBePersisted_StillSucceeds_WithTheAppliedPosture (AC-7)`
- `EngineSettingsAuditFailureTests.SetAutonomyDefault_WhenTheAuditRowCannotBePersisted_LogsAtError (AC-7)`
- `EngineSettingsAuditFailureTests.SetTierPolicy_WhenTheAuditRowCannotBePersisted_StillSucceeds_AndLogsAtError (AC-7)`
- `EngineSettingsAuditFailureTests.SetAutonomyDefault_WhenThePersistIsCancelled_PropagatesTheCancellation_AndDoesNotLogItAsAnAuditGap (AC-7)`
- `EngineSettingsAuditFailureTests.SetAutonomyDefault_WhenTheAuditRowPersistsFine_LogsNothing (AC-7)`

**Integration — the headline proof the "unreachable" gap is closed:**
- `EngineSettingsLoopIntegrationTests.AfterSettingDelayedAuto_TheNextBurstIsACountingDownDraft_NotSuggestQueued`
  (before: `Queued` + `RoutedAtLevel: Suggest` + no countdown; after the settings call on the same running
  loop: `CountingDown` + `RoutedAtLevel: DelayedAuto` + a started countdown) `(AC-1)`
- `EngineSettingsLoopIntegrationTests.AfterSettingDelayedAutoThenBackToSuggest_TheNextBurstQueuesAgain (AC-1)`

- **UAT (required — not just unit-green; this feature's own root-cause lesson).** Deployed to UAT
  with `mock=false`: **first confirm the seeded staff assignment's role is `controller`** — every
  mutating `/api/engine` route now 403s for any other role (see the WR-004 note below), so a UAT
  seeded as `planner`/`evaluator` makes the whole cockpit read-only and this ships looking broken.
  Then, as a controller, flip the exercise default to Delayed-auto via this API (curl or
  the story 06 panel once it lands), confirm a live-generated burst counts down instead of queuing;
  flip a tier-policy mode and confirm `GET /settings` reflects it (and that forcing a tier the UAT
  deployment has NOT bound returns 400 naming the missing key, rather than silently stalling
  generation); restart the App Service and confirm
  the GET response honestly reports the reset-to-Suggest/auto state (documented behavior, not a
  silent surprise). Do not mark Complete on unit-green alone.

## Build notes (as implemented)

**Telemetry decision (AC7) — reviewer go-ahead GIVEN: the vocab was introduced.** `EngineEventTypes.
AutonomyDefaultChanged` (`engine.autonomy_default_changed`) and `EngineEventTypes.TierPolicyChanged`
(`engine.tier_policy_changed`) were added, each with one `EngineEventPayloads` record, and are emitted
server-side through the already-wired `IEngineTelemetryEmitter` — one event per change, alongside (not
replacing) the frontend's existing `engine.autonomy_changed` emit. **Rationale:** the autonomy/tier state is
process memory, so this event is the only record of an operator's change that survives a restart. This is a
deliberate divergence from the legacy swamped-mode / kill-switch / restore trio, which still emit no backend
telemetry — flagged for the reviewer rather than silently generalised.

**Endpoint contract (the artifact story 06 builds against).** All three endpoints return the SAME
`EngineSettingsDto` body on success, so a mutation needs no follow-up read:

```
GET  /api/engine/settings                      → 200 EngineSettingsDto | 401 | 403
POST /api/engine/settings/autonomy-default     { actingHumanId, level: 'suggest'|'delayed-auto', timeZone? }
                                               → 200 EngineSettingsDto | 400 | 401 | 403
POST /api/engine/settings/tier-policy          { actingHumanId, mode: 'standard'|'ambient'|'auto', timeZone? }
                                               → 200 EngineSettingsDto | 400 | 401 | 403

EngineSettingsDto = {
  provider: string,                            // IGenerationProvider.Name, read-only
  tiers: [{ tier, model, deployment, zdrCapable }],   // governed config, informational only
  autonomy: { swampedMode, generationStopped, safetyClampActive, degradedReason,
              exerciseDefaultLevel: 'suggest'|'delayed-auto',      // NEW: the BASE default
              effectiveLevel: 'suggest'|'delayed-auto'|null },     // NEW: what the loop routes on
  tierPolicyMode: 'standard'|'ambient'|'auto',
  inMemoryState: true, inMemoryStateNote: string       // reset-on-restart, reported honestly
}
```

No `exerciseId` is accepted on any request body — scope is server-authoritative from `IExerciseContext`.
`timeZone` is optional (XC-004 envelope zone; defaults to `UTC`).

**`level` and `mode` literals parse CASE-SENSITIVELY — lowercase only** (`suggest`, `delayed-auto`,
`standard`, `ambient`, `auto`); `"Standard"` is a 400. This matches the pinned-by-name wire vocabulary in
`EngineEnumJsonConverters`/`TierPolicyModes` (an unknown literal fails loud, never a silent default). Note the
deliberate asymmetry: the #297 role compare IS `OrdinalIgnoreCase`, because `StaffAssignment.Role` is
operator/seed-authored data rather than a pinned wire literal.

**`effectiveLevel` (WR-003) is the value story 06's panel should LABEL the posture from.** It is
`exerciseDefaultLevel` lowered by any active safety clamp (§8.2), projected from the domain's own
`EngineAutonomyState.ResolveEffective` — a consumer must never re-derive "clamp active ⇒ effectively Suggest",
since that inference is the exact bug class (`EngineControlBar` mislabelling the posture) story 06 exists to
fix. It is `null` when `generationStopped` is true (a full stop routes at NO level).

**Do NOT infer "no clamp" from `effectiveLevel === exerciseDefaultLevel`.** Effective is `Lower(base, clamp)`,
so a clamp that is not *below* the base yields two EQUAL levels while `safetyClampActive` is `true` — e.g. a
base already at `suggest` plus a `drop-to-suggest` kill switch reports
`exerciseDefaultLevel: 'suggest', effectiveLevel: 'suggest', safetyClampActive: true`. A consumer's clamp /
emergency-brake indicator must therefore read `safetyClampActive` (and `generationStopped`), never a comparison
of the two levels; the levels answer "what posture", the flags answer "is the brake on".

**A forced tier is validated against the deployment's bound tiers (WR-002).** `POST .../tier-policy` with
`standard`/`ambient` returns **400 naming `Generation:Tiers:{Tier}:Deployment`** when that tier has no
configured deployment, checked against the SAME key + empty-`Deployment` rule the generation providers use.
Without this, the POST returned 200 and every later tick threw `GenerationConfigurationException` inside the
loop's per-exercise catch — generation stops with nothing but a log line. `auto` is always accepted, and the
check is skipped entirely when no tiers are configured at all (the offline Fake provider's normal state).

**No `Program.cs` change is needed.** The three routes were added to the EXISTING `/api/engine` group in
`MapEngineReview()`, which `Program.cs` already calls, and the new `EngineTierPolicyRegistry` is registered by
the already-called `AddEngineReview()` / `AddReactionLoopHost()` (`TryAddSingleton`, so both converge on one
instance). `AddEngineReview()` now additionally depends on `AddEngineGeneration` having run first (the
settings read needs `IGenerationProvider` + `IOptions<GenerationOptions>`); `Program.cs` already wires it in
that order.

**#297 was implemented as a SIBLING filter**, `EngineCockpitControllerRoleFilter`, applied to a mutating
sub-group inside `MapEngineReview()` — `EngineCockpitStaffAuthorizationFilter` is left UNMODIFIED so
concurrent stories that reuse it are unaffected. The two compose: a mutation passes both, a read passes only
the staff/assignment gate. A drift guard
(`EngineSettingsEndpointsTests.EveryMutatingEngineRouteInTheRealRouteTable_IsCoveredByTheRoleGateTests`)
derives the mutating `/api/engine` surface from the real `EndpointDataSource` and reds the build if a future
route is added without being covered by the gate tests — the omission #297 was originally filed about.

**WR-004 — `planner` is INTENTIONALLY excluded from all steering, including the kill switch.** This is a
behaviour change to already-shipped endpoints: before this story any assigned staff could approve, veto, or
trip the emergency brake; now only a `controller` can. The `ExerciseRole` vocabulary is
`controller` / `evaluator` / `planner`, and only `controller` steers — a planner or evaluator gets a read-only
cockpit (both GETs) and `403` on every mutation. That is the AC/#297 requirement, recorded here as a decision
rather than left to be discovered: if an exercise needs a second steering role (a `lead-controller`, or letting
a planner reach the kill switch), it is a deliberate follow-up story, not a bug in this one. **Operational
consequence:** an environment whose staff assignment is seeded with any other role has a read-only cockpit —
see the UAT step above.

**WR-005 — the in-memory posture change is NOT atomic with its audit row, deliberately, and it is loud.**
`SetExerciseDefault`/`SetMode` mutate process memory before the XC-004 row is committed. A persistence failure
therefore leaves the posture changed AND live. Returning a 500 there would tell the operator "your change did
not apply" when it did, so the failure is instead caught, logged at **Error**
(`LogSettingsAuditPersistFailed`: "was APPLIED in memory but its XC-004 audit event could not be persisted;
the posture change is live and unaudited") and the applied snapshot is still returned. Cancellation is
re-thrown, not swallowed. This narrows but does not close the gap in the "the event is the record that survives
a restart" justification: genuinely closing it requires persisting the posture itself, which is explicitly out
of scope for this story (process memory, like the kill switch beside it) — a follow-up if an audit-completeness
requirement lands.

**Out of scope, confirmed not built:** `SetStorylineOverride` endpoint, `AutonomyLevel.Auto`, the
`IntentComposer` → `ITierPolicy.PickTier` refactor (`ITierPolicy` still has zero call sites), frontend
reconciliation (story 06), restart persistence (no EF entity, no migration).
