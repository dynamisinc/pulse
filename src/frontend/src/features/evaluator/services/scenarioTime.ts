/**
 * features/evaluator/services/scenarioTime.ts
 * ---------------------------------------------------------------------------
 * Scenario-time helpers (COR-053). Every participant-visible timestamp on
 * this surface — storyline tiles, the live stream, timeline rows, the replay
 * stage/track — renders scenario time, never wall-clock.
 *
 * Mirrors the reference mockup's `scn(t)` function exactly: `t` is minutes
 * elapsed since the scenario clock started at 14:20 for this Fairhaven arc,
 * with the +4hr controller time-jump folding in once `t >= 52` (the hazard
 * -striped seam on the replay track, D6-005).
 *
 * TODO(E1/XC-004): replace the fixed 14:20 anchor + synthetic +4hr jump with
 * the real exercise clock (start time + logged time-jump events) once the
 * exercise-context/telemetry APIs exist.
 */

const SCENARIO_START_MINUTES = 14 * 60 + 20 // 14:20
const TIME_JUMP_AT_T = 52
const TIME_JUMP_MINUTES = 4 * 60

/** Formats elapsed scenario minutes `t` as an `HH:MM` scenario clock string. */
export function scenarioClock(t: number): string {
  const totalMinutes = SCENARIO_START_MINUTES + t + (t >= TIME_JUMP_AT_T ? TIME_JUMP_MINUTES : 0)
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const mm = String(Math.round(totalMinutes % 60)).padStart(2, '0')
  return `${hh}:${mm}`
}

/** The scenario-time discontinuity point, as a fraction (0-1) of the arc. */
export const TIME_JUMP_T = TIME_JUMP_AT_T

/** Total duration of the mocked Fairhaven arc, in scenario-elapsed minutes. */
export const ARC_DURATION_MINUTES = 68

/** Converts elapsed minutes `t` to a left-offset percentage along a 0-68 track. */
export function percentOfArc(t: number): number {
  return (t / ARC_DURATION_MINUTES) * 100
}
