# Feature: Ambient chatter

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.1
**World:** staff / backend  ·  **Issue:** #134

## Summary
Low-intensity background posting that keeps the world alive during lulls, using persona voice profiles
and scenario context. It fills the quiet-floor (`minBelievableActivity`, ADP-011) so the world never
flatlines between storyline beats, on the cheap Haiku tier so it doesn't dominate cost.

## Requirements covered
ADP-005 (ambient chatter). Consumes the storyline-model quiet floor (ADP-011), persona voice engine,
and the Haiku-tier model selection (engine-generation-infra).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §3.2 (Haiku tier for ambient bulk) and §6.2 (quiet floor).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Ambient background posting | ADP-005 | Not Started | #168 |

## Dependencies
`storyline-model` (quiet-floor signal, ADP-011), `persona-voice-engine` (voiced ambient posts),
`engine-generation-infra` (Haiku-tier selection), `reaction-loop` (generate/publish). E1 exercise
clock + persona backdated history (COR-023) for scenario continuity.

## Design notes
Staff/backend. Ambient chatter is the world's "resting heartbeat" — it keeps profiles feeling like
ongoing lives (consistent with pre-exercise backdated history, COR-023) rather than accounts that
only speak during a crisis. It respects the quiet floor (drives posting when below
`minBelievableActivity`) and the rate cap (never firehoses), and uses the Haiku tier for cost. A
single-story feature.
