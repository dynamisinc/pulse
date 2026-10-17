/**
 * features/controller/noise — the console's White noise knob (demo-feedback story 09).
 * STAFF world only. See `NoiseControl.tsx` for the surface and `useNoiseState.ts` for the logic.
 */
export { NoiseControl, type NoiseControlProps } from './NoiseControl'
export { useNoiseState, type UseNoiseStateResult } from './useNoiseState'
export {
  NOISE_LEVELS,
  NOISE_LEVEL_LABELS,
  parseNoiseState,
  type NoiseLevel,
  type NoiseStateDto,
} from './noiseTypes'
