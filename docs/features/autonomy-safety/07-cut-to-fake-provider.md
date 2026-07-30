# Story: Cut generation to the Fake provider (runtime egress safety lever)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress — backend (edges 6a+6b) AND frontend (edge 7, the console lever) are both now built. Backend integrated on the umbrella (`feature/autonomy-safety-cut-to-fake`), Gate-1 clean and Gate-2 clean (0 Criticals — see Build notes). Frontend built on `build/autonomy-safety/07-cut-to-fake-console` as a "GENERATION PROVIDER" section inside story 06's existing "ENGINE" flyout (no new toolstrip entry, no new route) — see Build notes (frontend). Its own Gate-1 pass is clean: 0 Criticals, 4 Warnings (WR-001..WR-004, this review's own numbering — see Build notes), all four now folded and integrated (`8e5a9b7`). A subsequent full-stack Gate-2 (post-integration, `#402`) is also clean: 0 Criticals, 3 Warnings, 3 Suggestions — see Build notes and Tests. Every AC now has code behind it, including AC7 (staff-only). NOT Complete: this story's DoD requires verified-in-UAT, and UAT remains blocked — `PROVIDER-GOVERNANCE.md` §8 is still unsigned AND no environment runs an egressing provider. New this pass: the §8 provisioning deploy was attempted and failed on a pre-existing, unrelated infrastructure defect (`databaseDeploy` / `Microsoft.Sql/servers.properties.administrators` is create-only), so UAT is now gated behind an infra fix as well as the governance signature — see Tests.
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
- [x] Given the exercise's startup-configured provider is a real (egressing) provider, when a
      controller-role staff `POST`s the cut (`actingHumanId` required, COR-018), then that exercise's
      reaction loop generates its next burst through `FakeGenerationProvider` instead — immediately,
      with **no restart, no config change, no effect on any other exercise**. The set of registered
      `IGenerationProvider` instances is exactly what startup created; this only changes which
      **already-registered** instance a given exercise resolves to.
- [x] Given a cut is active, when a controller-role staff `POST`s restore, then the exercise's next
      burst reverts to generating through the **startup-configured** provider and no other — restore
      can never land on a provider that was not already running at startup (mirrors kill switch's
      `RestoreFromSafety`: a human-only raise, capped at the pre-existing baseline).
- [x] Given the startup-configured provider is **already** `Fake` (the committed default; every CI run
      and, as of this story, UAT) — cutting is a no-op that reports `alreadyFake: true` rather than a
      false "I just locked something down" signal; restoring when no cut is active is likewise a no-op.
      Both are idempotent, not errors.
- [x] Given the wire contract, when any caller inspects or exercises it, then there is **no field, no
      route, and no accepted literal anywhere that selects a provider by name** — the cut/restore
      endpoints take only `actingHumanId` (+ optional `timeZone`, matching the existing settings
      convention). A request that attempts to pass a provider selector is rejected 400 (or ignored and
      the ignored-field is asserted in a test) so the endpoint shape itself cannot become a chooser by
      a later, smaller change slipping in unreviewed.
- [x] Given `GET /api/engine/settings`, when it reports the active provider, then **configured** and
      **effective** are two distinguishable facts on the wire (see Technical Notes — this changes the
      currently-single `provider` field's implied meaning and must be handled as a deliberate,
      additive contract change, not an overload); the staff console visibly and honestly labels when
      the effective provider differs from the configured one (text, not color alone — folds into the
      NFR-001 AC below) so a controller can never lose track of "we are currently running on Fake."
- [x] **Isolation, fail-closed (COR-001/XC-001):** every cut/restore/read resolves the exercise only
      from `IExerciseContext`; an unresolved scope is `401`, **never** a default/unscoped snapshot
      (matches the existing `EngineSettingsResult.ScopeUnresolved` contract exactly — this is an
      additive sibling to that result type, not a new fail-open path). A cut applied in exercise A
      never affects exercise B's provider resolution.
