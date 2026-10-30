/**
 * features/channels/primitives/primitivesTestUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers for the primitives' specs: a fixed scenario clock, an axe run that
 * reports serious / critical violations, and a media fixture. Never import from app code.
 */

import axe from 'axe-core'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import type { ContentMediaDto } from '../contract'

/** Pins `scenarioNow()` to `iso` until `resetExerciseClock()`. */
export function pinScenarioClock(iso: string): void {
  const epoch = Date.parse(iso)
  setExerciseClock({ scenarioNow: () => new Date(epoch) })
}

export { resetExerciseClock }

/**
 * Runs axe over `container` and returns the serious / critical violations as readable
 * strings. `color-contrast` is off: jsdom does no layout or painting, so contrast is
 * pinned from the stylesheets instead (WatermarkSlot.test.tsx).
 */
export async function seriousAxeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => `${violation.id}: ${violation.help}`)
}

export function mediaFixture(overrides: Partial<ContentMediaDto> = {}): ContentMediaDto {
  return {
    id: 'media-1',
    kind: 'image',
    role: 'hero',
    url: '/mock-media/flood-hero.jpg',
    posterUrl: null,
    contentType: 'image/jpeg',
    width: 1600,
    height: 900,
    durationSec: null,
    alt: 'Floodwater covering Main Street',
    caption: 'Main Street at noon.',
    ...overrides,
  }
}
