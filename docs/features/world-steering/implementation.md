# Implementation: World steering

> Staff-world levers over the E2 world + the E8 engine + the exercise clock. Several stories carry
> safety-critical D5 amendments (Break Fiction, tiered pause, dial target). Backend not present —
> steering endpoints + the real-time broadcast are the serial contract seam; mock now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Attention levers | Thin controls over E2 suggested-follows / notifications / trend weight. | `features/controller/components/steering/AttentionLevers.tsx`, `services/steeringActions.ts` | `setSuggestedFollows()`, `flagAsAlert()`, `boostTrend()` |
| 02 Escalation dial | One-track actual+target widget; exposes target to the engine loop. | `features/controller/components/steering/EscalationDial.tsx`, `hooks/useStorylineTarget.ts` | `useStorylineTarget()`, `<EscalationDial>` |
| 03 Tiered pause | Pause-state machine (injects/engine/freeze) + state pill; Freeze stops the clock. | `features/controller/hooks/usePauseState.ts`, `components/steering/PausePill.tsx` | `usePauseState()` (read by inject-queue, engine review) |
| 04 Break Fiction | Guarded/latched Director control + type-to-confirm + all-session broadcast + per-session log. | `features/controller/components/steering/BreakFiction.tsx`, `services/breakFiction.ts` | `<BreakFictionControl>` |
| 05 Takedown | Staff takedown reusing E2 soft-delete + category + Director notify; replay honors it. | `features/controller/components/steering/TakedownAction.tsx`, `services/takedown.ts` | `takedownContent()` |
| 06 Off-platform marker | Event write bound to a storyline/inject that satisfies expectations. | `features/controller/components/steering/OffPlatformMarker.tsx` | `markOffPlatformResponse()` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- E2 mechanisms: suggested-follows (SOC-053), notifications (SOC-072), trending (SOC-041),
  soft-delete/tombstone (SOC-005, XC-010) — steering drives these, never forks them
- E1 **native clock** (COR-050) — Freeze stops it; roles (Director vs Controller) gate Break Fiction
- E8 storyline model + escalation profiles (ADP-010) — the dial target feeds the engine loop
- **`usePauseState()` (story 03)** — consumed by inject-queue (burst suspend, jump gating) and
  engine-review-cockpit (engine pause)
- Real-time broadcast host (SignalR) — Break Fiction fan-out + per-session delivery log
- Telemetry emitter (XC-004) + E10 sink — every steering action is logged; off-platform marker + takedown annotate E10

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 03 Tiered pause | usePauseState, PausePill | E1 clock; console-shell | 01, 02 | 1 | M |
| 01 Attention levers | AttentionLevers, steeringActions | E2 SOC-041/053/072 | 02, 03 | 1 | M |
| 02 Escalation dial | EscalationDial, useStorylineTarget | E8 storyline model (loop later) | 01, 03 | 1 | M |
| 05 Takedown | TakedownAction, takedown | E2 soft-delete; E10 replay filter | 06 | 2 | M |
| 06 Off-platform marker | OffPlatformMarker | E8 expectations; E10 sink | 05 | 2 | S |
| 04 Break Fiction | BreakFiction, breakFiction svc | 03 (Freeze); E1 Director role; broadcast host | — | 3 | L |

Story 03 (tiered pause) is a Wave-1 primitive other features depend on; Break Fiction (04) waits on
Freeze + the broadcast host.
