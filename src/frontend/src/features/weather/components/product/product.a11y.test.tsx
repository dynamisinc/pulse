/**
 * Accessibility sweep of the weather product components (weather-source 07, #758; NFR-001):
 * axe reports no serious / critical violation, the pieces add no interactive control of
 * their own (so no target can fall under 44 px on a coarse pointer), and nothing animates
 * (so reduced motion has nothing to stop).
 */
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import {
  WEATHER_CANCEL_FIXTURE,
  WEATHER_UPGRADE_FIXTURE,
  WEATHER_WATCH_FIXTURE,
} from '@/features/weather/contract'
import {
  mediaFixture,
  pinScenarioClock,
  resetExerciseClock,
  seriousAxeViolations,
} from '@/features/channels/primitives/primitivesTestUtils'
import {
  IbwGrid,
  ProductImagery,
  ProductStateBanner,
  ProductText,
  ProductTimes,
  SeverityChip,
} from '.'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-1', timeZone: 'America/Chicago' }),
}))
vi.mock('@/features/participant-shell/components/OverlayLayer', () => ({
  useOverlayState: () => ({ state: 'none' }),
}))

beforeEach(() => {
  pinScenarioClock('2026-12-02T14:30:00Z')
})

afterEach(() => {
  resetExerciseClock()
})

const PRODUCT = WEATHER_UPGRADE_FIXTURE

function Page() {
  return (
    <MemoryRouter>
      <main>
        <h1>{PRODUCT.headline}</h1>
        <SeverityChip productType="warning" />
        <SeverityChip productType="watch" />
        <SeverityChip productType="advisory" />
        <ProductStateBanner product={WEATHER_WATCH_FIXTURE} scenarioNow="2026-12-02T13:00:00Z" />
        <ProductStateBanner product={PRODUCT} published={[WEATHER_CANCEL_FIXTURE]} />
        <ProductTimes
          issuedScenarioTime={PRODUCT.publishedScenarioTime}
          effectiveScenarioTime={PRODUCT.payload.effectiveScenarioTime}
          expiresScenarioTime={PRODUCT.payload.expiresScenarioTime}
        />
        <IbwGrid ibw={PRODUCT.payload.ibw} />
        <ProductText product={PRODUCT} />
        <ProductImagery media={mediaFixture({ alt: 'Radar image over Kestrel County' })} />
      </main>
    </MemoryRouter>
  )
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

describe('weather product components: accessibility', () => {
  it('axe: no serious or critical violations', async () => {
    const { container } = render(<Page />)
    expect(await seriousAxeViolations(container)).toEqual([])
  })

  it('adds no interactive control of its own (its only targets come from ContentMedia, sized by F14)', () => {
    const { container } = render(
      <>
        <SeverityChip productType="warning" />
        <ProductStateBanner product={WEATHER_WATCH_FIXTURE} scenarioNow="2026-12-02T13:00:00Z" />
        <IbwGrid ibw={PRODUCT.payload.ibw} />
        <ProductText product={PRODUCT} />
      </>,
    )
    expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0)
  })

  it.each([
    'SeverityChip.module.css',
    'IbwGrid.module.css',
    'ProductText.module.css',
    'ProductTimes.module.css',
    'ProductStateBanner.module.css',
  ])('%s has no animation or transition, so reduced motion has nothing to stop', file => {
    const css = readSrcFile(`features/weather/components/product/${file}`)
    expect(css).not.toMatch(/\b(animation|transition)\s*:/)
  })
})
