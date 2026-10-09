# Feature: Inject queue & conduct timeline

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** F7.2
**World:** staff  ·  **Issue:** #4  ·  **Status:** Demo slice (06 + 07) In Progress; stories 01–05 Not Started

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
| 06 | **Demo slice:** scripted posts, server-side inject queue (fire / hold / skip / edit, bursts, assignment) | CTL-010/011/014 (lite) | In Review | #452 |
| 07 | **Demo slice:** scripted posts console run sheet (Mine/All, live sync, PAUSE INJECTS live) | CTL-010/011/014 (lite), CTL-023 | In Progress | #453 |
| — | Cadence-sourced injects render + fire-locked *(Phase 4 stub)* | CTL-012 | Not Started | — |

> **Demo slice (2026-10-08).** Stories 06 + 07 build a server-side slice of 01/02/04 for the Oct 20 demo and
> **replace** demo-polish C3 (#438, browser-only run sheet). Decisions IQ-1…IQ-10 and the frozen wire contract are in
> [`implementation.md` § Demo slice](implementation.md#demo-slice--scripted-posts-server-side-stories-06--07--decided-2026-10-08).
> Stories 01–05 stay the full post-demo target (timeline rail, scheduler, batch, time-jump).

## Dependencies
E1 native exercise clock (COR-050/051), lifecycle; E2/E4/E5/E6 composers author the held content;
console-shell (timeline column host); the pause tiers (world-steering CTL-023) — CTL-015 depends on
pause. Backend-contract seam for scheduling/firing.

## Design notes
Staff world (COBRA). Dual-time (wall + scenario) on every fire (Cadence convention). Bursts must
feel naturally paced, not a simultaneous dump (the Looking Glass repeated-voices pattern, automated).
On a time jump the queue presents skipped-span items as a batch disposition, and (per D5) the jump
is guarded behind a pause.
