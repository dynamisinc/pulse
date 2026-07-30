# Story: Cut generation to the Fake provider (runtime egress safety lever)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress — backend built (edges 6a + 6b), integrated on the umbrella (`feature/autonomy-safety-cut-to-fake`), Gate-1 clean (0 Criticals, folded per Build notes) and Gate-2 clean (0 Criticals, 0 build warnings — see Build notes). Frontend (edge 7, the console toggle) is not built. NOT Complete: this story's DoD requires verified-in-UAT, and UAT is impossible today — it needs `PROVIDER-GOVERNANCE.md` §8 signed AND an environment running an egressing provider, neither of which exists yet.
**Requirements:** ADP-042 (kill-switch family — extends the "one manual control, only ever less" lever
to the provider/egress axis), NFR-005 / ADP-025 (the governed-endpoint boundary this lever must not
cross)  ·  **Design decisions:** none  ·  **Issue:** #402

## Context
Today, "which generation provider runs" is a **startup-only** decision: `AddEngineGeneration`
(`Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs:35-55`) switches on `Generation:Provider`
once and registers **either** the real provider (`AzureOpenAIGenerationProvider` /
`ClaudeFoundryGenerationProvider`, as a singleton typed `HttpClient`) **or** `FakeGenerationProvider` —
never both. Changing it requires an app-setting edit and an App Service restart. There is no runtime
path, and no control a controller can reach mid-exercise if the live provider needs to stop egressing
right now (a cost spike, an unexpected model behavior, a live incident unrelated to the exercise
itself, or simply "we're done with the live pass, go back to canned content").

This is the missing manual lever at the **provider** layer, structurally the same shape as the
existing **kill switch** (`03-kill-switch.md`, ADP-042) at the **autonomy** layer and the **automatic
circuit-breaker degraded path** (`IProviderHealthListener.OnDegradedAsync`,
`ServiceCollectionExtensions.cs:117`) at the **health** layer: all three exist so an operator (human or
automatic) can only ever reduce what the engine is doing, never expand it (architecture §8.2). The
`GET /api/engine/settings` read (`EngineSettingsContracts.cs`) already documents the boundary this
lever must respect in as many words — the endpoint "can never change which deployment/model a tier
resolves to (NFR-005 / ADP-025 — that would let an operator route traffic to an unattested endpoint,
defeating the startup governance gate)" (`EngineSettingsContracts.cs:30-34`).

**The central design invariant — read this before writing a line of code.** This lever is a **binary
between the startup-configured provider and Fake — never a provider chooser.** The reachable-endpoint
set stays exactly what `GenerationGovernance.Validate` signed off at startup; nothing this story adds
can make a new endpoint reachable. That asymmetry is the whole story:

- **Cutting live → Fake is in scope.** It only ever *reduces* egress — same shape as the kill switch
  and the circuit breaker.
- **Restoring Fake → the startup-configured provider is in scope**, because it can never exceed the
  governed baseline: it returns to exactly what the signed startup config already authorized. This is
  the direct sibling of `RestoreFromSafety` (kill switch) — same "human-only raise, capped at what was
  already permitted" shape (§8.2).
- **Selecting any provider other than the startup-configured one is explicitly OUT of scope** — see
  Out of Scope. That is a Tier-2 governance change against `PROVIDER-GOVERNANCE.md` §8 (currently
  **UNSIGNED**), not a feature this story builds.

`PROVIDER-GOVERNANCE.md` §8 is unsigned today and UAT runs `Provider=Fake`, so this lever is currently
inert in every deployed environment — it becomes load-bearing the moment §8 is signed and a live
provider goes reachable. Building it now (ahead of that signature) means the safety brake exists
*before* the live endpoint does, not after.

## Acceptance Criteria
- [ ] Given the exercise's startup-configured provider is a real (egressing) provider, when a
      controller-role staff `POST`s the cut (`actingHumanId` required, COR-018), then that exercise's
      reaction loop generates its next burst through `FakeGenerationProvider` instead — immediately,
      with **no restart, no config change, no effect on any other exercise**. The set of registered
      `IGenerationProvider` instances is exactly what startup created; this only changes which
      **already-registered** instance a given exercise resolves to.
