/**
 * core/clock/exerciseClock.ts
 * ---------------------------------------------------------------------------
 * Wave-0 mock exercise-clock source (feature: exercise-clock, story 04,
 * COR-053; see docs/features/exercise-clock/04-scenario-time-participant-
 * visible.md).
 *
 * Defines the minimal `IExerciseClock` contract this seam depends on — a
 * single `scenarioNow()` accessor — and backs it with a mock implementation
 * so `scenarioTime.ts` can stand alone with no backend and no dependency on
 * story 01 (the native exercise clock).
 *
 * Story 01 later REPLACES the mock clock installed here with the real
 * provider (StartEx anchor, pause/resume, discrete Director time-jumps)
 * behind this same `IExerciseClock` interface. Nothing in `scenarioTime.ts`
 * — or any other consumer of `scenarioNow()` — needs to change when that
 * happens.
 *
 * Wave-0 decoupling: this is one of Pulse's three Wave-0 foundation seams
 * (alongside exercise-isolation/10 and telemetry/01). It must NOT import
 * `core/exerciseContext` or `core/telemetry` (or anything from another
 * seam) — it stands alone. It also has no UI/React dependency: it is a pure
 * data source.
 *
 * Mock behavior: absent a real provider, scenario time tracks wall-clock
 * time 1:1 (`scenarioNow()` returns `new Date()`). There is no StartEx
 * anchor, no time-jump, and no suspension yet — those arrive with stories
 * 01/02/03. Tests and standalone usage may swap in a fixed-instant fake via
 * `setExerciseClock()` / `resetExerciseClock()`.
 */

/** The exercise-clock contract every scenario-time consumer relies on. */
export interface IExerciseClock {
  /** The current scenario-time instant. */
  scenarioNow(): Date
}

/**
 * Default Wave-0 mock: scenario time mirrors wall-clock time until story 01
 * installs the real native/Cadence-linked provider behind this interface.
 */
const mockExerciseClock: IExerciseClock = {
  scenarioNow: () => new Date(),
}

let activeClock: IExerciseClock = mockExerciseClock

/**
 * Returns the exercise clock currently backing `scenarioNow()`. Story 01
 * swaps the active clock for the real provider; callers should not cache
 * the returned reference across renders/ticks.
 */
export function getExerciseClock(): IExerciseClock {
  return activeClock
}

/**
 * Test/standalone seam: substitute the active exercise clock (e.g. a
 * fixed-instant fake) so scenario-time formatting can be exercised
 * deterministically. Not for production use — production wiring is story
 * 01's native-clock provider.
 */
export function setExerciseClock(clock: IExerciseClock): void {
  activeClock = clock
}

/** Restores the default Wave-0 mock (wall-clock-mirroring) exercise clock. */
export function resetExerciseClock(): void {
  activeClock = mockExerciseClock
}
