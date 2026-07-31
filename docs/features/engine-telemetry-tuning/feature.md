# Feature: Engine telemetry & tuning

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.5
**World:** staff / backend  ·  **Issue:** #136

## Summary
Every engine action logged with its trigger and storyline, extending the XC-004 v0 event schema, plus
the surface that exposes those actions for post-exercise tuning and feeds E10. This is what lets the
AAR explain *why the world turned* — the sentiment/intensity arc rendered with dial-input overlays so
a hotwash separates designed pressure from participant-driven pressure. A third, narrower story
(03) adds the **live-ops** counterpart: a controller/admin panel on current AI generation volume (and,
second, cost) — what the engine is calling, on which provider/model, right now — distinct from story
02's post-exercise tuning arc.

## Requirements covered
ADP-041 (every engine action logged with trigger + storyline for E10 and tuning). Extends the XC-004
v0 telemetry schema (the shared taxonomy E10 metrics + E9's INT-031 stream + E8 all consume).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §11 (telemetry, observability & tuning; the engine event-type
table). EVL-014 (dial-input overlays). Master PRD XC-004 (the v0 schema this extends).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Engine event types (extend XC-004) | ADP-041 / XC-004 | In Progress | #173 |
| 02 | Tuning & observability surface | ADP-041 | Not Started | #174 |
| 03 | AI generation usage panel | ADP-041 | Not Started | #401 |

## Dependencies
The XC-004 v0 telemetry emitter (E1); every E8 feature emits through it (reaction-loop, storyline-model,
response-reaction, autonomy-safety, amplification-engine, **and now `engine-runtime`** — stories 01
(`engine.observed/decided/generated/published/measured` + `storyline.state_changed`) and 02
(`engine.reviewed`, incl. hold-on-expiry / auto-send) both emit against the extension this feature's
story 01 (#173) defines); E10 consumes it (with EVL-014 overlays); E9's INT-031 stream shares the
taxonomy.

**Foundation dependency — sequencing decided (2026-07-21): schema-first.** `engine-runtime` is authored
(Phase B3, Not Started) with its emissions specified against the engine event-type table (E8 arch §11);
this feature's story 01 (#173) is the schema extension those emissions target and is **also Not
Started**. Decision: story 01 (#173) lands **first**, as `engine-runtime`'s Wave-0 seam-freeze (the way
B1 froze `ParticipantPostDto`/`IFeedBroadcaster` ahead of its fan-out), so `engine-runtime` 01/02 emit
against a settled v0 envelope rather than co-evolving it — a hard prerequisite for the `engine-runtime`
fan-out (`engine-runtime/implementation.md` open question (d), decided).

## Design notes
Staff/backend. A **schema mistake is a cross-phase migration** (adversarial review D2) — the engine
event types must fit the XC-004 v0 taxonomy, not fork it. Every event carries wall + scenario time,
actor (incl. the human behind a shared org account, COR-018), and channel. Sentiment/intensity arcs
render with dial-input overlays (EVL-014) so the AAR is defensible in a hotwash (no sentiment
circularity).

Story 03 (usage panel) is a **read view** over the same `engine.generated` event, not a second
taxonomy or store — it must query/project the existing `TelemetryEvents` rows behind the
`IExerciseScoped`/`PulseDbContext` isolation guarantee, and both of its formerly-open decisions are
now settled (see `03-ai-usage-panel.md` Technical Notes for the full reasoning):

- **Aggregation mechanics: app-layer projection, ratified.** Query `TelemetryEvent` as entities (so
  the central query filter applies), project `Payload`/`WallClockTime` only, deserialize into the
  emitter's own `EngineEventPayloads.Generated`, aggregate in a pure function. SQL-side
  `OPENJSON`/`JSON_VALUE` was rejected — measured UAT volume (1,722 rows, ~236 bytes/payload) shows
  neither shape avoids a table scan (`TelemetryEvents` has no `EventType` index), so the decision
  turned on contract fidelity and — decisively — isolation: aggregate SQL bypasses the EF query
  pipeline the central filter enforces.
- **Price table: config-sourced, ratified.** An `appsettings` section keyed by provider+model, never
  a hardcoded switch, because Foundry deployments here use `OnceNewDefaultVersionAvailable` (not
  version-pinned) and pricing can drift under a model name with no code change.

Volume (calls, tokens by category, latency, guard-result mix) is committed scope; cost is a second,
clearly-separated section priced from that table and degrades to an explicit "unpriced" state rather
than a silently-wrong $0. Verified this session: UAT runs the `Fake` provider (zero LLM egress, 0
tokens, 1,722 `engine.generated` rows) — cost correctly reads $0 today (the `Fake` provider is
zero-token by construction) and becomes meaningful once a live provider is configured; the panel is
the pre-flight verification surface for `PROVIDER-GOVERNANCE.md` §8. §8's provisioning-half
infrastructure blocker is now fixed and validated (PR #404: the SQL Entra admin resource made
idempotent), so the App Service carries its managed identity and all eleven `Generation__*` settings
(`Provider = Fake`) — §8's human sign-off itself remains unticked and is out of this story's scope;
treat it as signed for planning purposes only, per Tom's instruction, not as an actual sign-off.

Story 03 is decomposed into three build edges in `implementation.md`'s Wave Plan — two backend edges
(usage read API, price table/cost rollup) that can run in parallel with each other, then a frontend
panel edge that is strictly serial after both (no codegen; the endpoint/DTO shape is the seam) — it is
prep-complete and build-ready, though still **Not Started**.
