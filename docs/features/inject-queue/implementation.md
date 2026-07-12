# Implementation: Inject queue & conduct timeline

> Staff-world continuous-watch rail in the console. Publishes through the channel pipelines (E2
> social in Phase 1). Runs on the native exercise clock (COR-050). Backend not present — the queue +
> fire endpoints are the serial backend-contract seam; mock behind the axios client now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Timeline | Queue model + timeline rail bound to the scenario clock. | `features/controller/components/queue/ConductTimeline.tsx`, `hooks/useQueue.ts`, `types/queue.ts` | `useQueue()`, `QueueItem` type |
| 02 Fire/hold/skip/edit | Queue mutations that publish via the channel pipeline with dual-time capture. | `features/controller/services/queueActions.ts`, `components/queue/QueueItemActions.tsx` | `fireItem()`, `holdItem()`, `skipItem()`, `editThenFire()` |
| 03 Scheduler | "Hold for conduct" affordance + scheduled scenario time on the composer. | `features/controller/components/queue/HoldForConduct.tsx` | `scheduleItem()` |
| 04 Bursts | Bundle item type + pacing scheduler honoring world-pause. | `features/controller/services/burstScheduler.ts`, `components/queue/BundleProgress.tsx` | `fireBundle()` |
| 05 Time-jump disposition | Pause-gated jump dialog + batch disposition over spanned items. | `features/controller/components/queue/TimeJumpDialog.tsx` | `<TimeJumpDialog>` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- console-shell rail/column host + `registerTool()` — mounts the timeline (continuous-watch)
- **E2 social publish pipeline** — fire/backfill publish through it; do not fork
- E1 **native exercise clock** (COR-050/051) + lifecycle (COR-032) — scheduling + jump + "now" marker
- Telemetry emitter (XC-004) — every fire/hold/skip/edit/jump is a logged controller action
- **world-steering tiered pause (CTL-023)** — burst suspend (04) and jump gating (05) read pause state
- Persona/composer path (persona-operation) — edit-then-fire + bundle child posts

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Timeline | ConductTimeline, useQueue, types | console-shell; E1 clock | — | 1 | M |
| 02 Fire/hold/skip/edit | queueActions, QueueItemActions | 01; E2 pipeline; telemetry | 03 | 2 | M |
| 03 Scheduler | HoldForConduct | 01; E2 composer; E1 clock | 02 | 2 | S |
| 04 Bursts | burstScheduler, BundleProgress | 02; CTL-023 pause | — | 3 | M |
| 05 Time-jump disposition | TimeJumpDialog | 02; **CTL-023 pause**; E1 jump | — | 3 | M |

Stories 04 and 05 depend on world-steering's tiered pause (CTL-023) landing — cross-feature serial edge.
