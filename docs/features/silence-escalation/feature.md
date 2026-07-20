# Feature: Silence escalation

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.1
**World:** staff / backend  ·  **Issue:** #131

## Summary
The "world reacts to inaction" behavior — the differentiator's sharpest edge. If no qualifying
official response addresses a storyline within its window (**scenario time**), the engine generates
escalating public anxiety and speculation, following the storyline's escalation curve. The vacuum
fills: worried posts, then "why is X silent?", then speculation and rumor-fertile ground.

## Requirements covered
ADP-001 (silence escalation). Consumes the reaction-loop observe stage (inaction timers),
storyline-model curves, and the persona voice engine. Pilot-mode: official **social** posts (and
off-platform markers CTL-026) are the qualifying responses.

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §1.2 (the loop), §6 (curves), §7 (what counts as a
qualifying response). Epic §4 UX ("the vacuum fills").

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Inaction timer → escalation trigger (scenario time) | ADP-001 / COR-050 | Complete | #161 |
| 02 | Escalating anxiety/speculation content | ADP-001 / ADP-010 | Done (decide policy; generate blocked) | #162 |

**Delivered** as the pure-backend `Pulse.Core/Features/SilenceEscalation/*` slice (see its `README.md`):
`SilenceRules` (qualifying-response semantics — off-platform marker or matched official post satisfies the
timer, unmatched never does; the escalation tone that climbs with silence) + `SilenceEscalationBehavior`
(the `Inaction` decide-stage policy). The scenario-time trigger substrate is the merged
`ReactionLoop.ObserveStage`. The generate→guard→publish of the escalation intent, and the `engine.observed`
telemetry, are blocked on reaction-loop story 03 (E2/E7) and #173 (E1 XC-004 base) respectively.

## Dependencies
`reaction-loop` (observe raises the inaction trigger; decide/generate carry it out), `storyline-model`
(window, curve, intensity), `persona-voice-engine` (voiced escalation), off-platform marker (#29) +
response-reaction (a matched response stops escalation). E1 clock (COR-050/051).

## Design notes
Staff/backend. Timers are **scenario time** (COR-050/051) — a freeze stops them, a time-jump advances
them. In pilot mode the only qualifying response is an official social post or an off-platform marker
(CTL-026); news/press qualifying responses extend in Phase 3. Escalation follows the storyline's
curve (Slow burn / Standard / Flash panic) so a Flash-panic storyline boils fast. This behavior is
the fertile ground the v1.1 rumor model activates on top of.
