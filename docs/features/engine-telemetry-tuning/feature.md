# Feature: Engine telemetry & tuning

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.5
**World:** staff / backend  ·  **Issue:** #136

## Summary
Every engine action logged with its trigger and storyline, extending the XC-004 v0 event schema, plus
the surface that exposes those actions for post-exercise tuning and feeds E10. This is what lets the
AAR explain *why the world turned* — the sentiment/intensity arc rendered with dial-input overlays so
a hotwash separates designed pressure from participant-driven pressure.

## Requirements covered
ADP-041 (every engine action logged with trigger + storyline for E10 and tuning). Extends the XC-004
v0 telemetry schema (the shared taxonomy E10 metrics + E9's INT-031 stream + E8 all consume).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §11 (telemetry, observability & tuning; the engine event-type
table). EVL-014 (dial-input overlays). Master PRD XC-004 (the v0 schema this extends).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Engine event types (extend XC-004) | ADP-041 / XC-004 | Not Started | #173 |
| 02 | Tuning & observability surface | ADP-041 | Not Started | #174 |

## Dependencies
The XC-004 v0 telemetry emitter (E1); every E8 feature emits through it (reaction-loop, storyline-model,
response-reaction, autonomy-safety, amplification-engine); E10 consumes it (with EVL-014 overlays);
E9's INT-031 stream shares the taxonomy.

## Design notes
Staff/backend. A **schema mistake is a cross-phase migration** (adversarial review D2) — the engine
event types must fit the XC-004 v0 taxonomy, not fork it. Every event carries wall + scenario time,
actor (incl. the human behind a shared org account, COR-018), and channel. Sentiment/intensity arcs
render with dial-input overlays (EVL-014) so the AAR is defensible in a hotwash (no sentiment
circularity).
