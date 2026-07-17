# Feature: AAR export package

**Epic:** E10 — Evaluation & AAR  ·  **Phase:** 4  ·  **Feature ref:** F10.4 AAR export
**World:** staff  ·  **Issue:** #222

## Summary
The one-click, honest AAR evidence package: timeline, replay, annotations, metrics, and the
scenario-design record, structured to slot alongside Cadence's own AAR ZIP rather than duplicate it
— plus the (deferred) retention/export policy surface.

## Requirements covered
EVL-030, EVL-031, EVL-032 (deferred) · COR-006 (archived exercises separable for AAR) · NFR-007
(records/PII retention posture) · INT-032 (Cadence AAR ZIP slot)

## Design references
`design/handoffs/evaluator-dashboard/DECISIONS.md` — **D6-012**, and the "D6 open / deferred" note
("EVL-032 (retention/off-box export policy surface) — not a screen concern this pass"). Reference
DOM: `design/handoffs/evaluator-dashboard/Evaluator Dashboard.dc.html` (`expFlyOpen` flyout,
`manifest`, `exporting`/`expPct`/`expStep`, `exportDone`).

> **Phasing note.** Authored ahead of the Phase 4 build gate (Master PRD §4), per the same rationale
> as the other three E10 features.

## Stories
| # | Story | Requirement(s) | Design | Status | Issue |
|---|---|---|---|---|---|
| 01 | AAR export package | EVL-030, EVL-031 | D6-012 | Not Started | — |
| 02 | Retention & export policy | EVL-032 | none (deferred — not a screen concern this pass) | Not Started · deferred: design pass pending | — |

## Dependencies
Every other E10 feature — the manifest packages `evaluation-timeline`'s log + replay bundle,
`evaluator-tools`'s annotations (incl. unpushed count), and `evaluation-metrics`'s metrics +
scenario-design record (incl. story 02's provisional-coverage count); E9/`INT-032` for the
Cadence-AAR-ZIP slot-alongside contract; `exercise-isolation`'s `COR-006` (archived-exercise
separability).

## Design notes
Staff; toolstrip-hosted (registers into the D7 shell, does not draw its own strip); the export
itself is one COBRA primary action with a progress readout — no wizard, no multi-step form, matching
the epic's literal "one-click" requirement. Because this feature is downstream of every other E10
feature, it is necessarily the last to reach a fully working build even though it is a single,
small-effort story.