- [ ] Given a cut is active, when a controller-role staff `POST`s restore, then the exercise's next
      burst reverts to generating through the **startup-configured** provider and no other — restore
      can never land on a provider that was not already running at startup (mirrors kill switch's
      `RestoreFromSafety`: a human-only raise, capped at the pre-existing baseline).
- [ ] Given the startup-configured provider is **already** `Fake` (the committed default; every CI run
      and, as of this story, UAT) — cutting is a no-op that reports `alreadyFake: true` rather than a
      false "I just locked something down" signal; restoring when no cut is active is likewise a no-op.
      Both are idempotent, not errors.
- [ ] Given the wire contract, when any caller inspects or exercises it, then there is **no field, no
      route, and no accepted literal anywhere that selects a provider by name** — the cut/restore
      endpoints take only `actingHumanId` (+ optional `timeZone`, matching the existing settings
      convention). A request that attempts to pass a provider selector is rejected 400 (or ignored and
      the ignored-field is asserted in a test) so the endpoint shape itself cannot become a chooser by
      a later, smaller change slipping in unreviewed.
- [ ] Given `GET /api/engine/settings`, when it reports the active provider, then **configured** and
      **effective** are two distinguishable facts on the wire (see Technical Notes — this changes the
      currently-single `provider` field's implied meaning and must be handled as a deliberate,
      additive contract change, not an overload); the staff console visibly and honestly labels when
      the effective provider differs from the configured one (text, not color alone — folds into the
      NFR-001 AC below) so a controller can never lose track of "we are currently running on Fake."
- [ ] **Isolation, fail-closed (COR-001/XC-001):** every cut/restore/read resolves the exercise only
      from `IExerciseContext`; an unresolved scope is `401`, **never** a default/unscoped snapshot
      (matches the existing `EngineSettingsResult.ScopeUnresolved` contract exactly — this is an
      additive sibling to that result type, not a new fail-open path). A cut applied in exercise A
      never affects exercise B's provider resolution.
- [ ] **Staff-only, fiction-preserving (XC-002 / D0 §2 / SOC-003):** the lever and its indicator live
      only on the staff console (COBRA), never a participant path. Participants must **never** learn
      the world is running on Fake — this is exercise-fiction-breaking information, not merely an
      internal detail, so the effective-provider fact is staff-only by construction (no participant
      API, feed, or persona surface projects it, directly or inferably).
