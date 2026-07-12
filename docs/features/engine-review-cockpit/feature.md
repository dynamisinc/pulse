# Feature: Engine review cockpit

**Epic:** E7 — Controller Command Surface (hosts E8's human-in-the-loop control)  ·  **Phase:** 1
**Feature ref:** ADP-040 / F8.5 (engine-first: ships with the Phase-1 controller surface)
**World:** staff  ·  **Issue:** #7  ·  **Status:** feature.md stub — decompose before build

## Summary
The cockpit the adaptive engine (E8, Phase 2) will land into: a review queue for suggested/delayed
content with approve / edit / veto / re-roll, batch approve, and per-item persona + storyline
context. **Ships in Phase 1** (engine-first phasing, CTL-022) so the engine arrives to a ready
surface. The escalation dial itself lives in `world-steering` (CTL-022).

## Requirements covered
ADP-040 (review queue). **Amended:** expired timed drafts **auto-HOLD, never auto-send** — plus a new
**swamped-mode** toggle as a separate, lead-controller-gated story.

## Design references
`STORY-UPDATES.md` section A + C. **ADP-040 amendment** (D5-014/1.1; supersedes D5-005): an expired
draft **auto-HOLDs** ("timer expired — held for you"; surfaces in NEEDS YOU), *silence is never
approval*. Auto-send exists **only** as an explicit per-exercise **swamped-mode** toggle the lead
controller enables; automation never escalates its own autonomy (RECONCILE: no story may say drafts
auto-send on timeout except behind swamped mode).

## Stories (planned)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Review queue — approve / edit / veto / re-roll, batch, per-item context | ADP-040 | Not Started | #34 |
| 02 | Timed-draft expiry **auto-HOLD** (never auto-send); surfaces in NEEDS YOU | ADP-040 / D5-014/1.1 | Not Started | #35 |
| 03 | Swamped-mode toggle — lead-controller-gated auto-send opt-in | new / D5-014/1.1 | Not Started | #36 |
| — | Kill switch (drop engine to Suggest / stop) *(Phase 2 with E8)* | ADP-042 | Not Started | — |

## Dependencies
console-shell (this is a continuous-watch rail surface + NEEDS-YOU integration); E1 roles (lead
controller gate for swamped mode); the E8 engine (Phase 2) produces the queue items — in Phase 1 the
queue is built and testable with mock drafts. Every engine action is logged (ADP-041) for E10.

## Design notes
Staff world (COBRA). Continuous-watch surface (permanent rail space, per D5). The auto-HOLD default
is a safety-critical behavior: **inaction is never approval**. Counts here must agree with the
NEEDS-YOU bar ("N of M need review", "N timers under 60s") — a consistency requirement (D5-014/2.1).
