# Feature: Engine review cockpit

**Epic:** E7 — Controller Command Surface (hosts E8's human-in-the-loop control)  ·  **Phase:** 1
**Feature ref:** ADP-040 / F8.5 (engine-first: ships with the Phase-1 controller surface)
**World:** staff  ·  **Issue:** #7  ·  **Status:** Wave 1 delivered (stories 01–03 Complete) — kill switch (ADP-042) deferred to Phase 2 with E8

> **Phase 0 reconciliation (done).** Stories/implementation.md checked against the FROZEN backend
> contracts (`Pulse.Core/Features/Autonomy/Models/*`, `AutoHoldPolicy`, `WorkloadDemandMeter`) and the
> SHIPPED E7 Simcell Operator Wave-1 seam (`/console`, `@/features/controller`, the E2 `createPost`
> pipeline). Two soft deps this feature's stories previously assumed do **not** exist yet and were
> corrected: **console-shell/02's NEEDS-YOU bar** (this feature now exposes its own inline
> pending/held count; the bar consumes it once built) and **world-steering** (pause tiers/escalation
> dial; storyline context is mocked from a brief on the mock review item for now, with no
> pause-suspends-timers wiring). See `implementation.md` for the corrected file ownership/reuse map.

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

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Review queue — approve / edit / veto / re-roll, batch, per-item context | ADP-040 | Complete | #34 |
| 02 | Timed-draft expiry **auto-HOLD** (never auto-send); surfaces in NEEDS YOU | ADP-040 / D5-014/1.1 | Complete | #35 |
| 03 | Swamped-mode toggle — lead-controller-gated auto-send opt-in | new / D5-014/1.1 | Complete | #36 |
| — | Kill switch (drop engine to Suggest / stop) *(Phase 2 with E8)* | ADP-042 | Not Started — wiring homed in `engine-runtime/02` | — |

## Dependencies
console-shell (this is a continuous-watch surface that will occupy PERMANENT rail/column space in
`ControllerConsole`'s work area — that dock point does not exist yet; wiring it is an orchestrator-
owned serial integration edit, not a story here, mirroring the `App.tsx` composition-root rule.
Console-shell/02's NEEDS-YOU bar is **not built**; this feature exposes its own inline pending/held
count in the interim and the bar will read from it once it lands); the controller-identity mock's
`isLead` flag (gates swamped mode — the real E1 lead-controller role is the deferred backend swap,
same pattern as `controllerIdentity`'s own mock note; `roles.ts` has no `lead-controller` role yet);
the E8 engine (Phase 2) produces the queue items — in Phase 1 the queue is built and testable with
mock drafts, with per-item storyline context mocked from a brief on the mock review item
(world-steering's escalation dial is not built, so there is no live storyline-target wiring, and no
pause-suspends-timers wiring — documented follow-up for when CTL-023 tiered pause lands). Every
engine action is logged (ADP-041) for E10. **The mock→live flip of this queue — `useReviewQueue`'s
mock `reviewStore` swapped for a live API + SignalR subscribe, with no rewrite of `ReviewQueue.tsx` or
the `reviewContracts.ts` shapes — is delivered by `docs/features/engine-runtime/02-review-cockpit-api.md`**
(Phase B3, authored/Not Started); that story also wires the kill switch and the auto-HOLD tick to the
built `Pulse.Core/Features/Autonomy/*` services this feature's stories consumed as mock drafts.

## Design notes
Staff world (COBRA). Continuous-watch surface (permanent rail space, per D5). The auto-HOLD default
is a safety-critical behavior: **inaction is never approval**. Counts here are the single source of
truth for the D5-014/2.1 consistency requirement ("N need review", "N timers under 60s"): this
feature's own inline indicator today; once console-shell/02 ships the NEEDS-YOU bar, it reads from
the same source rather than recomputing. **Once `engine-runtime/02` lands**, the same
`useReviewQueue`-derived counts read off live data rather than the mock `reviewStore` — the single
source of truth does not move, only what backs it.
