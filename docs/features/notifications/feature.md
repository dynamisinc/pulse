# Feature: Notifications

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.8
**World:** participant  ·  **Issue:** #90

## Summary
The notification center + badge, aggregation under load (a training lever), and the platform-alert path
that absorbs the RIP-Alerts role — in pilot mode the sole cross-channel alert delivery until the portal
alert bar (E3) lands.

## Requirements covered
SOC-070, SOC-071, SOC-072 (with NFR-002 burst, NFR-001 accessibility, PRT-010 as the E3 successor).

## Design references
`docs/design/D1-social-app/` + `STORY-UPDATES.md`. **SOC-070/071 amended (D1-005):** notifications
**aggregate** under load ("Newsline 7 and 41 others…") with a one-line "grouped" notice; typed symbols
(♥ like / ⇄ repost / @ mention / + follow); bell badge 3/5/99+ (D1-R5). Alert delivery previews the
PRT-010 advisory bar (E3) but in pilot mode is SOC-072 platform notifications.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Notification center & badge (typed) | SOC-070 / D1-R5 | Not Started | #117 |
| 02 | Aggregation under load (training lever) | SOC-071 / D1-005 | Not Started | #118 |
| 03 | Platform-alert notifications (RIP-Alerts) | SOC-072 | Not Started | #119 |

## Dependencies
posts/threads/amplification/reactions/follows/DMs (notification sources); E1 telemetry; E7 (flag as
alert, CTL-021). Alert bar successor is E3 PRT-010 (Phase 3).

## Design notes
Participant world. Aggregation keeps the center legible under notification storms (SOC-071, NFR-002).
Severity conveyed by text+icon, never color alone (NFR-001). Observer mode: pill/notifications inert
(D1-011).
