# Feature: Amplification (reposts & quotes)

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.3
**World:** participant  ·  **Issue:** #85

## Summary
Repost and quote-post — how content spreads and how misinformation mutates. Counts are queryable and
the full amplification chain is reconstructable from telemetry (the raw material for E10's
misinformation-containment metrics and E8's spread mechanics).

## Requirements covered
SOC-020, SOC-021, SOC-022 (with XC-004 telemetry, SOC-054 audience magnitude for spread).

## Design references
`docs/design/D1-social-app/`. Content beat to preserve: a rumor post outpacing the official (640 vs
298 reposts) — coherent tension (D1-R4).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Repost & quote-post | SOC-020 | Not Started | #101 |
| 02 | Amplification counts (queryable) | SOC-021 | Not Started | #102 |
| 03 | Amplification chain reconstruction | SOC-022 | Not Started | #103 |

## Dependencies
posts (PostCard); E1 telemetry (XC-004), audience magnitude (SOC-054). Feeds E8 amplification (ADP-004)
and E10 spread metrics.

## Design notes
Participant world. Quote-post is the misinformation-mutation vector (a core E8 mechanic). Every
spread event is telemetry so the chain (who spread it, when, in what order) is fully reconstructable.