- [ ] **Telemetry (XC-004):** the server — not only the frontend — emits an event on both cut and
      restore, carrying wall + scenario time, the acting human (COR-018, including the human behind a
      shared org account), the exercise, and the from/to provider names. This is a deliberate
      correction of the existing gap: kill-switch/restore emit **no** server-side telemetry today
      (frontend emission is the sole audit trail) — this story does not repeat that gap. Whether the
      event rides a new `engine.provider_cut_to_fake` / `engine.provider_restored` pair or an existing
      steering/autonomy-change taxonomy entry is an **open question to align with
      `engine-telemetry-tuning/01-engine-event-types.md` (#173)** before either vocabulary is
      finalized — flag it for that alignment, do not fork the taxonomy unilaterally in this story.

## Out of Scope
- **Selecting any provider other than the startup-configured one.** Not a smaller version of this
  feature — a different, Tier-2 governance decision against `PROVIDER-GOVERNANCE.md` §8 (unsigned).
  The wire contract must not even have a slot for it (see AC4).
- **The §8 go-live itself** (signing off `generationProviderLive`/`generationTenantBounded`/
  `generationNoTrainingAttested`) — unrelated human sign-off this story does not touch or gate.
- **Spend caps or auto-cutting on a cost threshold.** Already named as a deliberate non-goal in
  `engine-telemetry-tuning/feature.md`'s later-phase note (#401) — cross-reference it; do not
  re-litigate an automatic-trigger version of this lever here. This story is the **manual** control
  only, same as the kill switch is manual and the circuit breaker is its automatic sibling.
- **Persisting the cut/restore state across a restart.** In-memory, per-exercise, consistent with
  every existing autonomy/tier-policy lever (`EngineSettingsDto.InMemoryState`/`InMemoryNote`) — name
  this as deferred, not solved, and report it honestly through the same note (see Technical Notes).
- **Refactoring `EngineControlBar`'s kill-switch cycle** or inventing a second toolstrip surface — this
  reuses story 06's existing "ENGINE" flyout/hook, it does not add a new console extension point.
- **A scheduled or automatic version of this cut.** The automatic sibling already exists (the
  circuit-breaker degraded path, generation-infra story 05) and operates on health signals, not egress
  policy; this story does not merge the two mechanisms.

## Technical Notes
Staff world (COBRA console; XC-002). This story has a real backend seam and a thin frontend seam;
cross-reference `implementation.md` before scheduling either half.

**The composition-root change — flag, do not pre-assign.** `AddEngineGeneration` registers exactly one
`IGenerationProvider` today (`ServiceCollectionExtensions.cs:35-55`). A runtime cut needs an
indirection: a selector/decorator registered as the actual `IGenerationProvider` the reaction loop
resolves, which consults a per-exercise cut-state registry and delegates to either the
startup-configured provider or a `FakeGenerationProvider` instance. **Both must therefore be
registered** — the real provider's `AddHttpProvider<TProvider>` branch and the Fake branch, no longer
either/or. This is a change to the composition root (`Pulse.Core.Core.Extensions.
ServiceCollectionExtensions`) and, per the orchestration playbook, is **orchestrator-owned** — call it
out at planning time, do not let a builder wave silently absorb it as an incidental edit.

**State location — mirrors the existing levers, do not invent a second channel.** Per-exercise, in
process memory, alongside `EngineAutonomyRegistry`/the tier-policy-mode store from story 05 (a
`ConcurrentDictionary<Guid, bool>`-shaped registry is the obvious fit). This lever's state must be
reported through the **same** `EngineSettingsDto` snapshot that already carries `InMemoryState`/
`InMemoryNote` — do not add a second "is this exercise messing with the engine's config" read. Because
`InMemoryNote` is a shared `const` (`EngineSettingsContracts.cs:23`, tests and the panel read it
verbatim), adding this lever to what resets on restart means **editing that string**, which is a wire
and test-fixture change, not an additive-only one — call it out in review.

**Wire contract — `provider` becomes two facts, handle it as a deliberate contract change.**
`EngineSettingsDto.Provider` is today `required string`, documented read-only, and implicitly assumed
by every existing consumer to be "what's actually running." Once a cut can be active, that is no
longer true. Add a new field (e.g. `effectiveProvider`) rather than repurpose `provider`'s meaning —
same shape as story 05's `exerciseDefaultLevel`/`effectiveLevel` split (WR-003: a consumer must never
re-derive "cut active ⇒ effectively Fake" by comparing two fields; read the effective field directly).
Keep `provider` meaning "the startup-configured provider, unchanged" so existing tests/consumers that
read it for that meaning do not silently start lying.

