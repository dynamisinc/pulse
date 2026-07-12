# Feature: Rumor tracker

**Epic:** E7 console surface for E8 rumor objects  ·  **Phase:** 2 (mock in Phase 1)
**Feature ref:** D5-018 / F8.4  ·  **World:** staff  ·  **Issue:** #8
**Status:** feature.md stub — later-phase; mocked in the D5 design, decompose when E8 F8.4 lands

## Summary
Rumor objects as first-class, trackable things: a lifecycle **SEEDED → SPREADING → COUNTERED → DEAD**
with origin, reach, mutation lineage, and a "Draft counter as…" action. The D5 review mocked this as
a console flyout (target: Storyline Board v2); the real data model is E8's F8.4 (Phase 2 / v1.1).

## Requirements covered
D5-018 (tracker flyout, mocked). Underlying model: ADP-030, ADP-031, ADP-032, ADP-033 (E8, v1.1).

## Design references
`STORY-UPDATES.md` section B (ADD — rumor first-class objects, currently mock-only) and E8 F8.4.
Build the data model with E8; the console flyout consumes it.

## Stories (planned — do not build until E8 F8.4)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Rumor object + lifecycle model (SEEDED→SPREADING→COUNTERED→DEAD) | ADP-030/031 | Not Started | — |
| 02 | Rumor tracker flyout — reach bar + trend, mutation line, countered-by | D5-018, ADP-032 | Not Started | — |
| 03 | "Draft counter as…" → persona picker | D5-018 (CTL-001) | Not Started | — |

## Dependencies
E8 F8.4 rumor mechanics (Phase 2); console-shell (flyout host); persona-operation (draft-counter uses
the composer); E10 misinformation-containment metrics consume rumor lineage (ADP-032).

## Design notes
Staff world (COBRA), consult-on-demand flyout with a status badge (red pulsing count when escalating).
Advanced disinformation (coordinated campaigns, manipulated media) is explicitly out of baseline
scope (ADP-033) — the object model must not preclude it.
