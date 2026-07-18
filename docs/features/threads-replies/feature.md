# Feature: Threads & replies

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.2
**World:** participant  ·  **Issue:** #84

## Summary
Branching reply threads rendered **X-style flattened** (D1-006 settled open question 1): ancestry
above the focused post, replies below. Includes the "agency responds to citizen" pattern and its
inverse (citizens piling onto official posts).

## Requirements covered
SOC-010, SOC-011, SOC-012.

## Design references
`docs/design/D1-social-app/` + `STORY-UPDATES.md`. **SOC-010/011 amended:** thread layout is
**flattened** (D1-006) — nested/indented rejected. Thread contains a takedown tombstone (D1-009) and
the impersonation call-out beat (D1-008).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Flattened thread view | SOC-010 / D1-006 | Complete | #98 |
| 02 | Reply counts & thread open | SOC-011 | Complete | #99 |
| 03 | Persona/participant replies (both directions) | SOC-012 | Not Started | #100 |

## Dependencies
posts (PostCard, tombstone); E1 isolation/scenario-time/telemetry. Consumed by feeds, notifications,
E7 monitoring.

## Design notes
Participant world. Flattened ancestry→focused→replies with "Replying to @handle" lines (D1-006).
Tombstones render in-thread only (posts SOC-005 / D1-009).
