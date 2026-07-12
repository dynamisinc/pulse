# Feature: Reactions

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.4
**World:** participant  ·  **Issue:** #86

## Summary
Likes (baseline) and an optional per-exercise sentiment-carrying reaction set that aggregates into the
public-mood signal consumed by E8 and E10 — while staying, to participants, an ordinary reaction picker.

## Requirements covered
SOC-030, SOC-031 (with XC-004 telemetry, feeds E8/E10 mood signal).

## Design references
`docs/design/D1-social-app/`. Notification hue for likes `#e0245e` (D1 tokens) — a display detail, not
a trust signal.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Like with count | SOC-030 | Not Started | #104 |
| 02 | Sentiment reaction set (per-exercise) | SOC-031 | Not Started | #105 |

## Dependencies
posts (PostCard); E1 telemetry (XC-004). Feeds E8 (mood input) and E10 (sentiment metrics EVL-014).

## Design notes
Participant world. When the sentiment set is enabled, the participant-facing presentation must be
**indistinguishable from a normal reaction picker** (SOC-031) — the analytical meaning lives only in
staff/telemetry.
