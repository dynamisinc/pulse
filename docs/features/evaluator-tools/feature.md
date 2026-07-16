# Feature: Live evaluator tools — storyline board & annotation capture

**Epic:** E10 — Evaluation & AAR  ·  **Phase:** 4  ·  **Feature ref:** F10.3 Evaluator tools
**World:** staff  ·  **Issue:** —

## Summary
The evaluator's real-time situational-awareness surface — a full-width storyline board mirroring the
controller's CTL-030 board — plus fast, in-the-moment annotation capture and its bridge to Cadence
Observations.

## Requirements covered
EVL-020, EVL-021, EVL-022 · NFR-001 · INT-030 (Cadence push channel) · COR-018 (per-human
attribution reused from the timeline row renderer)

## Design references
`design/handoffs/evaluator-dashboard/DECISIONS.md` — **D6-001, D6-003**. D6-001 is explicitly an
inversion of **D5-019** (the controller console's storyline board, which was demoted to a badged
toolstrip flyout because the review queue is the console's decision surface): *"an evaluator has no
queue — the board IS the job."* D7-007 governs the shell furniture (toolstrip, header) this feature
registers its Annotations tool into. Reference DOM:
`design/handoffs/evaluator-dashboard/Evaluator Dashboard.dc.html` (`tiles`, `stream`, `annoOpenB`
popover, `annoFlyOpen` flyout).

> **Phasing note.** Authored ahead of the Phase 4 build gate (Master PRD §4), per the same rationale
> as `evaluation-timeline`/`evaluation-metrics`.

## Stories
| # | Story | Requirement(s) | Design | Status | Issue |
|---|---|---|---|---|---|
| 01 | Live storyline board | EVL-022, NFR-001 | D6-001 (+ D5-019 heritage) | Not Started | — |
| 02 | Live annotation capture (≤10s) | EVL-020 | D6-003 | Not Started | — |
| 03 | Annotation push to Cadence | EVL-021 | D6-003 | Not Started | — |

## Dependencies
`evaluation-timeline` (tile-click → Timeline pre-filter deep link; the live stream shares its row
renderer with Timeline's rows); `evaluation-metrics` (the intensity/latency/concern/sentiment figures
the tiles summarize, including story 04's pre-E8 fallback); the Cadence `INT-030` channel (E9
ecosystem integration) as the push destination — if E9 isn't linked for an exercise, the push action
is absent, not disabled, matching the read-only-affordance pattern used elsewhere.

## Design notes
Staff, and — unlike the controller console — this is the evaluator's **primary** surface: there is no
decision queue competing for eye-top space, so the storyline board gets full-width prominence at the
top of the Live view (D6-001's direct inversion of D5-019). NFR-001 is central: state is word + shape
+ color, never color alone (the D5-009 heritage rule, applied here too). Annotation capture is a
measured ≤10-second interaction — a hard usability budget, not a suggestion — because it is the
"Cadence-photo-capture philosophy applied to the info environment": judgment captured in the moment
or it's lost.
