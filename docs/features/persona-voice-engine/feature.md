# Feature: Persona voice engine

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.3
**World:** staff / backend  ·  **Issue:** #128

## Summary
The believability core: how one persona stays *consistent* across an exercise while personas stay
*diverse* across a burst. Voice consistency comes from the COR-020 dossier + style params + prior-post
conditioning; diversity comes from generating a burst in one call so personas differentiate, enforced
by an n-gram/style acceptance gate that re-rolls a converged burst before a human ever sees it.
Persona type governs behavior, and bad-actor personas participate only when the scenario enables them.

## Requirements covered
ADP-020 (per-persona voice consistency), ADP-021 (cross-persona diversity + diversity checks in
acceptance criteria), ADP-022 (persona type governs behavior; bad-actor gating). Consumes COR-020
voice notes and SOC-054 audience magnitude.

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §5 (persona voice engine + the believable+diverse acceptance
metric). Prototype metrics: `spikes/e8-generation-loop/metrics.mjs` (`maxPairwiseOverlap`,
`distinct2`, `personaDistinctiveness`).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Voice consistency — dossier + prior-post conditioning | ADP-020 | Complete | #148 |
| 02 | Cross-persona diversity — burst generation + thresholds | ADP-021 | Complete | #149 |
| 03 | Persona-type behavior + bad-actor gating | ADP-022 | Complete | #150 |
| 04 | The believable + diverse acceptance metric | ADP-021 | Complete | #151 |

**Delivered** as the pure-backend `Pulse.Core/Features/PersonaVoice/*` slice (see its `README.md`):
`VoiceProfileBuilder` (consistency + `ToDossier` projection), `PersonaCasting` (type behavior + bad-actor
gate), `StyleConformance` + `BurstAcceptancePolicy` (the believable+diverse gate over the merged
`VoiceMetrics`, with bounded re-roll → drop). Builds on `Generation.Models` + `EngineEval.VoiceMetrics`
read-only; no E2/E7 dependency. The believable+diverse metric is shared with `engine-eval-harness` (#175).

## Dependencies
`engine-generation-infra` (prompt assembly + provider); persona-management (COR-020 dossiers, persona
type, SOC-054 audience band); the persona's own post history (E2). Consumed by every reactive-behavior
feature (silence-escalation, response-reaction, amplification-engine, ambient-chatter).

## Design notes
Staff/backend. Believability is only as good as the COR-020 voice notes (a Phase-1-critical asset).
Diversity is an **acceptance gate**, not a hope: a converged burst *fails the build* and is re-rolled.
The metric is prototyped and self-validated in the spike (it failed a deliberately-blended burst and
passed a clean one). Persona-type behavior keeps outlets/agencies/trolls/helpers distinct; bad-actor
personas are gated by scenario enablement (ADP-022), never a default.
