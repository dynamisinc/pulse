# Story: Engine event types (extend XC-004)

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-041, XC-004  ·  **Design decisions:** none  ·  **Issue:** #173

## Context
Every engine action is logged with its trigger and storyline (ADP-041), extending the XC-004 v0 event
schema — **not** forking it (a schema mistake is a cross-phase migration, adversarial review D2). The
engine event types (architecture §11): `engine.observed`, `engine.decided`, `engine.generated`,
`engine.reviewed`, `engine.published`, `engine.measured`, and `storyline.state_changed` (plus the
v1.1 `rumor.*` family, reserved). Each carries wall + scenario time, actor, channel.

## Acceptance Criteria
- [ ] Given each engine loop stage/action, when it occurs, then it emits the corresponding event type
      (`engine.observed`/`decided`/`generated`/`reviewed`/`published`/`measured`,
      `storyline.state_changed`) carrying its **trigger** and **storyline** (ADP-041).
- [ ] Given any engine event, when emitted, then it carries wall-clock + **scenario** time, actor
      (incl. the human behind a shared org account, COR-018), and channel — per the XC-004 v0 schema.
- [ ] Given the XC-004 v0 taxonomy, when engine events are defined, then they **extend** it (shared
      envelope, additive event types) so E10 metrics + E9's INT-031 stream consume them without a
      migration.
- [ ] Given `engine.reviewed`, when a review action occurs, then the action is captured
      (approve / edit / veto / re-roll / **hold-on-expiry** / auto-send) with the actor.
- [ ] Given v1.1 rumor work, when the schema is defined, then the `rumor.*` event family + the
      `rumorRef`/`mutationOf` lineage fields are **reserved** so v1.1 needs no migration.
- [ ] Events are **staff/evaluator-facing** (XC-002); exercise-scoped (COR-001).

## Out of Scope
The tuning/observability surface that renders them (story 02); E10's metric computation (E10); the
XC-004 v0 base schema definition itself (E1 owns it — this story *extends* it); the rumor mechanics
(rumor-model, v1.1 — this reserves their event slots).

## Technical Notes
Staff/backend. Additive event types on the XC-004 envelope; emitted by every E8 feature via the shared
telemetry emitter. Reserve `rumor.*` + lineage fields now (architecture §10.1/§14 schema-now note).
See implementation.md (story 01) and architecture §11.

## Dependencies
E1 XC-004 v0 emitter (base schema); every E8 feature (emits these); E10 + E9 INT-031 (consumers).

## Tests
- Unit: each engine action emits its event type with trigger + storyline + wall & scenario time +
  actor + channel.
- Unit: event types validate against the XC-004 v0 envelope; `rumor.*` + lineage fields reserved.
