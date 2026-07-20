# Feature: World steering

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** F7.3
**World:** staff  ·  **Issue:** #5  ·  **Status:** Wave 1 delivered — escalation dial (#25) +
tiered pause (#26) Complete; stories 01/04/05/06 deferred

> **Wave 1 delivered.** Stories 02 (escalation dial) and 03 (tiered pause) are Complete — Gate-1
> clean per story, integrated umbrella Gate-2 clean, `build:check`/`lint` clean, 880/882 tests
> passing (2 pre-existing unrelated flakes). Freeze-stops-clock verified live in the browser at
> `/console`. See `docs/BUILD_PLAN.md`'s "E7 World Steering — Wave 1" section for the full
> close-out, Gate evidence, and deferred follow-ups (stories 01/04/05/06 and the seam-consumer
> wiring).

> **Phase 0 reconciliation (done).** Stories 02/03 and `implementation.md` are checked against the
> FROZEN backend contracts (`Pulse.Core/Features/Storylines/Models/Storyline.cs`,
> `StorylinePhase.cs`, `Services/StorylineBriefProjection.cs`) and the SHIPPED E7 seams
> (`@/core/clock`'s `IExerciseClock`, the `staff-shell` `StaffHeader.tsx` state pill, the
> `ControllerConsole.tsx` work-area layout, `@/core/telemetry`'s `steering_action` vocabulary, and
> `@/features/participant-shell`'s overlay seam). Only the dial (CTL-022) and tiered pause (CTL-023)
> ship this pass; the mock storyline actual and the pausable-clock decision are recorded in
> `implementation.md`. Stories 01, 04, 05, 06 remain feature.md-listed but **Not Started/deferred**
> (see their one-line dependency notes in the table below) — do not pull them into this wave.

## Summary
The levers a controller pulls to bend the world: attention steering, the storyline escalation dial,
tiered pause, the Break-Fiction safety stop, content takedown, and the off-platform response marker.
Several of these carry **safety-critical D5 amendments** — author them to the amended behavior.

## Requirements covered
CTL-021, CTL-022, CTL-023, CTL-024, CTL-025, CTL-026. **CTL-020 (portal curation: pin Top Stories,
alert bar) is Phase 3** (needs E3 Portal / PRT-010) — later-phase stub; in pilot mode alerts deliver
via SOC-072 notifications.

## Design references
`STORY-UPDATES.md` section A (safety-critical). Amendments to apply:
- **CTL-024 → "Break Fiction"** (D5-014/1.2, D5-007): replaces participant screens **inside the
  exercise only**, Director-gated (locked for Controller role), type-to-confirm (**"BROADCAST"**),
  guarded/latched group, **every use logged** to the exercise record. *(D7-003: the alien overlay is
  **rendered by `participant-shell`**; this feature owns only the trigger + fan-out + audit.)*
- **CTL-023 → tiered pause** (D5-014/1.3): Pause injects / Pause engine / Freeze world; state pill
  INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN; **scenario clock stops only on Freeze**; Break
  Fiction implies world-freeze. *(D7-004: the participant pause/EndEx pages are **rendered by
  `participant-shell`** and the state pill lives in the **`staff-shell` header** (D7-010) — R-006
  resolved; this feature owns the tier control + state machine.)*
- **CTL-022 → intensity = actual + controller-set target** (D5-014/2.2): one track, actual fill +
  target tick; click to set target; the **engine drives actual toward the target**.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Attention levers (suggested-follows, flag-as-alert, trend boost) | CTL-021 (SOC-041/053/072) | Not Started — deferred (dep: E2 SOC-041/053/072) | #24 |
| 02 | Storyline escalation dial — actual + target, engine follows | CTL-022 / D5-014/2.2 | **Complete** — Wave 1 delivered | #25 |
| 03 | Tiered pause (injects / engine / freeze); clock stops only on freeze | CTL-023 / D5-014/1.3 | **Complete** — Wave 1 delivered | #26 |
| 04 | Break Fiction — Director-gated, type-to-confirm, in-exercise, logged | CTL-024 / D5-014/1.2, D5-007 | Not Started — deferred (dep: SignalR broadcast host B1 + Director role B2 + Freeze from #26) | #27 |
| 05 | Content takedown ≤2 clicks (tombstone, incident category, notify) | CTL-025 | Not Started — deferred (dep: E2 soft-delete/tombstone) | #28 |
| 06 | Off-platform response marker | CTL-026 (ADP-002a) | Not Started — deferred (dep: E8 expectations + E10 sink) | #29 |
| — | Portal curation — pin Top Stories, publish alert bar *(Phase 3 stub)* | CTL-020 (PRT-004/010) | Not Started | — |

## Dependencies
E1 clock + lifecycle (pause tiers), roles (Director vs Controller for Break Fiction); **`participant-shell`
overlay layer renders the break-fiction / pause / EndEx states this feature triggers** (D7-003/004);
**`staff-shell` header renders the tier state pill** (D7-010); E2 social levers (SOC-041/053/072) and
soft-delete/tombstone (SOC-005, XC-010) for takedown; E8 escalation profiles (ADP-010) for the dial;
E10 sink for the off-platform marker + takedown record.

## Design notes
Staff world (COBRA). **Break Fiction is the house lights** — visually alien to both worlds, cannot be
dismissed while active, logged per session; it lives in a guarded/latched group and never leaves the
platform. Takedown retains content staff-only for the record and never re-renders it in participant
surfaces including replay (CTL-025, XC-010). The off-platform marker stops wrongful silence-escalation
(ADP-002a) and annotates E10 so the AAR never reports a false "unaddressed."
