/**
 * features/controller/console/steeringSummary.ts
 * ---------------------------------------------------------------------------
 * The collapsed Steering row's one-line TEXT summary (mobile-tablet story 12; D5-026), split out
 * of `ConsoleSteeringDisclosure.tsx` so the component file exports only a component. STAFF
 * world, pure.
 */

import { NOISE_LEVEL_LABELS, type NoiseLevel } from '../noise'

/** The collapsed one-line summary: "Storyline target 60 · Noise Medium". Pure, for tests. */
export function steeringSummary(
  target: number | null | 'unknown',
  noise: NoiseLevel | undefined,
): string {
  const targetText = target === 'unknown' ? 'unknown' : target === null ? 'none' : String(target)
  const noiseText = noise === undefined ? 'reading…' : NOISE_LEVEL_LABELS[noise]
  return `Storyline target ${targetText} · Noise ${noiseText}`
}
