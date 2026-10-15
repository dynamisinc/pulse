/**
 * features/controller/noise/noiseStatus.ts
 * ---------------------------------------------------------------------------
 * The words the white-noise knob shows (demo-feedback story 09). Pure functions, no UI, so the
 * "why is it not running" rules are tested directly.
 *
 * WHY IT STOPPED, IN WORDS (story 09 AC2; DF-13). The server's `running` is one boolean: false
 * while the level is off, the pool is empty, the world is frozen, or the exercise clock is frozen
 * or not running (which includes a lifecycle outside staged/live: EndEx, a lifecycle pause). The
 * console tells the controller WHICH, in this order:
 *   1. the pool is empty           -> "No posts in the pool" (the one stop a controller fixes
 *                                     outside the console, so it wins even when frozen too);
 *   2. the pause tier is Freeze     -> "Stopped: the world is frozen";
 *   3. anything else                -> "Stopped: the clock is not running".
 *
 * THE FREEZE IS READ FROM THE CONSOLE'S OWN PAUSE TIER, not only from `running`. The server pushes
 * `NoiseStateChanged` on a level change and on each noise post, NOT on a Freeze, so a knob that
 * only trusted the last push would say "running" for as long as the world stayed frozen. The
 * hook re-reads the state when the tier changes; this rule makes the words right in the meantime.
 * Pause injects and Pause engine do not stop noise (DF-13), so only `freeze` counts here.
 */

import type { PauseTier } from '../hooks/usePauseState'
import type { NoiseStateDto } from './noiseTypes'

export const NOISE_STOPPED_EMPTY_POOL = 'No posts in the pool'
export const NOISE_STOPPED_FROZEN = 'Stopped: the world is frozen'
export const NOISE_STOPPED_CLOCK = 'Stopped: the clock is not running'

/** What the knob's status line says, and whether it is a stop the controller should notice. */
export interface NoiseStatusLine {
  readonly kind: 'off' | 'running' | 'stopped'
  readonly text: string
}

/** "6 posts/min" (the AC's wording). */
export function formatNoiseRate(ratePerMinute: number): string {
  return `${ratePerMinute} ${ratePerMinute === 1 ? 'post' : 'posts'}/min`
}

/** "40 in pool · 12 posted". */
export function formatNoiseCounts(state: Pick<NoiseStateDto, 'poolSize' | 'postedCount'>): string {
  return `${state.poolSize} in pool · ${state.postedCount} posted`
}

/**
 * The status line for `state` under the console's current pause `tier`: Off, Running, or the
 * reason noise is stopped (see the module header for the order).
 */
export function noiseStatusLine(state: NoiseStateDto, tier: PauseTier): NoiseStatusLine {
  if (state.level === 'off') return { kind: 'off', text: 'Off' }
  if (state.poolSize === 0) return { kind: 'stopped', text: NOISE_STOPPED_EMPTY_POOL }
  if (tier === 'freeze') return { kind: 'stopped', text: NOISE_STOPPED_FROZEN }
  if (!state.running) return { kind: 'stopped', text: NOISE_STOPPED_CLOCK }
  return { kind: 'running', text: 'Running' }
}
