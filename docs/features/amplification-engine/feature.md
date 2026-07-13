# Feature: Amplification engine

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.1
**World:** staff / backend  ·  **Issue:** #133

## Summary
How content *spreads*: engine personas repost, quote, and react to make selected content propagate
believably, with velocity shaped by storyline intensity and audience magnitude (SOC-054). This is
also how trends (SOC-041) get organically pushed — the engine biases weight, never fabricates a
trend. Quote-post is the misinformation-mutation vector the v1.1 rumor model will ride on.

## Requirements covered
ADP-004 (amplification simulation). Consumes the E2 amplification substrate (repost/quote, #85),
SOC-054 audience magnitude, and SOC-041 organic trending. Feeds E10 spread metrics.

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §6.2 (intensity bent up by amplification) and §10 (quote-post
as the v1.1 rumor vector). `docs/features/amplification/` (E2 #85, the substrate). `docs/features/hashtags-trending/` (SOC-041).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Engine repost / quote / react to spread | ADP-004 | Not Started | #166 |
| 02 | Spread velocity + organic trend push | ADP-004 / SOC-054 / SOC-041 | Not Started | #167 |

## Dependencies
`reaction-loop` (decide/generate), `storyline-model` (intensity drives velocity), `persona-voice-engine`
(quote-post voice), E2 amplification (#85, the repost/quote mechanics), SOC-054 audience magnitude,
hashtags-trending (SOC-041, controller boost-weight). Feeds E10 spread + rumor-model (v1.1).

## Design notes
Staff/backend. Amplification uses the **same E2 repost/quote substrate as any post** (#85) — the
engine doesn't invent a parallel spread mechanism, it drives the real one. Velocity is shaped by
storyline intensity + SOC-054 audience magnitude. Trends stay **organic** (SOC-041): the engine
biases input weight (logged as a steering action), never fabricates a trend. Quote-post is
deliberately the mutation vector the v1.1 rumor model activates.
