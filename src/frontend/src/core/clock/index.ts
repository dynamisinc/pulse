/**
 * core/clock — public barrel.
 *
 * The Wave-0 scenario-time seam (COR-053; feature: exercise-clock). Consumers
 * import scenario time from `@/core/clock` — the single participant-visible
 * time source. Foldered like its sibling Wave-0 seams (`core/exerciseContext`,
 * `core/telemetry`), which already expose a barrel; this adds the matching one
 * so the folder has a single public import point.
 *
 * Pure re-export: it adds NO behavior to the Wave-0 clock modules. Wall-clock
 * (`Date.now()` / bare `new Date()`) is banned on participant surfaces
 * (WAVE0-REVIEW precedent 11); use `scenarioNow()` / `formatScenarioTime()`
 * from here instead.
 */

export {
  DEFAULT_SCENARIO_TIME_ZONE,
  MOCK_SCENARIO_TIME_ZONE,
  scenarioNow,
  formatScenarioTime,
  useScenarioTime,
} from './scenarioTime'
export type {
  ScenarioTimeFormat,
  FormatScenarioTimeOptions,
  UseScenarioTimeResult,
} from './scenarioTime'

export {
  getExerciseClock,
  setExerciseClock,
  resetExerciseClock,
} from './exerciseClock'
export type { IExerciseClock } from './exerciseClock'
