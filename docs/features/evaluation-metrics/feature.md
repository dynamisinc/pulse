# Feature: Response, coverage, reach & sentiment metrics

**Epic:** E10 — Evaluation & AAR  ·  **Phase:** 4  ·  **Feature ref:** F10.2 Response metrics
**World:** staff  ·  **Issue:** —

## Summary
The evaluator's quantified evidence layer over the timeline: response latency (including
off-platform responses), coverage of public concerns with a confirm-before-AAR workflow, reach &
sentiment with the controller-dial defensibility overlay, and honest degradation when an exercise
ran without the adaptive engine. Misinformation-spread visualization is explicitly deferred pending
a metrics-v2 design pass.

## Requirements covered
EVL-010, EVL-011, EVL-012, EVL-013 (deferred), EVL-014, EVL-015 · CTL-026 (off-platform marker),
SOC-054 (audience-magnitude reach model), PRS-021 (approval-gate latency measured separately),
COR-018 (per-human attribution behind evidence-level chips)

## Design references
`design/handoffs/evaluator-dashboard/DECISIONS.md` — **D6-008, D6-009, D6-010, D6-011**, and the
"D6 open / deferred" note on the misinformation spread tree. Reference DOM:
`design/handoffs/evaluator-dashboard/Evaluator Dashboard.dc.html` (`latRows`, `covRows`, the
sentiment SVG block, the `engineOff` dashed-card branch). Pre-design brief:
`docs/design/D6-evaluator-dashboard.md` §5 (metrics views).

> **Phasing note.** As with `evaluation-timeline`, this feature is authored ahead of its Phase 4
> build gate (Master PRD §4) because the D6 design session is complete; it is not pulled into the
> active Phase 1/2 backlog.

## Stories
| # | Story | Requirement(s) | Design | Status | Issue |
|---|---|---|---|---|---|
| 01 | Response latency (evidence-level chip) | EVL-010, CTL-026 | D6-009 | Not Started | — |
| 02 | Coverage: provisional until confirmed | EVL-011 | D6-010 | Not Started | — |
| 03 | Reach & sentiment with dial overlay | EVL-012, EVL-014 | D6-008, D6-009 | Not Started | — |
| 04 | Pre-E8 graceful degradation | EVL-015 | D6-011 | Not Started | — |
| 05 | Misinformation spread tree | EVL-013 | none (deferred — metrics-v2 design pass) | Not Started · deferred: design pass pending | — |

## Dependencies
`evaluation-timeline` (the event stream and dial/jump data every metric here is computed or
overlaid from); `world-steering` (E7) for the escalation dial (CTL-022) and off-platform marker
(CTL-026) sources; E8 for the engine sentiment signal (ADP-012) — absent pre-E8 (story 04);
`exercise-configuration` for the pre-E8/engine-enabled flag; the Cadence boundary (E10 §1 — Pulse
computes the metric, Cadence scores the human) bounds every story here.

## Design notes
Staff, chart-forward, calmer and lower-density than the D5 controller console per the D6 brief ("an
evaluator is reading, not operating"). NFR-001 is central: every evidence-level and status chip is
word + shape + color. The EVL-014 defensibility guarantee — an evaluator must never attribute a
controller-dialed mood shift to participant performance — is the epic's signature boundary feature;
the three redundant labels (chart-header banner, dashed line, ◆ marker) are load-bearing, not
decorative, and the same amber-◆ vocabulary must match `evaluation-timeline/03`'s staff lane exactly.
