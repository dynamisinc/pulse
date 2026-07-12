# Feature: Direct messages

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.7
**World:** participant  ·  **Issue:** #89

## Summary
1:1 direct messages — citizen tips to officials, participant coordination, and targeted
misinformation/social-engineering vectors — observable to evaluators/controllers per exercise ground
rules.

## Requirements covered
SOC-060, SOC-061, SOC-062 (with NFR-007 disclosure, XC-004 telemetry, XC-002 observability).

## Design references
`docs/design/D1-social-app/`. Featured DM beat: the Newsline 7 reporter verification exchange
(two-pane, 952px; own bubbles accent). Group DMs are stretch; other conversations static in the mockup.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | 1:1 direct messages | SOC-060 | Not Started | #114 |
| 02 | DM use cases (tips / coordination / vectors) | SOC-061 | Not Started | #115 |
| 03 | DM observability (evaluators/controllers) | SOC-062 / NFR-007 | Not Started | #116 |

## Dependencies
E1 isolation, telemetry, org grants (post-as-org DMs, COR-018). Consumed by E7 monitoring, E10.

## Design notes
Participant world, two-pane. DMs are visible to staff (SOC-062) — participants are told observability
applies via the product-supplied exercise ground-rules boilerplate (NFR-007). Observer mode hides the
DM input (D1-011).
