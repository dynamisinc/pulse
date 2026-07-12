# Implementation: Exercise clock & scenario-time model

> Foundation consumed by nearly everything. The clock interface (story 01) and the scenario-time
> utility (story 04) are the two most-reused contracts in the product — build them early and put them
> in `core`. Providers are swappable (native now, Cadence-linked in Phase 4). Backend not present yet.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Native clock | Provider-interface clock (scenario datetime, StartEx, pause/resume). | (backend) clock service; `src/frontend/src/core/clock/exerciseClock.ts` | `IExerciseClock`, `useExerciseClock()` |
| 02 Time-jumps | Discrete jump emitting an old/new + skipped-span event. | (backend) jump; clock event | jump event |
| 03 Suspension/modules | Suspend/resume + named module stepping over jumps. | (backend) suspend/module | module-step API |
| 04 Scenario-time utility | Shared formatter for absolute/relative/dateline in scenario TZ. | `src/frontend/src/core/clock/scenarioTime.ts` | `formatScenarioTime()`, `useScenarioTime()` |
| 05 EndEx | EndEx transition + credential expiry + read-only hotwash. | (backend) endex; `features/exercise/EndExPage.tsx` | EndEx action |

## Reuse map
- exercise-configuration: time zone (COR-030), lifecycle (COR-032)
- `formatScenarioTime()` (story 04) — **consumed by every participant surface** (E2–E6) + backdated history
- `useExerciseClock()` (story 01) — consumed by E7 (CTL-015/023), E8 (timers), exercise-build-golive (StartEx)
- identity-auth-roles credential lifecycle (COR-016) — EndEx expiry (05)
- Provider interface (01) — E9 Cadence clock slots behind it (Phase 4)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Native clock | exerciseClock, IExerciseClock | exercise-configuration (TZ) | 04 | 1 | L |
| 04 Scenario-time utility | scenarioTime | exercise-configuration (TZ) | 01 | 1 | M |
| 02 Time-jumps | jump event | 01 | 03 | 2 | M |
| 03 Suspension/modules | suspend/module | 01, 02 | — | 3 | M |
| 05 EndEx | endex, EndExPage | 01; identity-auth-roles (COR-016); E10 | — | 3 | M |

Stories 01 and 04 are Wave-0/1 primitives for the entire product — prioritize them.
