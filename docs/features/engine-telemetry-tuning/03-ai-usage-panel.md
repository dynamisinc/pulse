# Story: AI generation usage panel

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
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
- [ ] **Given** the usage panel needs to make the active provider unambiguous within the usage
      context, **when** it states which provider the volume/cost data below belongs to, **then** it
      reuses the existing `GET /api/engine/settings` `provider` value (already surfaced in
      `EngineSettingsPanel.tsx`) rather than deriving a second, independently-computed provider
      readout — two staff surfaces disagreeing about which provider is live would be worse than one
      surface stating it once.
- [ ] **Given** the exercise's `engine.generated` events, **when** the panel renders volume, **then**
      it shows call counts over time broken down by provider and model, with tokens split into input,
      output, cache-read, and cache-creation (priced differently, kept distinct), latency, and the
      guard-result mix (a re-roll is a call that cost money and produced nothing, so it's counted, not
      dropped).
- [ ] **Given** the same event data, **when** the panel renders cost (a separately labeled section from
      volume), **then** it prices tokens against a per-model price table sourced from config (never
      hardcoded, since Foundry deployments in this repo are not version-pinned and pricing drifts); a
      model with no price-table entry shows its token counts with an explicit "unpriced" state, never a
      silently-wrong $0. (Note: the `Fake` provider reports 0 tokens by construction, so cost correctly
      reads $0 pre-flip — that is not this AC's failure case.)
- [ ] **Isolation (XC-001/COR-001):** the panel shows only the calling controller's own exercise's
      usage; a cross-exercise request for another exercise's usage returns 403/404.
- [ ] **Two worlds (XC-002/D0 §2):** staff surface — COBRA theme (`@/theme/styledComponents`), lives
      under the controller console route tree, never rendered on or leaking into a participant path
      (SOC-003 — participants never see engine call volume, cost, or provider identity).
- [ ] **Scenario time (COR-053):** the panel is staff-only so wall-clock is permitted and is in fact the
      more useful axis for a live ops question ("what did the engine spend in the last 10 minutes of
      real time") — the panel labels its time axis explicitly as wall-clock, not scenario time, so a
      reader is never left guessing which clock they're looking at.
- [ ] **Accessibility (NFR-001):** WCAG 2.1 AA; the provider state and guard-result mix are never
      color-only (e.g. an icon/text label alongside any red/amber/green usage or guard-failure cue).
- [ ] **Telemetry (XC-004):** the panel is a read/view over the existing `engine.generated` event log
      (story 01's extension of the v0 schema) — it introduces no parallel event taxonomy and no second
      store; it queries or projects the existing `TelemetryEvents` rows.

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

See `implementation.md` for the reuse map and Wave Plan rows (`stack: backend` × 2 — 03a usage read
API, 03b price table/cost rollup, can-run-with each other in wave 3 — then `stack: frontend` 03c, wave
4, strictly serial after both) and the composition-root integration-seam note — this story adds the
first telemetry *read* endpoint in `Pulse.WebApi`, which needs a `WebApplicationFactory<Program>`
composition-root route guard, not just slice-level TestServer coverage.

**Open design question (flagged, not decided by this story):** whether the read API is a new query
endpoint on the existing `EngineRuntime` slice (alongside `EngineReviewEndpoints.cs`) or a new
`Telemetry` read slice is an implementation call for whoever builds this. Either way it must respect
the `IExerciseScoped` / `PulseDbContext` central query-filter isolation guarantee
(`src/Pulse.WebApi/Data/Entities/TelemetryEvent.cs:20`) — no bespoke exercise-scoping logic.

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
