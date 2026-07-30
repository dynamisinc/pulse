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
templated content on a provider that costs nothing and calls nothing external. This is why this
story's cost view correctly reads $0 pre-flip, and why this panel is also the pre-flight verification
surface for `docs/features/engine-runtime/PROVIDER-GOVERNANCE.md` §8 (currently unsigned) — before
flipping a live provider on, someone needs to look at this panel's volume/cost view and see "0 calls,
$0" turn into "N calls, $Y" and know that's the expected transition, not a surprise.

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

**Open design question (flagged, not decided by this story):** whether the read API is a new query
endpoint on the existing `EngineRuntime` slice (alongside `EngineReviewEndpoints.cs`) or a new
`Telemetry` read slice is an implementation call for whoever builds this. Either way it must respect
the `IExerciseScoped` / `PulseDbContext` central query-filter isolation guarantee
(`src/Pulse.WebApi/Data/Entities/TelemetryEvent.cs:20`) — no bespoke exercise-scoping logic.

The harder open question is aggregation mechanics: `TelemetryEvent.Payload` is an opaque
`nvarchar(max)` JSON string the server "never parses" today
(`src/Pulse.WebApi/Data/Entities/TelemetryEvent.cs:73-77`, by design per the v0 envelope contract).
Rolling up `tokenUsage` across thousands of rows means either (a) JSON-querying the payload in SQL
(`OPENJSON`/`JSON_VALUE`), which is new territory for this codebase, or (b) reading rows and
projecting/aggregating in the application layer, which is simpler but doesn't scale past an
exercise-sized row count without care. Whoever builds this should pick one deliberately and note the
tradeoff — this story does not decide it.

Price table: config-sourced (e.g. `appsettings` section or a small seeded table keyed by
provider+model), not a hardcoded switch statement, because Foundry deployments in
`infrastructure/parameters/uat.bicepparam` use `versionUpgradeOption:
'OnceNewDefaultVersionAvailable'` (not version-pinned) — pricing for a given model name can change
under the deployment without a code change accompanying it.

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
