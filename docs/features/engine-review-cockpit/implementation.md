# Implementation: Engine review cockpit

> Staff-world continuous-watch surface that E8 (Phase 2) lands into; built and tested with mock drafts
> in Phase 1. Publishes approved content via the E2 pipeline. The auto-HOLD default (story 02) is a
> safety property — inaction is never approval.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Review queue | Queue model + item card (persona/storyline context) + approve/edit/veto/re-roll + batch. | `features/controller/components/engine/ReviewQueue.tsx`, `hooks/useReviewQueue.ts`, `services/reviewActions.ts` | `useReviewQueue()` (pending count → `useToDos`), `approve/edit/veto/reroll` |
| 02 Auto-HOLD on expiry | Timer whose terminal action is HOLD; held-on-expiry feeds NEEDS-YOU. | `features/controller/hooks/useDraftTimer.ts` | `useDraftTimer()` |
| 03 Swamped mode | Per-exercise lead-gated flag read by the timer terminal action. | `features/controller/hooks/useSwampedMode.ts`, `components/engine/SwampedModeToggle.tsx` | `useSwampedMode()` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- console-shell rail host + NEEDS-YOU `useToDos` — the queue's pending count + held-on-expiry items feed it
- **E2 publish pipeline** — approve/edit publishes through it (reuse; do not fork)
- world-steering `usePauseState` — Pause engine suspends the queue's timers/generation
- Engine-action log (ADP-041) + telemetry (XC-004) — every action + timer transition + toggle
- E1 roles — lead-controller gate for swamped mode
- world-steering escalation dial (`useStorylineTarget`) — storyline context for queue items

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Review queue | ReviewQueue, useReviewQueue, reviewActions | console-shell; E2 pipeline | — | 1 | M |
| 02 Auto-HOLD on expiry | useDraftTimer | 01; console-shell NEEDS-YOU | 03 | 2 | S |
| 03 Swamped mode | useSwampedMode, SwampedModeToggle | 02; E1 lead-controller role | 02 | 2 | S |

Stories 02/03 are a pair: the timer's terminal action is HOLD unless swamped mode is on. Neither may
allow timeout auto-send by default.
