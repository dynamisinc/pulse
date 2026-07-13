# Feature: Storyline model

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.2
**World:** staff / backend  ·  **Issue:** #129

## Summary
The engine's unit of narrative and the state it tracks: the storyline object (intensity, sentiment,
phase, expectation, cast, hashtags, curve, target) and its state machine; continuous intensity +
sentiment tracking; named escalation curves; per-exercise rate caps + quiet floors; and the loop that
drives actual intensity toward the controller-set dial target (CTL-022 / #25). Storylines are
planner- or controller-created; automatic detection from activity is deferred post-v1.

## Requirements covered
ADP-010 (escalation profiles), ADP-011 (rate caps + quiet floors), ADP-012 (sentiment tracking),
CTL-022 (escalation dial — the engine-follows-target half; the dial UI is world-steering #25).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §1.1 (storyline object + scales), §6 (state machine,
escalation, intensity/sentiment, rate governance). D5-014/2.2 (CTL-022 actual+target).
`docs/features/world-steering/02-escalation-dial.md` (#25) is the console control this feeds.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Storyline object + state machine | ADP-010 (state) | Not Started | #152 |
| 02 | Intensity + sentiment tracking | ADP-012 | Not Started | #153 |
| 03 | Escalation curves (Slow burn / Standard / Flash panic) | ADP-010 | Not Started | #154 |
| 04 | Rate caps + quiet floors | ADP-011 | Not Started | #155 |
| 05 | Dial-target follow loop | CTL-022 | Not Started | #156 |

## Dependencies
E1 exercise clock (COR-050/051, scenario time); persona-management (participatingPersonas, SOC-054);
world-steering escalation dial (#25) sets the target this feature follows; reaction-loop consumes the
state; engine-telemetry-tuning logs state changes; E10 + EVL-014 consume sentiment with dial overlays.

## Design notes
Staff/backend. **Canonical intensity is 0–100** (the epic's "0–10" is the planner's coarse label; the
D5 dial needs resolution for actual-fill + target-tick, D5-014/2.2). Sentiment is continuous −1…+1
(ADP-012), exposed to E7/E10 with **dial-input overlays** (EVL-014) so the AAR separates dialed-in
mood from participant-driven mood. Rate caps + quiet floors (ADP-011) keep the world between firehose
and flatline. The `rumorRefs` slot is reserved now for v1.1 (rumor-model) so no later migration.
