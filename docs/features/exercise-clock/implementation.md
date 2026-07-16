# Implementation: Exercise clock & scenario-time model

> Foundation consumed by nearly everything. The clock interface (story 01) and the scenario-time
> utility (story 04) are the two most-reused contracts in the product — build them early and put them
> in `core`. Providers are swappable (native now, Cadence-linked in Phase 4). Backend not present yet.
> **Story 04 ships first, standalone, at Wave 0**: a minimal mock `IExerciseClock` source
> (`core/clock/exerciseClock.ts`, `scenarioNow()` only) backs `scenarioTime.ts` so the utility has no
> dependency on story 01. Story 01 later **replaces** the mock with the real provider (StartEx,
> pause/resume, jump-aware) behind the same interface — no change to consumers.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Native clock | Provider-interface clock (scenario datetime, StartEx, pause/resume); **replaces** story 04's mock `exerciseClock.ts` with the full provider behind the same `IExerciseClock` interface — no consumer changes. | (backend) clock service; extends `src/frontend/src/core/clock/exerciseClock.ts` (mock seeded by story 04) | `IExerciseClock`, `useExerciseClock()` |
| 02 Time-jumps | Discrete jump emitting an old/new + skipped-span event. | (backend) jump; clock event | jump event |
| 03 Suspension/modules | Suspend/resume + named module stepping over jumps. | (backend) suspend/module | module-step API |
| 04 Scenario-time utility | Shared formatter for absolute/relative/dateline in scenario TZ; ships with a **minimal mock clock source** (`IExerciseClock.scenarioNow()` only) so it stands alone at Wave 0, with no backend and no dependency on story 01. | `src/frontend/src/core/clock/scenarioTime.ts`, mock `src/frontend/src/core/clock/exerciseClock.ts` | `scenarioNow()`, `formatScenarioTime()`, `useScenarioTime()` |
| 05 EndEx | EndEx transition + credential expiry + read-only hotwash. | (backend) endex; `features/exercise/EndExPage.tsx` | EndEx action |

## Reuse map
- exercise-configuration: time zone (COR-030), lifecycle (COR-032)
- `scenarioNow()` + `formatScenarioTime()` (story 04, `core/clock/scenarioTime.ts`) — **consumed by
  every participant surface** (E2–E6) + backdated history; Wave 0, backed by a mock
  `core/clock/exerciseClock.ts` clock source until story 01 lands the real provider
- `useExerciseClock()` (story 01) — consumed by E7 (CTL-015/023), E8 (timers), exercise-build-golive
  (StartEx); **replaces** story 04's mock clock source behind the same `IExerciseClock` interface
- identity-auth-roles credential lifecycle (COR-016) — EndEx expiry (05)
- Provider interface (01) — E9 Cadence clock slots behind it (Phase 4)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 04 Scenario-time utility | scenarioTime.ts, mock exerciseClock.ts | none (Wave 0; mock clock source ships with this story) | — (Wave-0 seam, parallel with `exercise-isolation/10` and `telemetry/01` in other features — code-decoupled, no shared files) | 0 | M |
| 01 Native clock | exerciseClock (extends story 04's mock), IExerciseClock | 04 (mock file to extend); exercise-configuration (TZ) | — | 1 | L |
| 02 Time-jumps | jump event | 01 | 03 | 2 | M |
| 03 Suspension/modules | suspend/module | 01, 02 | — | 3 | M |
| 05 EndEx | endex, EndExPage | 01; identity-auth-roles (COR-016); E10 | — | 3 | M |

Story 04 is a Wave-0 foundation seam: it ships standalone (mock clock source) before story 01's real
native-clock provider, which later extends the same file behind the unchanged `IExerciseClock`
interface. Together with `exercise-isolation/10` and `telemetry/01`, these are Pulse's three Wave-0
primitives — parallel, code-decoupled, no story importing another's module; wiring happens later, in
consumers.
