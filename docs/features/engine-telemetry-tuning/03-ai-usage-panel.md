# Story: AI generation usage panel

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress (built + Gate-2 clean; awaiting UAT verification)
**Requirements:** ADP-041  ·  **Design decisions:** none  ·  **Issue:** #401

## Context
A controller/admin operational surface, distinct from story 02's post-exercise tuning arc: **what is
the engine spending, right now, on which models.** It reads the `engine.generated` event story 01
defines — provider, model, token usage (input/output/cache-read/cache-creation, priced differently),
latency, guard result — and turns it into a live volume view, plus a second, clearly-separated cost
view priced from a config-sourced per-model table.

The provider readout already ships and is out of scope to rebuild here: `GET /api/engine/settings`
returns `EngineSettingsDto.Provider`
(`src/Pulse.WebApi/Features/EngineRuntime/EngineSettingsContracts.cs:26-28`), and the controller
console already renders it — `EngineSettingsPanel.tsx:509` ("Provider:
{settings.provider}", under "Read-only provider + tier mapping — never editable here"). This story's
job is **volume and cost**, a live-ops view the settings panel does not attempt.

Background, verified this session: UAT today runs the `Fake` provider — zero LLM egress: 1,722
`engine.generated` rows, every one `"provider":"Fake","model":"fake-deterministic"`, 0 tokens, ~0.02ms
latency, bursting every 3 minutes because the reaction loop is live and producing deterministic
templated content on a provider that costs nothing and calls nothing external. The `Fake` provider
reports zero tokens **by construction** — that stays true in CI, and in any environment still
configured to `Fake` — so this panel's cost view correctly reads $0 today; that is the correct
reading, not a defect, and it is not a permanently hypothetical one either: cost becomes meaningful
the moment a live provider is configured. This panel is the pre-flight verification surface for
`docs/features/engine-runtime/PROVIDER-GOVERNANCE.md` §8 — before flipping a live provider on,
someone needs to look at this panel's volume/cost view and see "0 calls, $0" turn into "N calls, $Y"
and know that's the expected transition, not a surprise.

Also resolved this session: the infrastructure blocker that gated §8's provisioning half has been
**fixed and validated** — `Microsoft.Sql/servers.properties.administrators` was create-only, which
made `main.bicep` non-idempotent against the live UAT SQL server; the fix moved it to the child
resource (PR #404), and a full provisioning deploy then succeeded, so the App Service now carries its
managed identity and all eleven `Generation__*` settings, with `Generation__Provider = Fake`. §8
itself is still an unsigned human sign-off (its evidence boxes are unticked and the document is
otherwise unchanged) — this fix clears one of the mechanical preconditions for eventually signing it,
it does not sign it. Treat §8 as **signed for planning purposes** (Tom's instruction this session):
plan and build this story against a world where a live provider will eventually be flipped on, rather
than treating that flip as indefinitely hypothetical — but do not write or imply that §8 has actually
been signed.

Emission already exists and is out of scope here — `EngineEventPayloads.Generated`
(`src/Pulse.WebApi/Features/EngineRuntime/Telemetry/EngineEventPayloads.cs:83`), emitted by
`ReactionLoopHost.BuildGeneratedEvent` (`src/Pulse.WebApi/Features/EngineRuntime/ReactionLoopHost.cs:674`)
into the XC-004 v0 `TelemetryEvents` table. This story closes three gaps: (1) there is no telemetry
read API anywhere in `Pulse.WebApi` today — only `POST /api/telemetry` ingest and the engine slice's
`GET /api/engine/review-queue` / `GET /api/engine/settings`
(`src/Pulse.WebApi/Features/EngineRuntime/EngineReviewEndpoints.cs:98`); (2) there is no UI — the panel
belongs alongside `ReviewQueue.tsx` / `EngineSettingsPanel.tsx` / `console/EngineControlBar.tsx` under
`src/frontend/src/features/controller/engine/components/`; (3) cost needs a genuinely new per-model
price table, since nothing in the repo prices anything today.

See `docs/design/E8-ENGINE-ARCHITECTURE.md` §11 and `feature.md`. Deliberately **not** folded into
story 02 (#174), which is the post-exercise hotwash/tuning arc surface with EVL-014 dial overlays —
this story is the narrower live-operations question.

## Acceptance Criteria
- [x] **Given** the usage panel needs to make the active provider unambiguous within the usage
      context, **when** it states which provider the volume/cost data below belongs to, **then** it
      reuses the existing `GET /api/engine/settings` `provider` value (already surfaced in
      `EngineSettingsPanel.tsx`) rather than deriving a second, independently-computed provider
      readout — two staff surfaces disagreeing about which provider is live would be worse than one
      surface stating it once.
- [x] **Given** the exercise's `engine.generated` events, **when** the panel renders volume, **then**
      it shows call counts over time broken down by provider and model, with tokens split into input,
      output, cache-read, and cache-creation (priced differently, kept distinct), latency, and the
      guard-result mix (a re-roll is a call that cost money and produced nothing, so it's counted, not
      dropped).
- [x] **Given** the same event data, **when** the panel renders cost (a separately labeled section from
      volume), **then** it prices tokens against a per-model price table sourced from config (never
      hardcoded, since Foundry deployments in this repo are not version-pinned and pricing drifts); a
      model with no price-table entry shows its token counts with an explicit "unpriced" state, never a
      silently-wrong $0. (Note: the `Fake` provider reports 0 tokens by construction, so cost correctly
      reads $0 pre-flip — that is not this AC's failure case.)
- [x] **Isolation (XC-001/COR-001):** the panel shows only the calling controller's own exercise's
      usage; a cross-exercise request for another exercise's usage returns 403/404.
- [x] **Two worlds (XC-002/D0 §2):** staff surface — COBRA theme (`@/theme/styledComponents`), lives
      under the controller console route tree, never rendered on or leaking into a participant path
      (SOC-003 — participants never see engine call volume, cost, or provider identity).
- [x] **Scenario time (COR-053):** the panel is staff-only so wall-clock is permitted and is in fact the
      more useful axis for a live ops question ("what did the engine spend in the last 10 minutes of
      real time") — the panel labels its time axis explicitly as wall-clock, not scenario time, so a
      reader is never left guessing which clock they're looking at.
- [x] **Accessibility (NFR-001):** WCAG 2.1 AA; the provider state and guard-result mix are never
      color-only (e.g. an icon/text label alongside any red/amber/green usage or guard-failure cue).
- [x] **Telemetry (XC-004):** the panel is a read/view over the existing `engine.generated` event log
      (story 01's extension of the v0 schema) — it introduces no parallel event taxonomy and no second
      store; it queries or projects the existing `TelemetryEvents` rows.

> **Status note:** all eight ACs above are proven on the integrated umbrella (Gate-2 verdict: PASS on
> AC1–AC8; AC4's isolation additionally proven by a neuter-and-watch-it-fail test against the central
> query filter; AC5 additionally enforced structurally by the directory-level
> `participantIsolation.test.ts` import guard). The one thing still outstanding is the manual UAT check
> in the Tests section below (verify against the UAT DB pre-flip) — that has **not** been run yet, which
> is why this story's Status stays **In Progress**, not Complete, until it is.

## Follow-ups recorded during build (NOT built here)
Each of these was raised in code review and **consciously deferred** — recorded here so none is
silently dropped once this story closes.

- **No `EventType` index on `TelemetryEvents`.** Every usage read re-scans the exercise's
  `engine.generated` rows (there is no index on `EventType`, only on `ExerciseId`). A schema change
  would pull in Tier-2 human sign-off plus a migration whose snapshot could collide with any other
  migration landing in the same wave, so it was deliberately left out of this story, which owns
  behaviour, not schema. Mitigated for now by the panel doing **no interval polling**: exactly one
  read on first panel open per console session (WR-001, folded — see the "03c as built" section
  below), plus a manual Refresh button. The honest revisit trigger is the day this panel — or any
  other reader of `engine.generated` — starts polling on an interval; until then the cost of the
  scan is paid once per session, not continuously.
- **S-1 — a frontend/backend seam drift risk on the default window.** `useEngineUsage.ts:120`
  hardcodes `60` as the server's default window and uses that constant to decide whether to *omit*
  the `windowMinutes` query parameter, while `EngineUsageAggregator.DefaultWindowMinutes` is the
  actual owner of that default on the backend. If the backend default ever changed, the "1 hr" chip
  would stay visually pressed while the panel silently rendered a different window underneath it —
  no error surfaces on either side, and no cross-language test can catch a drift like this. The
  correct fix is for the frontend to treat "default" as "omit the parameter and adopt whatever
  `usage.window.windowMinutes` comes back in the response" rather than asserting its own copy of the
  number. Deferred because it touches `UsagePanel.tsx`, which a parallel session is concurrently
  editing; tracked here so it isn't lost.
- **S-2 — the wire cost DTO relies on validator enforcement rather than an unrepresentable shape.**
  `EngineUsageModelCostDto` leaves the five cost fields and `rates` as plain optionals with only
  `Priced` required, so C# would permit constructing a `priced: true` row with nulls — exactly the
  shape the frontend's `isWireModelCost` validator now hard-rejects (WR-003, folded). A private
  constructor plus `Priced(...)`/`Unpriced(...)` factory methods on the backend DTO would make the
  wrong shape impossible to construct in the first place, rather than merely caught downstream. Gate
  2 confirmed the backend **cannot currently emit** such a row through any live code path, so this is
  hardening for the future, not a live defect today.
- **S-3 — the controller-console `chrome` style-token block is now duplicated in six files**, the
  known replicated-design-token hazard this repo has hit before. Gate 2 asked for a separate,
  mechanical consolidation PR rather than folding it into this story's diff; that cleanup is already
  spawned as its own task.
- **The price table ships no live-provider $/token figures.** This was always Out of Scope for this
  story (config data entry, not a design decision), so a live model correctly reads "unpriced" until
  a deployment supplies real rates. The key shape a real deployment needs to fill in is documented in
  `appsettings.Generation.Example.json`, with placeholder rate values left deliberately as **strings**
  so an unedited copy-paste of the example fails to bind rather than silently pricing a live model at
  $0.

## Out of Scope
E10's full timeline/replay UI; story 02's sentiment/intensity arcs and EVL-014 dial overlays (that is
the hotwash surface — this is live ops); budget enforcement, spend caps, or auto-throttling on cost
(deliberate non-goal — this story is observability, not a control; if a future story wants a spend
cap it is a new story against a different requirement); the PROVIDER-GOVERNANCE §8 go-live itself
(this panel is a *consumer* of that decision, not the mechanism that flips it); building the price
table's actual $/token figures (config data entry, not a design decision this story makes).

## Technical Notes
Staff surface — COBRA styling throughout; sits alongside `ReviewQueue.tsx`, `EngineSettingsPanel.tsx`,
and `console/EngineControlBar.tsx` in
`src/frontend/src/features/controller/engine/components/`.

See `implementation.md` for the reuse map and Wave Plan rows (one `stack: backend` edge — 03a: usage read
API, volume aggregation, price table and the cost rollup over it, wave 3 — then `stack: frontend` 03c,
wave 4, strictly serial after it; an earlier draft split the rollup out as a parallel 03b and the note
under that Wave Plan records why it was collapsed) and the composition-root integration-seam note — this story adds the
first telemetry *read* endpoint in `Pulse.WebApi`, which needs a `WebApplicationFactory<Program>`
composition-root route guard, not just slice-level TestServer coverage.

**Open design question (flagged, not decided by this story):** whether the read API is a new query
endpoint on the existing `EngineRuntime` slice (alongside `EngineReviewEndpoints.cs`) or a new
`Telemetry` read slice is an implementation call for whoever builds this. Either way it must respect
the `IExerciseScoped` / `PulseDbContext` central query-filter isolation guarantee
(`src/Pulse.WebApi/Data/Entities/TelemetryEvent.cs:20`) — no bespoke exercise-scoping logic.

> **RESOLVED by 03a as built:** the existing slice, not a new one. `GET /api/engine/usage` is mapped on
> `EngineReviewEndpoints.cs`'s **`cockpit`** sub-group — the staff-only READ group `GET
> /api/engine/review-queue` and `GET /api/engine/settings` already sit on — and NOT on the `steering`
> sub-group, whose additional `EngineCockpitControllerRoleFilter` gates *mutations* (a spend/volume view is
> observability an assigned evaluator may watch, asserted by
> `EngineUsageEndpointsTests.GetUsage_IsReadableByAnAssignedEvaluator_NotJustAController`). Because
> `AddEngineReview`/`MapEngineReview` are already wired, this needed **no** orchestrator-owned `Program.cs`
> edit and no new slice. Isolation comes from the central query filter over the `IExerciseScoped`
> `TelemetryEvent` entity — `EngineUsageService` contains no hand-written `ExerciseId` predicate and no
> `FromSql`/aggregate SQL. No EF migration and no schema change; in particular **no `EventType` index** was
> added (still a future consideration — see the note below).

**Decided: aggregation mechanics — app-layer projection (Tom, ratified).** `TelemetryEvent.Payload`
is an opaque `nvarchar(max)` JSON string the server "never parses" today
(`src/Pulse.WebApi/Data/Entities/TelemetryEvent.cs:73-77`, by design per the v0 envelope contract).
Two shapes were weighed — (a) JSON-querying the payload in SQL (`OPENJSON`/`JSON_VALUE`) vs. (b)
reading rows and projecting/aggregating in the application layer — and **(b) is the decision**:

- **Measured, not assumed, on live UAT:** the busiest exercise has **1,722 `engine.generated` rows
  at ~236 bytes** of payload each — roughly 400 KB total. `TelemetryEvents` carries only its `PK`
  plus `IX_TelemetryEvents_ExerciseId` (`PulseDbContext.cs`'s `TelemetryEvent` config) — **there is
  no index on `EventType`**, and `JSON_VALUE`/`OPENJSON` over an `nvarchar(max)` column cannot use an
  index without a persisted computed column, which nothing in this codebase provisions today. So
  **SQL-side JSON would not avoid the scan** — both shapes scan the exercise's rows at this volume.
  The performance argument is a wash; the decision turned on contract and isolation instead.
- **Contract:** deserializing into the emitter's own `EngineEventPayloads.Generated` record
  (`src/Pulse.WebApi/Features/EngineRuntime/Telemetry/EngineEventPayloads.cs:84`) gives writer and
  reader one shared definition, fails loudly on a shape mismatch, and is unit-testable in isolation.
  A `JSON_VALUE(Payload, '$.tokenUsage.inputTokens')` path re-encodes payload field names as SQL
  string literals that fail *silently* — a renamed field yields `NULL`, which coalesces to 0, and the
  cost view under-reports spend without an error anywhere. Plausible-but-wrong numbers are the worst
  failure mode for a spend view.
- **Isolation (the decisive factor):** aggregate SQL that returns scalars/DTOs directly does not flow
  through the EF entity query pipeline, so `PulseDbContext`'s central query filter
  (`HasQueryFilter(e => e.ExerciseId == _currentExerciseId)`) is not what protects it — the builder
  would end up hand-writing the `ExerciseId` predicate into the raw query, exactly the "bespoke
  exercise-scoping logic" this story already forbids above.
- **Prescribed shape:** query `TelemetryEvent` as **entities** (so the central filter applies),
  `.Where(e => e.EventType == "engine.generated")` plus a time-window filter, `.Select()` only
  `Payload` + `WallClockTime` (do not materialize all ~24 envelope columns per row), deserialize each
  `Payload` into `EngineEventPayloads.Generated`, and aggregate in a **pure, unit-testable function**
  (volume/cost buckets in, `TelemetryEvent`/EF out of that function's signature entirely).
- **Honest revisit trigger — not row growth:** the shape earns re-litigation the day this becomes a
  **cross-exercise admin cost rollup** ("all exercises, this month") rather than one controller's own
  exercise — a genuinely different query shape where SQL-side aggregation, or a rollup table written
  at emit time, would earn its complexity. Worth doing before then regardless: add an `EventType`
  index if this panel polls on an interval, since every poll re-scans the exercise's `engine.*` rows.

**Decided: the price table is config-sourced, never a hardcoded switch.** An `appsettings` section
keyed by provider+model (mirroring the `Generation:*` shape `PROVIDER-GOVERNANCE.md` documents), not
a `switch` on provider/model string literals in code. Foundry deployments in this repo use
`versionUpgradeOption: 'OnceNewDefaultVersionAvailable'` (`infrastructure/modules/ai.bicep`) — not
version-pinned — so pricing for a given model name can drift under the deployment with no
accompanying code change. A model absent from the table renders its token counts with an explicit
"unpriced" state (AC3), never a silently-wrong `$0`.

**Two different questions — do not conflate them.** Per AC1, the "what provider are we on" statement
is not this panel's to compute: it reuses `GET /api/engine/settings`'s `provider`
(`EngineSettingsDto.Provider`), the same value `EngineSettingsPanel.tsx` already renders, as the
single authoritative source for "what is configured/live *now*". Separately, the volume and cost ACs
aggregate by the provider/model values actually recorded on each `engine.generated` event — that's a
different question, "what provider produced *these historical calls*", and it has to be answered from
the event data regardless of what's configured now: if the governed provider has since changed (a
PROVIDER-GOVERNANCE §8 flip), historical rows must still roll up under the provider that actually
produced them, not the currently-configured one. The panel should present both without letting either
stand in for the other.

## Dependencies
Story 01 (`engine.generated` event shape, XC-004 extension) — must exist for this story's data source
to be defined, though the emission itself is already implemented. No dependency on story 02.

## Tests
- Unit: provider-state display reflects the most recent observed provider/model, and reads "no model
  calls" when the event log is empty or all-Fake.
- Unit: volume aggregation correctly buckets calls by provider/model and sums token categories
  (input/output/cache-read/cache-creation) and guard-result counts.
- Unit: cost aggregation prices a model with a price-table entry correctly, and renders "unpriced"
  (not $0) for a model absent from the price table.
- Unit: a cross-exercise usage request returns 403/404 (isolation).
- Manual: verify against the UAT DB pre-flip — panel reads "Fake — no model calls" (mirroring the
  1,722-row Fake-provider dataset verified this session) with $0 cost and populated volume counts.

### 03a (backend edge) — as built

`src/Pulse.WebApi.Tests/Features/EngineRuntime/Usage/`

**AC1 — no second provider readout (reuse `GET /api/engine/settings`)**
- `EngineUsageAggregatorTests.UsageDto_CarriesNoLiveProviderField_ButPerModelRowsDoNameTheirProvider` (AC1) —
  reflection pin: the top-level DTO has no `provider`/`effectiveProvider`, while the per-model rows do carry the
  *historical* provider (the different question).
- `EngineUsageEndpointsTests.GetUsage_ReturnsTheDocumentedWireShape_TheFrozenSeamForTheFrontendPanel` (AC1) —
  the served JSON has no top-level `provider` key.

**AC2 — volume: calls over time, by provider/model, token categories distinct, latency, guard mix**
- `EngineUsageAggregatorTests.BuildWindow_DefaultsToOneMinuteBuckets_AndNeverExceedsTheBucketCeiling` (AC2)
- `EngineUsageAggregatorTests.Aggregate_PlacesEachCallInItsWallClockBucket_AndKeepsTheSeriesDense` (AC2)
- `EngineUsageAggregatorTests.Aggregate_AttributesEveryCallExactlyOnce_SoTheSeriesSumsToTheTotal` (AC2)
- `EngineUsageAggregatorTests.Aggregate_BreaksVolumeDownByProviderAndModel_BusiestFirst` (AC2)
- `EngineUsageAggregatorTests.Aggregate_KeepsTheFourTokenCategoriesDistinct_AndNeverSumsThemIntoOneNumber` (AC2)
- `EngineUsageAggregatorTests.Aggregate_CountsTheGuardResultMix_IncludingReRollsThatCostMoneyAndProducedNothing` (AC2)
- `EngineUsageAggregatorTests.Aggregate_SummarisesLatency_TotalAverageAndMax` (AC2)
- `EngineUsageAggregatorTests.Aggregate_WithNoCalls_ReturnsADenseZeroSeriesAndNoModels_NeverAnEmptyBody` (AC2)
- `EngineUsageEndpointsTests.GetUsage_RollsUpThisExercisesGeneratedEvents_TokensLatencyAndGuardMix` (AC2)
- `EngineUsageEndpointsTests.GetUsage_CountsOnlyEngineGeneratedRows_NotTheRestOfTheEngineEventLog` (AC2/AC8)
- `EngineUsageEndpointsTests.GetUsage_ExcludesRowsOutsideTheRequestedWindow` (AC2)
- `EngineUsageEndpointsTests.GetUsage_WithAWindowOutsideTheSupportedBounds_Returns400_NeverASilentClamp` (AC2)

**AC3 — cost, config-sourced, explicit "unpriced" (never a silently-wrong $0)**
- `EngineUsageAggregatorTests.Aggregate_PricesAModelWithAPriceTableEntry_PerTokenCategory` (AC3)
- `EngineUsageAggregatorTests.Aggregate_ReportsAModelWithNoPriceTableEntryAsUnpriced_WithNullCostsNeverZero` (AC3)
- `EngineUsageAggregatorTests.Aggregate_PricedTotalCoversOnlyPricedModels_AndSaysSoWithAnyUnpriced` (AC3)
- `EngineUsageAggregatorTests.Aggregate_PricesTheFakeProviderAtZero_WhichIsAFactNotAPlaceholder` (AC3)
- `EngineUsagePriceTableTests.TheDocumentedKeyShape_BindsProviderAndModelRates` (AC3)
- `EngineUsagePriceTableTests.Lookup_IsCaseInsensitiveOnBothProviderAndModel` (AC3)
- `EngineUsagePriceTableTests.AnAbsentSection_BindsToAnEmptyTable_SoEveryModelIsUnpricedRatherThanFree` (AC3)
- `EngineUsagePriceTableTests.Empty_PricesNothing` / `.TryGetRates_WithNoProviderOrModel_IsUnpriced` (AC3)
- `EngineUsagePriceTableTests.CommittedAppsettings_PricesFakeAtZero_AndPricesNoLiveProvider` (AC3)
- `EngineUsagePriceTableTests.ThePricingSection_IsNotBoundByGenerationOptions_SoTheGovernanceGateIsUntouched` (AC3)

**AC4 — isolation (XC-001/COR-001), fails closed**
- `EngineUsageEndpointsTests.GetUsage_SeesOnlyItsOwnExercisesCalls_WhileTheOtherExercisesRowsProvablyExist` (AC4) —
  the crown-jewel shape: A sees 1 call, B's 5 are invisible (count *and* tokens *and* model name), and
  `IgnoreQueryFilters` proves B's rows physically exist, so the zero is the filter closing the door.
- `EngineUsageEndpointsTests.GetUsage_UnresolvedScope_Returns401_FailClosed` (AC4)
- `EngineUsageEndpointsTests.GetUsage_FromAStaffSessionAssignedToADifferentExercise_FailsClosed` (AC4)

**AC5 — staff-only surface (XC-002/SOC-003)**
- `EngineUsageEndpointsTests.GetUsage_WithNoStaffSession_IsRefused` (AC5)
- `EngineUsageEndpointsTests.GetUsage_IsReadableByAnAssignedEvaluator_NotJustAController` (AC5)

**AC6 — wall-clock axis, labelled (COR-053 staff carve-out)**
- `EngineUsageAggregatorTests.Aggregate_LabelsItsTimeAxisAsWallClock_SoNoReaderHasToGuessTheClock` (AC6)

**AC8 — a read over the existing event log, no second store; honest about unreadable rows**
- `EngineUsagePayloadReaderTests.TryRead_ReadsBackWhatTheRealEmitterWrote_FieldForField` (AC8)
- `EngineUsagePayloadReaderTests.TryRead_RejectsNullBlankAndMalformedPayloads_WithoutThrowing` (AC8)
- `EngineUsagePayloadReaderTests.TryRead_RejectsAShapeMismatch_RatherThanSilentlyScoringItAsZeros` (AC8)
- `EngineUsageAggregatorTests.Aggregate_ReportsTheUnparseableRowCountVerbatim_WithoutScoringThemAsZeros` (AC8)
- `EngineUsageEndpointsTests.GetUsage_WithNullAndMalformedPayloads_CountsThemExplicitly_AndNeither500sNorScoresThemAsZeros` (AC8)

**Composition root (required beyond the ACs — the #310→#317 dead-wiring class)**
- `EngineUsageCompositionRootWiringTests.ProgramCs_MapsTheUsageRoute_ExactlyOnce`
- `EngineUsageCompositionRootWiringTests.ProgramCs_ResolvesTheUsageService_FromARealRequestScope`
- `EngineUsageCompositionRootWiringTests.ProgramCs_BindsThePriceTable_FromTheCommittedGenerationPricingSection`
- `EngineUsageEndpointsTests.UsageRoute_IsMappedExactlyOnce_OnTheExistingEngineGroup`

Verified to BITE, not merely to pass: commenting out the `cockpit.MapGet("/api/engine/usage", …)` line reds
`ProgramCs_MapsTheUsageRoute_ExactlyOnce` ("Expected … to be 1 … but found 0"); commenting out the service +
options registration reds all three ("Body was inferred but the method does not allow inferred body
parameters … `service | Body (Inferred)`" — an unregistered handler dependency on a GET is a host-build throw
here, not a silent 500). Both restored and re-confirmed green.

### 03a — adversarial QA pass (added beside the above, nothing removed)

A second, independent test pass hunted for coverage that PASSES without PROVING. Three gaps were found and
closed; **no production behaviour was changed** (the only production edits in this pass are contract/config
documentation — an XML remark and a `Generation:Pricing` example block) and **no existing test was weakened,
deleted or rewritten** — new assertions were added beside the originals, and where an original is looser than its
replacement that is stated below rather than silently resolved by deletion.

**Verdict on the AC4 isolation coverage: REAL, not vacuous.** Verified by neutering — the central query filter
was skipped for `TelemetryEvent` in `PulseDbContext.OnModelCreating`, and
`GetUsage_SeesOnlyItsOwnExercisesCalls_WhileTheOtherExercisesRowsProvablyExist` went red ("Expected … to be 1 …
but found 17"). The `IgnoreQueryFilters` proof is genuine (a second context, not a self-referential count), so
the zero is the filter closing the door. Filter restored, re-confirmed green.

**Gap 1 — the 401 fail-closed test credited the wrong layer.** `GetUsage_UnresolvedScope_Returns401_FailClosed`
is answered by `EngineCockpitStaffAuthorizationFilter`, not by `EngineUsageService`: with the service's
`TryResolveScope()` replaced by `return true`, that test still PASSED. So the service's own COR-001 branch — and
its `windowMinutes` bounds check — were both unexercised. New `EngineUsageServiceFailClosedTests` drives the
service directly over a `PulseDbContext` pointed at an unreachable SQL Server, so "refused without querying" is
observable rather than asserted, with `TheUnreachableHarnessReallyBites_AQueryHereThrows` as the positive control.

**Gap 2 — layer ordering was unpinned.** Measured, not assumed: the endpoint filter wraps parameter binding, so a
session-less caller sending an UNBINDABLE `windowMinutes` gets `401` (not the framework's `400`) — the correct
ordering, now pinned in both directions. Two distinct `400` paths exist and are distinguishable only by BODY
(framework binding = empty; service validation = names the parameter). Note for 03c: `?windowMinutes=` (empty) is a
`400` — the parameter must be OMITTED to get the default.

> **Attribution correction (review finding WR-001, folded).** Those ordering measurements were taken on
> `UsageTestHost`, which wires the *feature* (`AddEngineReview`/`MapEngineReview`) and **no** authentication or
> authorization middleware — so the refusals observed there are the slice's own
> `EngineCockpitStaffAuthorizationFilter`, not the application pipeline. In the real host the first responder is
> `Program.cs`'s deny-by-default `AddSessionAuthorization()` `FallbackPolicy` + `app.UseAuthorization()`, and
> `/api/engine/usage` is correctly absent from the eleven-route `PreAuthAllowlist` — so **production refuses an
> anonymous caller earlier and harder than these tests measure**. The conclusion (refusal precedes validation and
> binding) holds; the mechanism credited did not. Both docstrings and `UsageTestHost`'s own summary now name the
> host measured and state the production ordering explicitly. Pinning the slice layer is still worth it precisely
> *because* the outer gate would otherwise mask its loss.

**Gap 3 — aggregation boundaries and ordering.** `EngineUsageAggregatorArithmeticTests`: tick-exact edge/bucket
placement; every window in [1, 1440] against the bucket ceiling; six windows whose minutes do not divide evenly;
bucketing by instant rather than local clock; the model and guard-mix tie-breaks (previously order-insensitive
assertions); an unrecognised guard literal plus `sum(guardResults) == totals.calls`; same model name under two
providers not merged; pricing from summed tokens so rounding cannot accumulate; the six-decimal away-from-zero
mode; volume-complete-vs-cost-floor; and the explicit-nulls payload shape `required` does not reject.

New endpoint tests: isolation extended to the bucket series, guard mix, cost rows and `unparseableEvents`; a
client-supplied `exerciseId` proven to be ignored; a strict-`403` cross-exercise refusal test added **beside**
`GetUsage_FromAStaffSessionAssignedToADifferentExercise_FailsClosed` — whose `BeOneOf([Forbidden, Unauthorized])`
is deliberately **kept, not replaced**, since a loose fail-closed assertion is still a true statement and removing
a passing test to make room is not this pass's business; and a configured-zero rate told apart from an absent
model in one response body. `403` is reachable only from the assignment branch of the cockpit filter, so the new
test is what attributes the refusal, while the old one continues to state the weaker guarantee.

All new tests were verified to BITE: four defects injected into the aggregator at once (banker's rounding, no
tie-break, provider dropped from the grouping key, `Ceiling` for `Floor` at the bucket edge) reddened seven of them.

**Also folded from the same review round:**

- **WR-003 — the operator-facing example now documents the pricing keys.** `appsettings.Generation.Example.json`
  gained a `Generation:Pricing` block: **key shape only**, keyed by the `Tiers.*.Model` ids an `engine.generated`
  event actually records, with all four categories present, plus the "a correct `unpriced` reading is not a defect"
  note that this repo's UAT history says someone will otherwise file as a bug. The rate values are placeholder
  **strings** on purpose — they will not bind to a decimal, so copying the block without editing it fails loudly
  instead of pricing a live model at `$0`. Real figures stay out (story Out of Scope: they are per-environment
  config data entry, and Foundry deployments are not version-pinned so a committed figure goes stale silently).
  `EngineUsagePriceTableTests.TheGovernedExample_DocumentsThePricingKeyShape_KeyedByTheModelIdsItsOwnTiersConfigure`
  pins the shape and the model-key/tier-model agreement, so the example cannot drift onto deployment names.
  `PROVIDER-GOVERNANCE.md` was deliberately not touched — §8 is another owner's document.
- **SG-001 — the final bucket may be PARTIAL, now stated on the contract.** `EngineUsageWindowDto.BucketMinutes`
  documents that `windowMinutes` need not be a whole multiple of `bucketMinutes` (61 → 2-minute buckets, the 31st
  holding one minute). Counts stay exact and `sum(buckets) == totals.calls` still holds, so a chart of COUNTS is
  correct as served — but 03c rendering calls-per-bucket as a **rate** would understate the freshest bucket by up
  to half, and that is the point an operator watches. The note gives the true final span
  (`windowMinutes - bucketMinutes * (bucketCount - 1)`). Documentation only: the bucketing behaviour is unchanged,
  and every window the panel is expected to offer (1/15/60/240/1440) divides evenly, so this is latent, not live.
- **SG-005 — the AC1 provider pin is now name-agnostic.** The reflection test enumerated three literal names
  (`Provider`/`EffectiveProvider`/`ProviderCutToFake`), which a future `LiveProvider` would have walked past; it
  now rejects any top-level member whose name *contains* `Provider`, and the wire-shape test does the same over the
  served JSON's top-level keys. The residue is stated in the test rather than left implied: a readout smuggled
  inside a new nested object with an innocuous name is not reachable by reflection, because the legitimate nested
  `byModel`/`cost` rows must be allowed to carry `provider`.

**Two findings recorded and deliberately NOT fixed** (so nobody re-litigates them):

- **The price-table case collision is an unreachable branch, not a tolerable failure mode.**
  `EngineUsagePriceTable.FromOptions` assigns `providers[providerName] = rates` into an `OrdinalIgnoreCase`
  dictionary, so two provider keys differing only in case would overwrite rather than merge. The reviewer retired
  this empirically: probing two configuration sources supplying `Providers:Fake:m1` and `Providers:fake:m2`, the
  configuration root **collapses them to one child and merges the model maps** (both models priced, nothing
  dropped). So the collision is unreachable from *any* `IConfiguration` source — not merely from a single JSON file
  — and only from a hand-constructed options object. No fix, and no test for an unreachable branch.
- **SG-004 — `BuildWindow`'s internal `Math.Clamp` vs the endpoint's deliberate `400`.** `BuildWindow` clamps an
  out-of-range `windowMinutes` while `EngineUsageService` rejects it outright, so the clamp is defence that no live
  path reaches. Raised in review and **consciously deferred** — the current shape is accepted. The behaviour that
  matters to a caller (no silent clamp; `400`, inclusive at both bounds) is pinned at both the HTTP layer and
  directly on the service.

> **Future consideration, deliberately NOT done here:** an index on `TelemetryEvents.EventType`. The panel
> re-scans the exercise's rows per read, so an index earns its place once 03c polls on an interval — but it is
> a schema change (Tier-2 human sign-off + a migration whose snapshot collides with any other migration in the
> same wave), so it belongs to a story that owns the schema, not to this behaviour-only edge.

### 03c (frontend edge) — as built

`src/frontend/src/features/controller/engine/`:
`hooks/useEngineUsage.ts` (+ `.test.ts`, `.mockContractConformance.test.ts`),
`services/liveEngineUsageActions.ts` (+ `.test.ts`),
`components/UsagePanel.tsx` (+ `.test.tsx`, `.providerUnavailable.test.tsx`);
mounted via `features/controller/components/ControllerConsole.tsx`
(+ `.usageTool.test.tsx`).

Gate-1 review (clean, 0 Critical, 5 Warnings — all five folded below, plus the cheap high-value
Suggestions) is captured here as the frozen `WR-00x`/`SG-00x` labels the fold used; they are local to
this 03c review round (independent of 03a's own `WR-`/`SG-` numbering above).

**AC1 — the provider statement reuses `GET /api/engine/settings`, never a second readout**
- `UsagePanel.test.tsx` — `UsagePanel — AC1: the provider statement is sourced ONLY from useEngineSettings()`
  (4 tests: no-cut / cut-posture / icon+text pairing / structurally distinct from the historical
  `byModel[].provider` rows, which may legitimately disagree with the live statement).
- **WR-004 (folded):** a FAILED `GET /api/engine/settings` leaves `useEngineSettings().settings` at
  `null` (only `error` is set) — silently omitting the provider line in that case would leave the
  historical `byModel` rows (which may name `Fake`) as the only provider information on the page,
  inviting exactly the inference-from-history AC1 exists to prevent. Fixed: an explicit
  "LIVE PROVIDER: unavailable (engine settings could not be read) — the rows below name the provider
  that produced each PAST call, not what is live now." statement, icon-paired (never colour alone),
  and NOT shown while settings is merely still loading (no false "unavailable"). Proven by the
  wholesale-mocked sibling file `UsagePanel.providerUnavailable.test.tsx` (4 tests) — a SEPARATE file
  from `UsagePanel.test.tsx` because `vi.mock('../hooks/useEngineSettings')` is file-scoped/hoisted
  and would otherwise break that file's tests against the real settings store (mirrors
  `EngineSettingsPanel.awaitThenApply.test.tsx`'s established convention).

**AC2 — volume: calls over time, by provider/model, token categories distinct, latency, guard mix**
- `UsagePanel.test.tsx` — `AC2: volume` (totals/tokens/latency; guard-result mix icon+text; "including
  the busiest (Fake) first").
- **WR-002 (folded, the one AC gap Gate-1 flagged as real, not polish):** `ModelVolumeRow` rendered
  totals/latency/guards per model but NEVER that model's own call-count-over-time series — so the
  shipped panel was (calls over time, aggregate) + (calls, NOT over time, by model), which does not
  satisfy "call counts over time broken down by provider and model". Fixed by refactoring
  `BucketSeries` to take `buckets`/`bucketMinutes` directly (not a whole `EngineUsageDto`) so it can
  render EITHER the aggregate series or one model's own `model.buckets` — every `ModelVolumeRow` now
  renders its own `<BucketSeries testId="usage-model-bucket-series">`, distinct per row and distinct
  from the aggregate `testId="usage-bucket-series"`. Proven by
  `UsagePanel.test.tsx`'s `WR-002: every model row renders its OWN call-count-over-time series, not
  just its totals` (asserts one per-model series PER row, distinct from the one aggregate series) and
  `WR-002: a model's own bucket-series detail sums to that model's OWN calls, not the window aggregate`;
  at the mock-data level, `useEngineUsage.test.ts`'s `every model buckets series sums to that model's
  own totals.calls (WR-002 — the per-model series is real, not decorative)`.

**AC3 — cost, config-sourced, explicit "unpriced" (never a silently-wrong $0)**
- `UsagePanel.test.tsx` — `AC3: cost is a separately labelled section` (6 tests: currency shown;
  unpriced renders "UNPRICED" never `$0`; the FLOOR label when `anyUnpriced`; no formatted currency
  figure at all in an unpriced row — the check that actually catches a fallback `$0` rather than a
  literal-`"$0"` string search that this format never produces; icon+text pairing; floor note absent
  when every model is priced).
- **WR-003 (folded — "the one thing AC3 forbids"):** `isWireModelCost` accepted `priced: true` with a
  `null` cost field (the type-level nullability existed for the UNPRICED case, but nothing coupled it
  to `priced`), so a backend regression or a partly-populated row would print a confident `0.00 USD`
  beside real token counts with no error anywhere — the wire boundary's OWN `?? 0` render fallback
  would silently paper over it. Fixed at the validator, not the renderer (the "pick one" option this
  finding offered): `isWireModelCost` now REJECTS the shape entirely — `priced: true` requires all
  five cost fields AND `rates` to be present numbers/object; `priced: false` requires all five to be
  EXACTLY `null` (never a stray number beside "unpriced"). A malformed row of either shape now throws
  `MalformedEngineUsageResponseError` rather than rendering. Proven by
  `liveEngineUsageActions.test.ts`'s `WR-003: priced and its cost fields are a COUPLED shape, never a
  partly-null "priced" row` (4 tests: accepts a fully-real priced row; throws on `priced:true` +
  `null inputCost`; throws on `priced:true` + missing `rates`; throws on `priced:false` + a stray
  non-null field). The renderer's `row.inputCost ?? 0` fallback is now unreachable dead code for any
  response that passed the validator — left in place as harmless defence, not the enforcement point.

**Isolation / staff-only / telemetry / scenario-time (AC4/AC5/AC6/"Telemetry")** — unchanged from the
original build; see the ACs above. Two folds specific to AC6:
- **SG-003 (folded):** the window label hardcoded the literal `'wall-clock'` instead of reading
  `usage.window.clock` — the field 03a added expressly so the panel STATES the clock rather than
  assuming it. Fixed; proven by `UsagePanel.test.tsx`'s `SG-003: reads the clock label FROM the
  response (window.clock), not a hardcoded literal`.
- **SG-005 (folded):** `formatWallClockTime` was time-of-day only, so the 1440-minute (24-hour) preset
  read as an identical `HH:MM:SS–HH:MM:SS` across a day boundary. Fixed: the window label now includes
  the date whenever `windowMinutes >= 1440`. Proven by `UsagePanel.test.tsx`'s `SG-005: includes the
  DATE in the window label once the window spans a full day`.

**AC7 — accessibility (NFR-001), guard mix and provider/unpriced states never colour-only**
Covered throughout the AC1/AC2/AC3 tests above (icon+text pairing asserted directly, e.g. `pairs the
provider-cut indicator with BOTH an icon and text`, `pairs the UNPRICED state with an icon`, `pairs the
"unavailable" statement with an icon`).
- **SG-007 (folded — a doc-comment overclaim, not a behaviour change):** the module header claimed the
  bucket-series numbers were "always also present as plain, readable text/rows", but the per-bucket
  breakdown sits inside a collapsed `<details>` — reachable, not pre-rendered as visible text. Reworded
  to state the AGGREGATE figures (calls/tokens/latency/guard mix) are always plain text, and the
  bucket-by-bucket counts are "reachable via a keyboard-operable disclosure" — WCAG 2.1 AA needs the
  information reachable, not necessarily pre-expanded. The `<summary>` copy itself now also says
  "reachable via disclosure" rather than "view exact counts", for the same honesty. No test change (a
  wording fix); `UsagePanel.test.tsx`'s existing bucket-detail tests already prove the information IS
  reachable via the `<details>`/`<summary>` element.

**AC8 — a read over the existing event log, honest about unreadable rows** — unchanged; see
`UsagePanel.test.tsx`'s `AC8: unattributed rows and unparseable events`.

**WR-001 (folded) — the scan fired on console mount, not on panel open.** `<UsagePanel>` is rendered
unconditionally by `ControllerConsole.tsx`, and hooks run before the component's own `if (!open) return
null` — so `useEngineUsage`'s mount effect issued `GET /api/engine/usage` for every controller-console
session whether or not USAGE was ever opened, then the (now-removed) open-transition `refresh()` effect
issued a SECOND read on first open. `GET /api/engine/usage` is the one endpoint in this story with no
`TelemetryEvents.EventType` index — a full re-scan per console page-load, forever, is the exact cost
this finding flags (`EngineSettingsPanel`'s equivalent mount-fetch is cheap/indexed and is unaffected).
Fixed by splitting the component: `<UsagePanel>` (outer, always mounted) owns only focus management and
open/close chrome; the data hooks (`useEngineUsage`/`useEngineSettings`) moved to a new child
`<UsagePanelBody>`, rendered ONLY while `open`. Mounting `UsagePanelBody` IS the "open" signal
`useEngineUsage`'s own mount-triggered `ensureStarted()` fires on — the separate "refetch on open
transition" effect was removed entirely rather than layered on top (which would have re-introduced the
double read on every open, not just the first). Net effect: exactly ONE scan, the first time USAGE is
ever opened per console session; a later reopen reuses the cached snapshot; the visible "Refresh"
button is the only way to force a new scan after that — a deliberate divergence from
`EngineSettingsPanel`'s own "refetch on every open" discipline, justified by the re-scan cost above (see
`useEngineUsage.ts`'s module header). Proven by `UsagePanel.test.tsx`'s
`WR-001: the usage scan is gated on OPEN, not on this component mounting` (2 tests: the store is
untouched while closed; it populates once opened) and the reachability suite
(`ControllerConsole.usageTool.test.tsx`) continuing to pass unmodified (the split is invisible to that
mount/open/close contract).

**SG-006 (folded) — the mock's window presets were data-identical (a live UAT bug-report risk).**
`buildMockEngineUsage`'s seeds were fixed absolute call/token counts regardless of `windowMinutes`, so
under `USE_MOCK_DATA=true` (UAT's own flag) clicking 1 min → 24 hr showed the identical 46 calls and
identical cost at every preset — only the bucket count changed. Given this repo's UAT history, an
operator would file that as "the window selector is broken". Fixed: every seed now carries a BASE
(60-minute) figure and is scaled by a `WINDOW_SCALE` factor per preset (calls floored at 1 whenever the
base is positive, so every seed — priced/unpriced/unattributed/re-roll — stays visible even at the
1-minute preset; the `Fake` row's tokens stay exactly `0` at every window, by construction). Guard-result
splits are now a FUNCTION of the scaled call count (not a fixed array), so
`sum(guardResults.calls) === totals.calls` holds exactly at every window, not just the original 60-minute
baseline. Proven by `useEngineUsage.test.ts`'s three `SG-006:` tests (calls/tokens strictly increase
across presets; every seed stays visible at the 1-minute preset; `Fake` stays token-zero at every
window) plus the pre-existing `useEngineUsage.mockContractConformance.test.ts` (unchanged, still green)
continuing to prove every scaled shape still passes the real wire validator.

**SG-001 (folded) — the mock's guard-result ordering matched the backend's `OrderByDescending(calls)
.ThenBy(result, Ordinal)` contract by accident, not by construction.** Both the aggregate and per-model
`guardResults` arrays were seed-insertion order. Fixed with a shared `sortGuardResults` comparator
(mirrors the `provider`/`model` comparator `orderModels` already applied to `byModel`), applied to both
arrays. Proven by `useEngineUsage.test.ts`'s two `SG-001:` tests (aggregate order + calls-descending/
ordinal tie-break; one model row's own guard results sorted the same way).

**SG-004 (folded) — no fixture ever exercised a REAL backend timestamp format.** The mock emits
`Date.toISOString()`; the live backend emits .NET round-trip `"O"` format
(`2033-09-04T13:00:00.0000000+00:00`). `formatWallClockTime`'s `Number.isNaN` fallback already made this
benign (V8's `Date` parser accepts the `"O"` format fine), but nothing proved it. Added
`UsagePanel.test.tsx`'s `SG-004: a REAL .NET round-trip ("O"-format) wall-clock timestamp parses to a
real time, never NaN/Invalid Date` — feeds an `"O"`-format string into the window label and a bucket
row via `engineUsageStore.setForTests`, asserts no `NaN`/`Invalid Date` text and the correct count.

**SG-008 (folded) — two doc-comments claimed more than the code does, a named repeat pattern on this
feature.** `liveEngineUsageActions.ts` carried a broken `{@link EngineUsageProviderQuestion}` (a symbol
that exists nowhere in the repo); reworded to plain prose pointing at `GET /api/engine/settings`/AC1.
`UsagePanel.tsx`'s module header claimed `alreadyFake` was read directly off `useEngineSettings()`'s
result, but the component only ever reads `effectiveProvider`/`provider`/`providerCutToFake` — removed
the false claim rather than adding unused behaviour to match it. Doc-only; no test (a doc-comment
correctness fix has no runtime assertion to add).

**SG-002 (recorded, no code change)** — the "four token categories never summed into one number"
protection (AC2) is `useEngineUsage.test.ts`'s mock using PAIRWISE-DISTINCT category values plus
`UsagePanel.test.tsx`'s per-`data-testid` assertions (`usage-tokens-input`/`-output`/`-cache-read`/
`-cache-creation`), which together make a summing regression print the SAME wrong number under four
different test ids and red all four — not the weaker "the fields are structurally distinct in the
type" argument. Recorded here per the fold instruction so this isn't re-litigated as a gap.

**Final gates (`C:/Code/pulse-wt-etu-03c/src/frontend`):** `npm run build:check` clean (0 errors);
`npm run lint` clean (0 warnings, 0 errors); `npm run test:run` — 214 test files passed (214), 2072
tests passed (2072), matching-or-beating the pre-fold 213-file/2051-test baseline by exactly the one new
file (`UsagePanel.providerUnavailable.test.tsx`) and 21 new tests this fold added, no regressions.
