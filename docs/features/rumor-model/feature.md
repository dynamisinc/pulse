# Feature: Rumor model

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (**v1.1** fast-follow)  ·  **Feature ref:** F8.4
**World:** staff / backend  ·  **Issue:** #138
**Status:** feature.md stub — v1.1 fast-follow; decompose when F8.4 lands. **Schema slot reserved in v1.**

## Summary
Misinformation mechanics: the rumor object (a false claim with a mutation budget + spread profile),
its propagation, counter-detection, and full lineage — the **data model** behind the D5 rumor-tracker
console (#8) and E10's misinformation-containment metrics. Ships **v1.1**, but the object model is
**designed now** (architecture §10.1) so v1 schemas don't preclude it.

## Requirements covered
ADP-030 (seed + propagate a rumor object), ADP-031 (counter-detection + crowd-correction), ADP-032
(full lineage for E10), ADP-033 (advanced disinfo out of baseline; model must not preclude it).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §10 (rumor object model + mechanics). D8 rumor-model spike
(adversarial review). `docs/features/rumor-tracker/feature.md` (#8) — the **console surface** that
consumes this data model (SEEDED→SPREADING→COUNTERED→DEAD lifecycle, reach/mutation/countered-by,
"Draft counter as…"). This feature is the mechanics; rumor-tracker is the UI.

## Stories (planned — v1.1; do not build until F8.4)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Rumor object + lifecycle (SEEDED→SPREADING→COUNTERED→DEAD) | ADP-030 | Not Started | — |
| 02 | Propagation — mutation-budget-bounded variants + spread profile | ADP-030 | Not Started | — |
| 03 | Counter-detection + crowd-correction on matched official response | ADP-031 | Not Started | — |
| 04 | Full lineage capture for E10 | ADP-032 | Not Started | — |

## Dependencies
`amplification-engine` (v1 — quote-post is the mutation/spread vector; reserves `mutationOf`),
`storyline-model` (v1 — rumors ride storylines; reserves `rumorRefs`), `response-reaction` (v1 —
counter-detection reuses match confirmation), `persona-voice-engine` (helper crowd-correction, troll
seeding), rumor-tracker (#8, the console), E10 (containment metrics consume lineage).

## Design notes
Staff/backend. **Schema-now dependency ON the v1 features:** the v1 `posts` / `amplification` /
`storyline` schemas must reserve `rumorRef` + `mutationOf` + `storyline.rumorRefs` (architecture
§10.1/§14) so v1.1 needs no migration — this is a v1 obligation, not a v1.1 one. The rumor object:
`{falseClaim, seedPersonas, mutationBudget (bounded so it can't drift into nonsense), spreadProfile
(velocity + reach ceiling, tied to SOC-054), storylineRef, lineage[], state}`. Counter-detection
reuses the response-reaction match confirmation; crowd-correction uses helper personas (ADP-022).
Advanced disinformation (coordinated campaigns, manipulated media) is **out of baseline** (ADP-033) —
the object model must not preclude it, but it is not built here.
