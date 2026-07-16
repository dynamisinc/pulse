# Story: Scenario time is the participant-visible time

**Feature:** Exercise clock & scenario-time model  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-053  ·  **Design decisions:** none  ·  **Issue:** #80

## Context
The cross-cutting rule the whole product obeys: **scenario time is the participant-visible time.** All
in-fiction surfaces — post timestamps, "2h ago" relative times, article datelines, weather products,
portal dateline — render in scenario time in the exercise's time zone. Wall-clock time is captured in
telemetry (XC-004) but **never shown inside the fiction** (COR-053).

This is one of Pulse's three Wave-0 foundation seams (alongside `exercise-isolation/10` and
`telemetry/01`) and it stands alone: no backend, and no dependency on the other two seams. It ships
behind a **minimal mock clock source**, not the full native-clock provider — story 01 lands the real
`IExerciseClock` (StartEx, pause/resume, `ScenarioDay` semantics) later and slots it in behind the same
interface, with no change to this utility's callers.

## Acceptance Criteria
- [ ] `src/frontend/src/core/clock/scenarioTime.ts` exports `scenarioNow(): Date` and
      `formatScenarioTime(instant, timeZone, opts?)`, backed by a minimal mock clock source at
      `src/frontend/src/core/clock/exerciseClock.ts` — a mock `IExerciseClock` exposing `scenarioNow`
      only (the real native/Cadence-linked provider swaps in later behind the same interface per story
      01 / COR-050, with no change to callers).
- [ ] `formatScenarioTime` renders absolute times, datelines, and relative times ("2h ago") in scenario
      time, using `Intl.DateTimeFormat` with the **passed-in `timeZone`** argument for TZ-correct
      absolute/dateline rendering (date-fns v4 is available for duration math); relative strings are
      computed against `scenarioNow()` — **never** wall-clock (`Date.now()` / unadorned `new Date()`).
- [ ] `formatScenarioTime` takes `timeZone` as an **explicit argument** (defaulting to a mock IANA zone
      for standalone use and tests) — it does not import or reach into the exercise-context module to
      resolve it. A `useScenarioTime()` hook wraps the utility for component consumption.
- [ ] Every participant-visible time uses this utility; a review/lint guard flags any wall-clock time
      rendered on a participant surface (enforced by `code-review`).
- [ ] Backdated content (persona-management COR-023) and post-jump backfills (story 02) render
      consistently under this rule.
- [ ] Wall-clock is available to staff (dual time) and telemetry, never in the participant fiction.

## Out of Scope
The individual surfaces' rendering (each channel uses the utility); staff dual-time display (E7); the
real native clock provider — StartEx, pause/resume, discrete jumps (stories 01/02/03, which later
replace the mock `IExerciseClock` source behind the same interface); automatically wiring the
exercise's configured time zone into this utility (that happens in **consumers** — the shell mount
contract, `PostCard`, etc. — which read `timeZone` from `useExerciseContext()` and pass it in; not this
story, and not an import this module makes).

## Technical Notes
World: **platform/foundation** — a pure `core/` module, no UI chrome, no COBRA. Foundation utility
consumed by every participant surface later; put it in `core`. This is the single most-reused time
contract in the product.

**Decoupled at v0; wired at the edges later.** This seam must **not** import `core/exerciseContext` or
the telemetry emitter (`core/telemetry/`) — the three foundation seams (this one,
`exercise-isolation/10`, `telemetry/01`) build in parallel, in isolated worktrees, and none may import
another at v0. `formatScenarioTime`'s `timeZone` parameter is how the exercise's real time zone reaches
this utility: a consumer resolves `timeZone` from `useExerciseContext()` and passes it in; this module
has no knowledge of exercise-context.

Note: `src/frontend/src/features/evaluator/services/scenarioTime.ts` is a **pre-existing, separate**
local stub for the evaluator surface only. It is superseded by this canonical
`core/clock/scenarioTime.ts` utility for other surfaces later, but is **not modified by this story**.

See `implementation.md` (story 04) for the reuse-map/wave update and the note on story 01's later
replacement of the mock clock source.

## Dependencies
None at Wave 0 — the mock `exerciseClock` source ships with this story. Story 01 (native clock) later
replaces the mock provider behind the same `IExerciseClock` interface; exercise-configuration (COR-030
time zone) feeds real `timeZone` values through consumers, not through this module directly.

## Tests
- Unit: absolute/relative/dateline formatting in scenario time + a passed exercise TZ; no wall-clock
  leak; a backdated + a backfilled item render in correct scenario order; `scenarioNow()` reads from
  the mock clock source (`exerciseClock.ts`), never `Date.now()` directly.
