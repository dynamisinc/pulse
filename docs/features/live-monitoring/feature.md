# Feature: Live monitoring

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** F7.4
**World:** staff  ·  **Issue:** #6  ·  **Status:** feature.md stub — decompose before build

## Summary
The controller's situational awareness: a live participant-activity board, TweetDeck-style watchlist
columns, expected-action tracking, and the **queue-pressure meter** that keeps the workload honest.

## Requirements covered
CTL-030, CTL-031, CTL-032, CTL-034. **CTL-033 (evaluator read-only variant) is BACKLOG per D5** —
steering controls **absent, not disabled** — captured as a later story, not built this pass.

## Design references
`STORY-UPDATES.md`. **CTL-034 is amended** (D5-014/2.7, D5-003): the visible metric is a
**queue-pressure meter** = decisions **demanded** per minute over a rolling 60s window, budget **≤6**,
amber past 6, tooltip states it is **demand, not a controller-performance measure**. Staff-performance
surveillance is explicitly rejected — author story 04 accordingly. Counts across surfaces must agree
(D5-014/2.1, RECONCILE). **Session-3 cross-surface reconciliation (R-001…R-004,
`docs/design/DECISIONS.md` §"R — Cross-surface reconciliation"):** console post cards mirror the participant
anatomy — canonical scallop seal `#2D9CDB`, engagement order reply · repost · like, duotone/monogram
avatars — plus the always-visible staff origin line `{origin} · FIRED {scenario time}` (R-003).
Demo/mock data stays **per-surface** (R-005): the D1 and D5 casts are intentionally separate; do not
assume or build a shared cast module.

## Stories (planned)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Monitoring board — live activity stream, filter by participant/org/channel | CTL-030 | Not Started | #30 |
| 02 | Watchlist columns (hashtag / rumor thread / persona) | CTL-031 | Not Started | #31 |
| 03 | Expected-action tracking — fired-vs-responded at a glance | CTL-032 | Not Started | #32 |
| 04 | Queue-pressure meter (demand ≤6/min, not performance) | CTL-034 / D5-014/2.7 | Not Started | #33 |
| — | Evaluator read-only monitoring variant *(backlog — steering absent)* | CTL-033 | Not Started | — |

## Dependencies
E2 activity/telemetry stream (XC-004) for the board and columns; E1 exercise-context; the SignalR
real-time host; inject-queue (CTL-032 reads fired state) and engine-review-cockpit (decisions-demanded
feeds the meter). CTL-033 depends on the Evaluator role surface (COR-013).

## Design notes
Staff world (COBRA), column-based, dense, keyboard-friendly. CTL-030 is **operational awareness, not
scoring** (evaluation analytics are E10). The queue-pressure meter is a design budget and an
acceptance criterion for E7+E8 together (CTL-034) — if a design pushes sustained demand past ~6/min,
the design is wrong.
