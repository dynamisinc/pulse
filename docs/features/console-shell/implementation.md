# Implementation: Console shell

> Wave 1 foundation of the E7 console — the frame every other feature mounts into. Staff world
> (COBRA). Backend not present; participant/telemetry data is mocked behind the axios client.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Toolstrip + flyouts | Console layout shell + 56px toolstrip + flyout primitive + a tool registry (continuous-watch vs consult-on-demand). | `features/controller/components/shell/ConsoleShell.tsx`, `Toolstrip.tsx`, `Flyout.tsx`, `toolRegistry.ts` | `<ConsoleShell>`, `registerTool()`, `<Flyout>` |
| 02 NEEDS-YOU bar | Persistent bar bound to a derived to-dos selector; chips call a shared reveal-target primitive, never a mutation. | `features/controller/components/shell/NeedsYouBar.tsx`, `hooks/useToDos.ts`, `components/shell/revealTarget.ts` | `useToDos()`, `revealTarget()` |
| 03 Static identity badge | Header badge that reads lifecycle state to choose static vs switchable. **Placement/presentation interim — superseded by D7 shell (R-006)**; build the behavior, expect the chrome to be re-homed. | `features/controller/components/shell/IdentityBadge.tsx` | `<IdentityBadge>` |
| 04 Flag → AAR | Hover Flag affordance + an AAR-write mutation (append-only). | `features/controller/hooks/useFlagToAar.ts`, `components/FlagAction.tsx` | `useFlagToAar()`, `<FlagAction>` |
| 05 Trainee monitor | Consult-on-demand flyout of trainee cards over the activity + expected-action stream. | `features/controller/components/TraineeMonitor.tsx`, `hooks/useTrainees.ts` | `<TraineeMonitor>` (registered tool) |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- Shared axios client + React Query — `core/services/api.ts`, `@tanstack/react-query`
- Exercise-context / active-exercise + lifecycle state (E1, COR-032/050) — read for static-vs-switch
- Telemetry emitter (XC-004) — flag + monitor read the same activity stream feeding live-monitoring
- E10 after-action record sink — Flag writes here (minimal now)
- `revealTarget()` primitive (story 02) — reused by NEEDS-YOU chips and Flag/locate affordances
- `registerTool()` (story 01) — persona picker, review queue, trainee monitor, rumor tracker all register here

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Toolstrip + flyouts | shell/, toolRegistry | E1 roles/context | 03 | 1 | M |
| 03 Static identity badge | IdentityBadge | E1 lifecycle state | 01 | 1 | S |
| 02 NEEDS-YOU bar | NeedsYouBar, useToDos, revealTarget | 01; to-do sources (review queue/timers) | — | 2 | M |
| 04 Flag → AAR | useFlagToAar, FlagAction | 01; E10 AAR sink; telemetry | 05 | 2 | S |
| 05 Trainee monitor | TraineeMonitor, useTrainees | 01; activity stream; CTL-032 | 04 | 3 | M |

This feature is Wave 1 for the whole epic: story 01 must land before the other E7 features' surfaces
have a host to mount into.