**Console surface.** The natural home is story 06's existing "ENGINE" flyout
(`EngineSettingsPanel.tsx`/`useEngineSettings.ts`) — add the cut/restore toggle there rather than a new
toolstrip entry, reusing the **await-then-apply, no-optimism** pattern that flyout's rebuild settled on
(see `06-engine-settings-panel.md`'s Build notes): a click flips only a local `pending` flag, the
authoritative `EngineSettingsDto` response is what's ever displayed, and there is no revert path to
get wrong. Label the effective-vs-configured distinction as text (e.g. "RUNNING ON: FAKE (cut from
Azure OpenAI)"), never a color chip alone (NFR-001).

**Backend files this story is expected to touch:** the composition-root indirection described above
(orchestrator-owned edge); a new per-exercise cut-state registry; two new `POST`s
(`/api/engine/generation-provider/cut-to-fake`, `/api/engine/generation-provider/restore`) on the
existing `/api/engine` group in `EngineReviewEndpoints.cs`, gated by the same
`EngineCockpitControllerRoleFilter` every other mutating `/api/engine` route already uses; the
`EngineSettingsDto`/`EngineSettingsContracts.cs` additive field; the `EngineEventTypes.cs`/
`EngineEventPayloads.cs` telemetry vocabulary, pending the #173 alignment noted in AC7.

## Build notes (backend, edges 6a + 6b — as built)
- **The 6a/6b seam was split slightly differently from the literal Wave-Plan row** (orchestrator call,
  recorded here): 6a delivers the selector, the cut-registry interface + in-memory implementation, and the
  DI registration — self-contained and green on its own; 6b delivers the two routes, the
  `effectiveProvider` field, the telemetry, and the mutation path. 6a alone would have left the DI tests
  red, so they ship as two commits on one branch.
- **Registration mechanics.** `AddHttpProvider<TProvider>` now registers the CONCRETE adapter as its own
  typed client (`AddHttpClient<TProvider>`), and `IGenerationProvider` resolves to
  `GenerationProviderSelector` over `(configured, Fake, cutRegistry)`. The
  `AddResilienceHandler("engine-generation", …)` pipeline and the `GenerationGovernance.Validate` startup
  gate are unchanged and still run before any adapter/HttpClient is constructed. `Provider=Fake` wraps Fake
  on both sides so the cut path is exercised in CI. **`Program.cs` is untouched** — both routes ride the
  already-wired `MapEngineReview()` and the registry rides the already-wired `AddEngineGeneration()`.
- **`Name`/`Governance` pass through to the startup-configured provider even while cut** (deliberate): it
  keeps `provider`'s meaning, keeps the tier-binding validation running (tier bindings are a deployment
  fact and the tier must be servable on restore), and keeps the NFR-006 questionnaire honest.
  `GenerationResult.ProviderName` is where a cut burst truthfully reports `Fake`.
- **Wire additions:** `effectiveProvider` (string), `providerCutToFake` (bool) and `alreadyFake` (bool) on
  `EngineSettingsDto`; `provider` unchanged. All three are resolved server-side so no consumer compares
  fields (WR-003). `InMemoryNote` was EDITED (it now names the provider cut) — a wire + fixture change.
- **Telemetry vocabulary:** ONE new event type, `engine.provider_changed`, with
  `{fromProvider, toProvider, reason: cut|restore, scenarioMinute}` — not a cut/restore pair (smaller
  taxonomy footprint; the from→to already says the direction). **Pending #173 ratification** per AC7; the
  code carries that note at both the event-type and payload declarations.
- **`GenerationResilienceTests`' transport override had to be re-pointed at the concrete adapter type.**
  Registering the real provider's typed client as its own concrete type (`AddHttpClient<TProvider>`,
  above) means a test that still injects its mock transport via `AddHttpClient<IGenerationProvider,
  AzureOpenAIGenerationProvider>()` would create a second, pipeline-less client — and, because
  registration is last-wins, would also displace the selector as the resolved `IGenerationProvider`.
  This was genuinely load-bearing, but **not a silent failure**: left unfixed, it would have red
  `Retry_RecoversFromTransientFailure` and `CircuitBreaker_…_AndSignalsDegraded` outright, because the
  mock transport would no longer sit under the resilience pipeline those tests assert on. Fixed by
  naming the concrete typed client instead.
- **Not built here:** the console toggle/indicator (edge 7) and therefore AC5's NFR-001 label half; the
  UAT pass (impossible until §8 is signed — see Tests).
- **Gate-1 outcome:** clean, 0 Criticals, 3 Warnings. WR-001 (the AC4 route guard was self-referential
  and did not bite) was folded by replacing it with `EngineProviderCutEndpointsTests.
  TheGenerationProviderPrefix_CarriesExactlyTheBinaryPair_WithNoRouteParameter`, which asserts over the
  real `EndpointDataSource` (so it observes `EngineReviewEndpoints.cs` rather than constants in the test
  class). WR-003 (concrete adapters became directly resolvable, so a future consumer could bypass the
  lever) was folded by adding `GenerationProviderInjectionArchitectureTests.
  NoProductionTypeOtherThanTheSelector_InjectsAConcreteGenerationProvider`, the NFR-005 "the selector is
  the only way in" invariant. Both landed in `78e8dc3`. WR-002 (the `InMemoryNote` frontend mock drift
  called out above, under Wire additions) is **deferred to edge 7 and must be in its diff** — the
  frontend suite passes silently against the stale string today because both stale copies
  (`useEngineSettings.ts`'s mock and `EngineSettingsPanel.test.tsx`'s verbatim assertion) are fixtures,
  not assertions against the live contract; edge 7 must also add the one assertion that would catch this
  class of drift in future.
