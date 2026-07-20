# Feature: Silence escalation

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/silence-escalation/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §7 / §6 / §1.2
**Issue:** #131 (stories #161–#162)

"The world reacts to inaction" — the differentiator's sharpest edge (ADP-001). Pure backend domain logic:
the inaction **trigger** substrate is the merged `ReactionLoop.ObserveStage` (scenario-time window elapse,
freeze/time-jump); this slice adds the ADP-001 **silence semantics** on top — what counts as a qualifying
response, and the escalating **tone** as silence runs on — as a decide-stage behavior plugging into the
merged `DecideStage` registry. No E2/E7 dependency.

## The seams

| Type | Role |
|---|---|
| `Services/SilenceRules.cs` | `IsQualifyingResponse(source, matched)` — off-platform marker always satisfies the timer; an official post only when **matched** (unmatched is never silence-satisfying, ADP-002a). `EscalationTone(minutesSilent, window)` — the worry→speculation→anger mix that climbs with silence. |
| `Services/SilenceEscalationBehavior.cs` | The `IReactionBehavior` for the `Inaction` trigger: composes the loop's base intent and shapes its tone to escalate with silence duration. |

## Status

| Story | State |
|---|---|
| 01 Inaction timer → escalation trigger (#161) | Done — the scenario-time trigger is `ObserveStage` (merged); this adds `SilenceRules.IsQualifyingResponse` (matched/marker satisfies; unmatched never silence). The `engine.observed` telemetry AC is deferred with #173 (E1 XC-004 base). |
| 02 Escalating anxiety/speculation content (#162) | Done (decide-stage policy) — `SilenceEscalationBehavior` shapes the escalation intent (later bursts visibly more anxious). The generate→guard→publish of that intent is the blocked reaction-loop story 03 (E2/E7). |

A matched official response leaves the storyline addressed, so `ObserveStage` stops raising the inaction
trigger — the hand-off to `response-reaction` is automatic (covered by a cross-slice test).
