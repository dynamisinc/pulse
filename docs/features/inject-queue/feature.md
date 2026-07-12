# Feature: Inject queue & conduct timeline

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** F7.2
**World:** staff  ·  **Issue:** #4  ·  **Status:** feature.md stub — decompose before build

## Summary
The conduct timeline: pre-authored Pulse content in scheduled order with fire/hold/skip/edit-then-
fire, timed multi-persona bursts, and scenario-time-jump handling — mirroring Cadence's MSEL conduct
vocabulary, running on the native exercise clock (COR-050).

## Requirements covered
CTL-010, CTL-011, CTL-013, CTL-014, CTL-015. **CTL-012 (Cadence-sourced items, fire-locked) is
Phase 4 (E9)** — listed as a later-phase stub story here, not built in Phase 1.

## Design references
`docs/design/D5-controller-console/` + `STORY-UPDATES.md`. **CTL-015 is amended** (D5-014/P4):
time-jump **requires pause first**, then a batch disposition of spanned injects (fire all / fire +
hold rumor wave / skip all). Author story 05 to the amended behavior.

## Stories (planned)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Conduct timeline with item status (pending/ready/fired/skipped/held) | CTL-010 | Not Started | #19 |
| 02 | Fire / hold / skip / edit-then-fire (single + batch), dual-time capture | CTL-011 | Not Started | #20 |
| 03 | Standalone native scheduler ("hold for conduct" against COR-050) | CTL-013 | Not Started | #21 |
| 04 | Timed bursts — a bundle fires as a naturally-paced sequence | CTL-014 | Not Started | #22 |
| 05 | Scenario-time-jump batch disposition (pause-first) | CTL-015 / D5-014/P4 | Not Started | #23 |
| — | Cadence-sourced injects render + fire-locked *(Phase 4 stub)* | CTL-012 | Not Started | — |

## Dependencies
E1 native exercise clock (COR-050/051), lifecycle; E2/E4/E5/E6 composers author the held content;
console-shell (timeline column host); the pause tiers (world-steering CTL-023) — CTL-015 depends on
pause. Backend-contract seam for scheduling/firing.

## Design notes
Staff world (COBRA). Dual-time (wall + scenario) on every fire (Cadence convention). Bursts must
feel naturally paced, not a simultaneous dump (the Looking Glass repeated-voices pattern, automated).
On a time jump the queue presents skipped-span items as a batch disposition, and (per D5) the jump
is guarded behind a pause.