- **Gate-2 outcome (post-integration, `ad33971`):** clean, 0 Criticals, 0 build warnings. `399/399`
  `Pulse.Core.Tests` + `1759/1759` `Pulse.WebApi.Tests` green (0 skipped) under the LocalDB hatch. No
  fold residue in any reachable commit; no semantic collision (`main` had not moved since the fork).
  Gate 2 raised four Warnings: WR-G2-001/002/003 are documentation drift (status line, Build notes
  tense, and this AC↔test table's now-deleted WR-001 test name) — fixed in this pass. WR-G2-004 (the
  architecture guard's coverage claim overreached — constructor injection only, service-location
  uncovered) is being folded by the backend agent in parallel, along with S-G2-001 (an end-to-end
  `ExerciseId` propagation guard, because `ExerciseId` now gates egress selection and CI cannot observe
  a regression when every environment runs Fake on both sides of the selector).

## Dependencies
Story 03 (kill switch — the precedent this mirrors: "one manual control, only ever less", the
restore-capped-at-baseline shape); story 05 (`EngineSettingsDto`/`EngineReviewService`/the
controller-role gate this story's endpoints extend); story 06 (`EngineSettingsPanel.tsx`/
`useEngineSettings.ts` — the console home this story adds a control to, and the await-then-apply
pattern it reuses); engine-generation-infra (`AddEngineGeneration`, `FakeGenerationProvider`, the
circuit-breaker degraded path this lever is the manual sibling of); `engine-telemetry-tuning/
01-engine-event-types.md` (#173) — the taxonomy alignment named in AC7 must be resolved with that
story, not decided unilaterally here. The composition-root change is a planning-time dependency on
orchestrator sign-off, not a builder-assignable file.

## Tests

**Backend (edges 6a + 6b) — written, green.** `Pulse.Core.Tests` are plain `[Fact]`;
`Pulse.WebApi.Tests` DB-touching suites are `[RequiresDockerFact]` (real SQL via Testcontainers, or
`PULSE_TEST_SQL_CONNECTION` locally).

| Test | AC |
|---|---|
| `GenerationProviderSelectorTests.WithNoCut_DelegatesToTheConfiguredProvider` | AC1 |
| `GenerationProviderSelectorTests.AfterCut_DelegatesToTheFakeProvider_AndTheConfiguredProviderIsNeverCalled` | AC1 |
| `GenerationProviderSelectorTests.ThroughAddEngineGeneration_ACutExerciseGeneratesThroughFake_WithoutTouchingTheLiveAdapter` | AC1 |
| `GenerationProviderSelectorTests.AfterRestore_DelegatesToTheConfiguredProviderAgain_AndNeverAThirdProvider` | AC2 |
| `GenerationProviderSelectorTests.ACutInOneExercise_NeverChangesAnotherExercisesResolution` | AC1, AC6 |
| `GenerationProviderSelectorTests.AnUnscopedRequest_FailsClosedToFake_AndNeverEgresses` | AC6 |
| `GenerationProviderSelectorTests.NameAndGovernance_DescribeTheConfiguredDeployment_EvenWhileACutIsActive` | AC5 |
| `GenerationProviderSelectorTests.Cut_IsIdempotent_AndOnlyReportsTheRealTransition` | AC3 |
| `GenerationProviderSelectorTests.ThroughAddEngineGeneration_TheCutRegistryIsASingleSharedInstance` | AC1 |
| `AddEngineGenerationTests.*` (4, rewritten to assert what the selector WRAPS) | AC1, AC2 |
| `ProviderLiveConfigTests.CommittedAppsettings_KeepsFakeProvider_SoCiNeverEgresses` (strengthened: neither side of the lever can egress) | AC2 |
| `EngineProviderCutServiceTests.Cut_WithALiveConfiguredProvider_RoutesTheExercisesNextBurstThroughFake` | AC1 |
| `EngineProviderCutServiceTests.Cut_LeavesTheConfiguredProviderFieldUnchanged_SoExistingConsumersDoNotStartLying` | AC5 |
| `EngineProviderCutServiceTests.Restore_ReturnsTheExerciseToTheStartupConfiguredProvider_AndNeverAnother` | AC2 |
| `EngineProviderCutServiceTests.Cut_WhenTheConfiguredProviderIsAlreadyFake_IsAnHonestNoOp_WithNoTelemetry` | AC3 |
| `EngineProviderCutServiceTests.Restore_WithNoCutActive_IsAnIdempotentNoOp_WithNoTelemetry` | AC3 |
| `EngineProviderCutServiceTests.CuttingTwice_AndRestoringTwice_EmitsExactlyOneEventPerRealTransition` | AC3, AC7 |
| `EngineProviderCutServiceTests.Cut_EmitsExactlyOneProviderChangedEvent_WithActorScenarioTimeAndFromTo` | AC7 |
| `EngineProviderCutServiceTests.Restore_EmitsItsOwnProviderChangedEvent_WithTheReversedFromToAndTheRestoreReason` | AC7 |
| `EngineProviderCutServiceTests.Cut_EmitsNoOtherEngineEvent` | AC7 |
| `EngineProviderCutServiceTests.CutInExerciseA_NeverChangesExerciseBsEffectiveProvider` | **AC6 (Critical)** |
| `EngineProviderCutServiceTests.RestoreInExerciseA_NeverLiftsExerciseBsCut` | **AC6 (Critical)** |
| `EngineProviderCutServiceTests.CutAndRestore_WithAnUnresolvedScope_FailClosed_AndChangeNothing` | **AC6 (Critical)** |
| `EngineProviderCutServiceTests.CutAndRestore_WithoutAnActingHuman_AreRejected_AndChangeNothing` | AC1, AC7 |
| `EngineProviderCutServiceTests.GetSettings_ReportsConfiguredAndEffectiveProvider_AsTwoIndependentlyReadableFields` | AC5 |
| `EngineProviderCutServiceTests.GetSettings_WithFakeConfigured_ReportsAlreadyFake_SoTheConsoleCanSayTheLeverIsInert` | AC3, AC5 |
| `EngineGenerationProviderRequestShapeTests.TheCutAndRestoreRequestContract_HasNoPropertyThatCouldSelectAProvider` | AC4 |
| `EngineProviderCutEndpointsTests.TheGenerationProviderPrefix_CarriesExactlyTheBinaryPair_WithNoRouteParameter` | AC4 |
| `GenerationProviderInjectionArchitectureTests.NoProductionTypeOtherThanTheSelector_InjectsAConcreteGenerationProvider` | AC1, AC2 |
| `GenerationProviderInjectionArchitectureTests.NoProductionSourceOutsideTheCompositionRoot_ServiceLocatesAConcreteGenerationProvider` | AC1, AC2 (Gate-2 WR-G2-004 — the service-location vector the ctor guard cannot see) |
| `EngineSettingsLoopIntegrationTests.TheExerciseIdTheProviderReceives_IsTheOneItsTickWasDrivenWith` | AC1, AC6 (Gate-2 S-G2-001 — `ExerciseId` now gates egress selection, so a dropped hop would silently route every burst to Fake) |
| `EngineProviderCutEndpointsTests.APostedProviderSelector_IsIgnored_AndTheDestinationStaysFake` | AC4 |
| `EngineProviderCutEndpointsTests.ARestoreThatNamesAProvider_StillLandsOnTheStartupConfiguredOne` | AC2, AC4 |
| `EngineProviderCutEndpointsTests.Cut_ThenGetSettings_ReportsConfiguredAndEffectiveProviderAsSeparateKeys` | AC1, AC5 |
| `EngineProviderCutEndpointsTests.Cut_WithFakeConfigured_Returns200_WithAlreadyFakeTrue_AndRecordsNoCut` | AC3 |
| `EngineProviderCutEndpointsTests.BothRoutes_WithAnUnresolvedScope_Return401_WithNoSnapshot` | AC6 |
| `EngineProviderCutEndpointsTests.BothRoutes_MissingActingHumanId_Return400` / `BothRoutes_MissingBody_Return400` | AC1 |
| `EngineProviderCutEndpointsTests.BothLeverRoutes_AreMappedExactlyOnce_OnTheExistingEngineGroup` | AC1 |
| `EngineSettingsEndpointsTests.EveryMutatingRoute_FromANonControllerAssignedStaffSession_Returns403` (both new routes added to `MutatingRoutes`) | AC1, AC7 |
| `EngineSettingsEndpointsTests.EveryRoute_FromAStaffSessionAssignedToADifferentExercise_FailsClosed` | AC6 |
| `EngineSettingsEndpointsTests.EveryMutatingStaffSteeringRouteInTheRealRouteTable_IsCoveredByTheRoleGateTests` (drift guard) | AC1 |
| `GenerationProviderCutCompositionRootWiringTests.*` (4 — real-host route table, 401-not-404, one shared registry, the selector resolves) | AC1, AC6 |

**Neuter-and-confirm (a guard that cannot fail is decoration).** Verified by temporarily breaking each
guard and watching the named test fail, then restoring: the composition-root wiring (both `MapPost`
lines commented → all 4 wiring tests fail on 404 / 0 routes); the isolation guard
(`IsCutToFake` made scope-blind → both `EngineProviderCutServiceTests` isolation tests AND the two
`GenerationProviderSelectorTests` per-exercise tests fail); the fail-closed guard (both service methods
falling back to a fabricated scope → `CutAndRestore_WithAnUnresolvedScope_FailClosed_AndChangeNothing`
fails). That last check also showed the endpoint-level `401` is written by
`EngineCockpitStaffAuthorizationFilter` BEFORE the handler, so the endpoint test is an outcome
(defence-in-depth) assertion only — recorded in its own doc-comment so it is never mistaken for proof of
the service guard.

**Neuter-and-confirm, the two Gate-1 folds (WR-001/WR-003), added post-`72c4cfe`.** Both independently
proven to bite by Gate 2:
- **The route guard** (`EngineProviderCutEndpointsTests.
  TheGenerationProviderPrefix_CarriesExactlyTheBinaryPair_WithNoRouteParameter`): adding a third route
  under `/api/engine/generation-provider` (e.g. a `.../cut-to/{provider}` selector) fails it, naming all
  three templates from the real route table. A second, independent guard
  (`EngineSettingsEndpointsTests.EveryMutatingStaffSteeringRouteInTheRealRouteTable_IsCoveredByTheRoleGateTests`)
  also fails on that same edit — two angles on the same drift, not one.
- **The architecture guard** (`GenerationProviderInjectionArchitectureTests.
  NoProductionTypeOtherThanTheSelector_InjectsAConcreteGenerationProvider`): a production type taking a
  concrete adapter (e.g. `AzureOpenAIGenerationProvider`) as a constructor parameter fails it; and its
  non-vacuity assertion is real — pointing provider discovery at an empty assembly list fails with "the
  guard is worthless if the reflection found no adapters at all".

**Frontend (edge 7) — not built here.** The console toggle + the effective-vs-configured label (AC5's
NFR-001 half) and the AC6 staff-only surface remain edge 7's. Note for that builder: `inMemoryStateNote`
changed (it now names the provider cut), and `useEngineSettings.ts`'s mock copy of that string plus
`EngineSettingsPanel.test.tsx`'s verbatim assertion are now stale against the live contract — the exact
mock/live divergence class this repo keeps hitting.

- **UAT (required once `PROVIDER-GOVERNANCE.md` §8 is signed and a live provider is reachable in an
  environment) — not meaningful before then.** With the live provider active: cut to Fake as a
  controller, confirm the next burst is visibly canned/Fake content and the console indicator updates;
  restore, confirm the next burst returns to live-generated content. Until §8 is signed, this story's
  functional tests are provable only against the Fake-startup-configured case (cut/restore no-op path)
  and against a stubbed/governed-config live provider in-process — no environment exercises a real
  egressing cut, so no UAT pass is claimed.