- [x] **Staff-only, fiction-preserving (XC-002 / D0 §2 / SOC-003):** the lever and its indicator live
      only on the staff console (COBRA), never a participant path. Participants must **never** learn
      the world is running on Fake — this is exercise-fiction-breaking information, not merely an
      internal detail, so the effective-provider fact is staff-only by construction (no participant
      API, feed, or persona surface projects it, directly or inferably).
- [x] **Telemetry (XC-004):** the server — not only the frontend — emits an event on both cut and
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
`EngineEventPayloads.cs` telemetry vocabulary, pending the #173 alignment noted in AC8.

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
  taxonomy footprint; the from→to already says the direction). **Pending #173 ratification** per AC8; the
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
- **Edge 7 (the console toggle/indicator) is now built** — see the separate "Build notes (frontend,
  edge 7 — as built)" section below; AC5's NFR-001 label half is covered there. The UAT pass remains
  impossible until §8 is signed AND an environment runs an egressing provider — see Tests, which also
  now names a pre-existing infrastructure blocker sitting in front of that signature.
- **Gate-1 outcome:** clean, 0 Criticals, 3 Warnings. WR-001 (the AC4 route guard was self-referential
  and did not bite) was folded by replacing it with `EngineProviderCutEndpointsTests.
  TheGenerationProviderPrefix_CarriesExactlyTheBinaryPair_WithNoRouteParameter`, which asserts over the
  real `EndpointDataSource` (so it observes `EngineReviewEndpoints.cs` rather than constants in the test
  class). WR-003 (concrete adapters became directly resolvable, so a future consumer could bypass the
  lever) was folded by adding `GenerationProviderInjectionArchitectureTests.
  NoProductionTypeOtherThanTheSelector_InjectsAConcreteGenerationProvider`, the NFR-005 "the selector is
  the only way in" invariant. Both landed in `78e8dc3`. WR-002 (the `InMemoryNote` frontend mock drift
  called out above, under Wire additions) was **closed by edge 7** — both stale copies
  (`useEngineSettings.ts`'s mock and `EngineSettingsPanel.test.tsx`'s verbatim assertion) were updated to
  name the provider cut and its restore target, plus `useEngineSettings.test.ts` now carries a
  content-match guard (its own test is labelled `WR-002:` after the finding it closes — not to be
  confused with edge 7's own, separately-numbered Gate-1 findings below) that fails if the mock
  regresses to the stale wording.
- **Gate-2 outcome (post-integration, `ad33971`):** clean, 0 Criticals, 0 build warnings. `399/399`
  `Pulse.Core.Tests` + `1759/1759` `Pulse.WebApi.Tests` green (0 skipped) under the LocalDB hatch. No
  fold residue in any reachable commit; no semantic collision (`main` had not moved since the fork).
  Gate 2 raised four Warnings: WR-G2-001/002/003 are documentation drift (status line, Build notes
  tense, and this AC↔test table's now-deleted WR-001 test name) — fixed in this pass. WR-G2-004 (the
  architecture guard's coverage claim overreached — constructor injection only, service-location
  uncovered) and S-G2-001 (an end-to-end `ExerciseId` propagation guard, because `ExerciseId` now gates
  egress selection and CI cannot observe a regression when every environment runs Fake on both sides of
  the selector) were folded by the backend agent in `eb21758` and integrated on the umbrella in
  `8dbf60d` — see the two guards' entries in the AC↔test table above
  (`GenerationProviderInjectionArchitectureTests.NoProductionSourceOutsideTheCompositionRoot_
  ServiceLocatesAConcreteGenerationProvider` and `EngineSettingsLoopIntegrationTests.
  TheExerciseIdTheProviderReceives_IsTheOneItsTickWasDrivenWith`).

## Build notes (frontend, edge 7 — as built)
- **Location: inside story 06's existing "ENGINE" flyout, not a new surface.** A "GENERATION PROVIDER"
  section was added to `EngineSettingsPanel.tsx` / `useEngineSettings.ts` / `engineSettingsActions.ts`
  (`src/frontend/src/features/controller/engine/`) — no new toolstrip entry, no new route, no
  participant surface. Matches the "Console surface" guidance in Technical Notes above.
- **`effectiveProvider` is read directly off the DTO (WR-003 discipline, applied to the provider axis,
  same as story 06 applied it to `effectiveLevel`).** `providerCutToFake`/`alreadyFake` select only
  which control renders (Cut vs Restore, inert vs actionable) — never which string labels the
  "RUNNING ON" text. A sentinel test (`effectiveProvider: 'sentinel-effective-value'` with
  `providerCutToFake: false` — a naive `providerCutToFake ? 'Fake' : provider` re-derivation would
  render this wrong) makes any re-derivation fail loudly.
- **The effective-vs-configured distinction renders as TEXT** (e.g. `"RUNNING ON: Fake (cut from
  AzureOpenAI)"`), with a state-differentiated but `aria-hidden` icon alongside it — never colour alone
  (NFR-001).
- **`alreadyFake` renders the Cut control DISABLED with an explanation**, rather than a live-looking
  control that silently does nothing — true in every environment today (UAT included, since `Provider=Fake`
  there too).
- **Await-then-apply, no optimism** — the same pattern story 06 settled on. A click writes only
  `pendingProviderLever`; `settings` stays untouched (proved by object-identity assertions) until the
  authoritative response lands or the request is rejected. There is no revert path, because nothing was
  ever asserted.
- **Shares the existing per-exercise `requestInFlight` guard as a third mutation kind** (alongside
  `setAutonomyDefault`/`setTierPolicyMode`) — tested in both directions: the provider lever is a no-op
  while an autonomy-default mutation is in flight, and vice versa.
- **`isWireEngineSettings` (the wire-shape guard in `engineSettingsActions.ts`) validates all three new
  fields** (`effectiveProvider`, `providerCutToFake`, `alreadyFake`) — a response missing any of them is
  rejected as malformed, exactly as strict as every pre-existing field (not looser, not stricter).
- **WR-002 (the backend Gate-1 finding, above) is closed here**: both stale `InMemoryNote` frontend
  copies were updated to name the provider cut and its restore target, plus a content-match guard that
  fails if either regresses to the stale wording.

**Edge-7 Gate-1 outcome — clean, 0 Criticals, 4 Warnings.** (This review's own WR-001..WR-004 numbering;
distinct from the backend Gate-1's WR-001–003 above, and from the `WR-002:`-labelled test name that
closes the *backend's* WR-002 finding — three different things sharing overlapping labels across two
separate Gate-1 passes, called out explicitly to avoid confusion.)
- **WR-001** — this doc (`07-cut-to-fake-provider.md`) still described edge 7 as unbuilt (status line,
  the "Not built here" Build-notes bullet, and the Tests section's "Frontend — not built here" line).
  Closed by this doc pass.
- **WR-002** — the disabled Cut button had no programmatic link to its explanatory note for a
  screen-reader user in browse mode (who never tabs to a disabled control). Folded: `aria-describedby`
  on the Cut button (`EngineSettingsPanel.tsx`) plus a `toHaveAccessibleDescription`/`aria-describedby`
  test.
- **WR-003** — the read-only `Provider:` label became ambiguous once an `effectiveProvider` existed
  alongside it. Folded: relabelled to "Configured provider (startup):".
- **WR-004** — the mock-note content-match guard (above) asserts the wording is present but doesn't say
  what it *can't* see. Folded: an honest-limit doc comment added to that test in `useEngineSettings.test.ts`
  stating the limit plainly — it catches a regression to the pre-story-07 wording, but there is no shared
  source of truth across the C#/TS boundary, so it cannot catch the *next* edit to
  `EngineSettingsContracts.cs`'s `InMemoryNote` diverging again; closing that gap needs a
  generated/exported contract fixture, tracked separately (see also WR-G2-007 below).

All three of WR-002/003/004 landed in `8e5a9b7` (edge-7 Gate-1 WR-002/003/004 fold) and are integrated
on the umbrella as of `9b06e11`; this Gate-1 pass is fully closed.

## Gate-2 outcome (full-stack, post-integration, #402)
With both the backend (6a+6b) and the frontend (edge 7) integrated on the umbrella, a full-stack Gate-2
was run against the combined tree. **Clean: 0 Criticals, 3 Warnings, 3 Suggestions.**
- **The wire contract was verified field-by-field on both sides.** All three new fields
  (`effectiveProvider`, `providerCutToFake`, `alreadyFake`) are `required` non-nullable on
  `EngineSettingsDto` with explicit `[JsonPropertyName]` attributes, and the frontend's
  `isWireEngineSettings` validator is neither stricter nor looser than the server contract — it rejects
  exactly the same malformed shapes the server would never send, and accepts exactly the same well-formed
  ones.
- **Mock/live parity was verified against the server's actual idempotency branches** — there is no
  posture the mock can present that the server would not, and UAT's mock posture (`Provider=Fake`,
  `alreadyFake: true`) matches what the real backend reports there.
- **`main` had not moved since the fork (`cb5f25b`)**, so there was no semantic-collision surface to
  check.
- **AC1's real-egressing-provider case is earned in-process, not deferred to UAT:**
  `GenerationProviderSelectorTests.ThroughAddEngineGeneration_ACutExerciseGeneratesThroughFake_
  WithoutTouchingTheLiveAdapter` builds the real composition root with the governed Azure config, cuts,
  and asserts the burst never touches the live adapter — so no AC tick depends on UAT.
- **Warnings WR-G2-005/006** are the two documentation-drift findings fixed by this pass (the AC
  off-by-one plus its unevidenced AC7, and the present-progressive/"verify before trusting" language
  throughout this doc).
- **Warning WR-G2-007** (three hand-maintained copies of `InMemoryNote` — `EngineSettingsContracts.cs`,
  `useEngineSettings.ts`'s mock, and `EngineSettingsPanel.test.tsx`'s verbatim assertion) is being folded
  in parallel on both stacks: a frontend dedupe plus a paired backend assertion, so either side dropping
  a marker reds a build. The residual C#↔TS gap — no shared source of truth across the language boundary
  — remains open and is **deliberately not closed here** (same limit WR-004's doc comment already names).
- **Suggestion S-3** (a model-only sibling for the `ExerciseId` propagation guard, which is currently
  `[RequiresDockerFact]`) was **not taken** — recorded as a known, accepted gap rather than dropped
  silently.

## Dependencies
Story 03 (kill switch — the precedent this mirrors: "one manual control, only ever less", the
restore-capped-at-baseline shape); story 05 (`EngineSettingsDto`/`EngineReviewService`/the
controller-role gate this story's endpoints extend); story 06 (`EngineSettingsPanel.tsx`/
`useEngineSettings.ts` — the console home this story adds a control to, and the await-then-apply
pattern it reuses); engine-generation-infra (`AddEngineGeneration`, `FakeGenerationProvider`, the
circuit-breaker degraded path this lever is the manual sibling of); `engine-telemetry-tuning/
01-engine-event-types.md` (#173) — the taxonomy alignment named in AC8 must be resolved with that
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
| `EngineProviderCutServiceTests.CuttingTwice_AndRestoringTwice_EmitsExactlyOneEventPerRealTransition` | AC3, AC8 |
| `EngineProviderCutServiceTests.Cut_EmitsExactlyOneProviderChangedEvent_WithActorScenarioTimeAndFromTo` | AC8 |
| `EngineProviderCutServiceTests.Restore_EmitsItsOwnProviderChangedEvent_WithTheReversedFromToAndTheRestoreReason` | AC8 |
| `EngineProviderCutServiceTests.Cut_EmitsNoOtherEngineEvent` | AC8 |
| `EngineProviderCutServiceTests.CutInExerciseA_NeverChangesExerciseBsEffectiveProvider` | **AC6 (Critical)** |
| `EngineProviderCutServiceTests.RestoreInExerciseA_NeverLiftsExerciseBsCut` | **AC6 (Critical)** |
| `EngineProviderCutServiceTests.CutAndRestore_WithAnUnresolvedScope_FailClosed_AndChangeNothing` | **AC6 (Critical)** |
| `EngineProviderCutServiceTests.CutAndRestore_WithoutAnActingHuman_AreRejected_AndChangeNothing` | AC1, AC8 |
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
| `EngineSettingsEndpointsTests.EveryMutatingRoute_FromANonControllerAssignedStaffSession_Returns403` (both new routes added to `MutatingRoutes`) | AC1, AC8 |
| `EngineSettingsEndpointsTests.EveryMutatingRoute_FromANonControllerAssignedStaffSession_Returns403` — the same test, cited again for its staff/controller-role gating (an evaluator-assigned session never reaches either route; XC-002/SOC-003) | AC7 |
| `participantIsolation.test.ts` — "finds NO import/require of features/controller/engine/\*\* (alias or relative) under any participant surface root" (Gate-2 fold S-1) — the static complement to the runtime role gate above, closing the "no participant surface projects the effective-provider fact, directly or inferably" half of AC7. Present in the working tree as of this doc pass, **not yet committed** (built in parallel by the frontend agent on `build/autonomy-safety/07-cut-to-fake-console`) | AC7 |
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

**Frontend (edge 7) — written, green.** `EngineSettingsPanel.test.tsx` (component), `useEngineSettings.test.ts`
(hook), `engineSettingsActions.test.ts` (live actions), under
`src/frontend/src/features/controller/engine/`. Only the story-07-specific rows are listed below — the
files also carry story 05/06's own pre-existing coverage (see `06-engine-settings-panel.md`).

| Test | AC |
|---|---|
| `EngineSettingsPanel.test.tsx` — "reads effectiveProvider DIRECTLY off the DTO — never re-derives it from providerCutToFake/provider (WR-003 trap: a naive \"not cut => provider\" derivation would get this wrong)" | AC5 (WR-003) |
| `EngineSettingsPanel.test.tsx` — "shows the effective-vs-configured distinction as TEXT (not colour alone) when a cut is active, and renders the RESTORE control (never CUT)" | AC5, NFR-001 |
| `EngineSettingsPanel.test.tsx` — "renders the CUT control (never RESTORE) with a plain \"RUNNING ON\" label when no cut is active" | AC5 |
| `EngineSettingsPanel.test.tsx` — "renders the cut lever as INERT (disabled + an explanatory note) when alreadyFake is true, rather than a control that looks live but does nothing" | AC3 |
| `EngineSettingsPanel.test.tsx` — "does NOT render the inert note when alreadyFake is false — the cut control is genuinely actionable" | AC3 |
| `EngineSettingsPanel.test.tsx` — "WR-002: programmatically associates the disabled Cut button with its explanation via aria-describedby, …" (edge-7 Gate-1 WR-002 fold, landed `8e5a9b7` — see Build notes) | NFR-001 |
| `EngineSettingsPanel.test.tsx` — "clicking CUT in mock mode applies instantly when the lever is actionable (not alreadyFake)" | AC1, AC5 |
| `EngineSettingsPanel.test.tsx` — "clicking RESTORE in mock mode returns to the configured provider instantly" | AC2, AC5 |
| `engineSettingsActions.test.ts` — "throws MalformedEngineSettingsResponseError when the story-07 fields (effectiveProvider/providerCutToFake/alreadyFake) are missing — the parser validates every declared field, not a spot-checked subset" | AC5 |
| `engineSettingsActions.test.ts` — "POSTs the cut-to-fake path with ONLY actingHumanId + timeZone — no provider selector field of any kind" | AC4 |
| `engineSettingsActions.test.ts` — "resolves with the parsed DTO, including the story-07 fields" (`cutGenerationToFake`) | AC1, AC5 |
| `engineSettingsActions.test.ts` — "POSTs the restore path with ONLY actingHumanId + timeZone — the SAME no-selector body shape as the cut" | AC2, AC4 |
| `engineSettingsActions.test.ts` — "resolves with the parsed DTO, reflecting the restored (non-cut) posture" (`restoreGenerationProvider`) | AC2 |
| `useEngineSettings.test.ts` — "the mock default posture matches every real environment today: provider is Fake, so the lever is INERT (alreadyFake, no cut active, effectiveProvider === provider)" | AC3, AC5 |
| `useEngineSettings.test.ts` — "cutGenerationToFake is an honest no-op when alreadyFake is true (mirrors the live backend) — no network call, no state change" | AC3 |
| `useEngineSettings.test.ts` — "cutGenerationToFake/restoreGenerationProvider apply instantly (no network) once the configured provider is NOT already Fake" | AC1, AC2 |
| `useEngineSettings.test.ts` — "restoreGenerationProvider is an honest no-op when no cut is active — no network call, no state change" | AC3 |
| `useEngineSettings.test.ts` — "WR-002: the mock inMemoryStateNote honestly names the generation-provider cut (and its startup-configured-provider reset target) as reset-on-restart too — …" (closes the **backend** Gate-1's WR-002 finding, above) | (WR-002 fold) |
| `useEngineSettings.test.ts` — "cutGenerationToFake writes NO speculative value: settings is untouched while the POST is outstanding, pendingProviderLever is true, and the FULL authoritative response (…) is applied verbatim on success" | AC1, AC5 |
| `useEngineSettings.test.ts` — "restoreGenerationProvider: same await-then-apply contract, returning effectiveProvider to the configured provider on success" | AC2, AC5 |
| `useEngineSettings.test.ts` — "on a cutGenerationToFake rejection: there is NO revert (settings is untouched, same reference), the lever re-enables, and the error is surfaced" | AC5 |
| `useEngineSettings.test.ts` — "a 403 from the provider lever flips \`forbidden\` — the panel renders read-only rather than a failed action" | AC5 |
| `useEngineSettings.test.ts` — "the provider lever shares the SAME serialization guard as the other two mutations: attempting it while an autonomy-default mutation is in flight is a no-op" | AC5 |
| `useEngineSettings.test.ts` — "conversely, attempting an autonomy-default mutation while the provider lever is in flight is a no-op" | AC5 |

Test names verified against the tree as integrated on the umbrella (`9b06e11`), including the
`EngineSettingsPanel.test.tsx` and `useEngineSettings.test.ts` additions from the WR-002/003/004 folds
(`8e5a9b7`) — this list is final for this pass.

- **UAT (required once `PROVIDER-GOVERNANCE.md` §8 is signed and a live provider is reachable in an
  environment) — not meaningful before then.** With the live provider active: cut to Fake as a
  controller, confirm the next burst is visibly canned/Fake content and the console indicator updates;
  restore, confirm the next burst returns to live-generated content. Until §8 is signed, this story's
  functional tests are provable only against the Fake-startup-configured case (cut/restore no-op path)
  and against a stubbed/governed-config live provider in-process — no environment exercises a real
  egressing cut, so no UAT pass is claimed.
- **New this pass — a pre-existing infrastructure blocker now sits in front of §8, unrelated to this
  story.** The §8 provisioning deploy was attempted and failed in `databaseDeploy`: `properties.administrators`
  on `Microsoft.Sql/servers` is effectively create-only, so `infrastructure/main.bicep` is not idempotent
  against the already-existing UAT SQL server (`InvalidParameterValue: Invalid value given for parameter
  AzureADOnlyAuthentication`). `webappDeploy` and `aiDeploy` never ran as a result, so nothing applied and
  UAT is unchanged. This is an infrastructure defect (fix in `infrastructure/main.bicep` or the deploy
  pipeline), not an AI/generation-governance issue — but it now gates when UAT can even be attempted,
  ahead of the §8 signature itself.
