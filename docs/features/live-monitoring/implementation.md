# Implementation: Live monitoring

> Staff-world situational awareness over the XC-004 activity stream. Operational awareness, not
> scoring (E10 owns evaluation). Backend not present — the activity stream + SignalR host are the
> contract seam; mock now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Board | Virtualized live activity list over the telemetry stream + filters. | `features/controller/components/monitor/ActivityBoard.tsx`, `hooks/useActivityStream.ts` | `useActivityStream()` |
| 02 Watchlist columns | Saved-query columns over the same stream. | `features/controller/components/monitor/WatchColumn.tsx`, `hooks/useWatchColumns.ts` | `<WatchColumn>`, `useWatchColumns()` |
| 03 Expected-action | Fired-vs-responded state from queue expected-action + response-match. | `features/controller/components/monitor/ExpectedActionTracker.tsx`, `hooks/useExpectedActions.ts` | `useExpectedActions()` |
| 04 Queue-pressure meter | Rolling-60s demand rate from the shared to-dos source; ephemeral. | `features/controller/components/monitor/QueuePressureMeter.tsx`, `hooks/useQueuePressure.ts` | `useQueuePressure()` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- console-shell column/rail host + NEEDS-YOU to-dos source (`useToDos`) — the meter (04) reuses it
- **XC-004 telemetry/activity stream** + SignalR host — board + columns read it (mock now)
- inject-queue expected-action fields + world-steering `markOffPlatformResponse` — expected-action (03)
- Virtualized list utility (shared with feeds) — burst legibility (NFR-002/SOC-071)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Board | ActivityBoard, useActivityStream | console-shell; activity stream | — | 1 | M |
| 02 Watchlist columns | WatchColumn, useWatchColumns | 01 | 03 | 2 | M |
| 03 Expected-action | ExpectedActionTracker, useExpectedActions | inject-queue expected-action; CTL-026 | 02 | 2 | M |
| 04 Queue-pressure meter | QueuePressureMeter, useQueuePressure | console-shell to-dos; engine-review; inject-queue | — | 2 | S |

The meter (04) must read the same to-dos source as the NEEDS-YOU bar so counts agree (D5-014/2.1).
