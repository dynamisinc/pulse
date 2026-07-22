# Feature: Hashtags & trending

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.5
**World:** participant  ·  **Issue:** #87

## Summary
Hashtags parsed and linkified from post text, and a trending list derived **organically from actual
activity** (never manually declared) — with a controller boost-weight lever that biases weight but
never fabricates a trend.

## Requirements covered
SOC-040, SOC-041, SOC-042 (with XC-004, and E7 CTL-021 trend boost, E8 ADP-004 organic push).

## Design references
`docs/design/D1-social-app/`. Explore/Trending shows **varied category labels** ("Trending", "Public
safety · Trending", "Fairhaven · East side", "News · Newsline 7") (D1-R5) — never "official".

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Hashtags (parse / linkify / feed) | SOC-040 | Complete | #106 |
| 02 | Organic trending + controller boost-weight | SOC-041 | Not Started | #107 |
| 03 | Trending recompute (scoped, ≤60s) | SOC-042 | Not Started | #108 |

## Dependencies
posts (post text); E1 isolation/telemetry. E7 CTL-021 (boost-weight) + E8 ADP-004 (organic push) steer
it. Consumed by feeds-discovery (Explore), search.

## Design notes
Participant world. Trends are **always** rendered as organic — the controller boost-weight (E7) biases
input weight, logged as a steering action, never surfaced as anything but an organic trend (SOC-041).
