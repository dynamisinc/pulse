/**
 * features/weather/contract/productState.ts
 * ---------------------------------------------------------------------------
 * The pure product-state and severity-key functions (weather-source story 01,
 * #752). `productState` is the client twin of the server's
 * `WeatherProductStates.Compute`; both run the shared `productStateCases` in
 * `weatherContract.json`, so the site (story 03, server) and the components
 * (story 07, client) can never disagree.
 *
 * Resolved against SCENARIO time only (COR-053): pass the shell's
 * `scenarioNow()` — never `Date.now()` — so a time jump flips the state
 * without a refetch.
 *
 * World: both. No React, no MUI.
 */

import type { WeatherProductProjection } from './types'
import type { WeatherProductState, WeatherProductType } from './vocabulary'

/** What `productState` reads from a product: a `WeatherProductDto` satisfies it. */
export interface WeatherProductStateSubject {
  readonly permalink: string
  readonly payload: Pick<
    WeatherProductProjection,
    'action' | 'supersedesPermalink' | 'effectiveScenarioTime' | 'expiresScenarioTime'
  >
}

function instant(value: Date | string): number {
  return typeof value === 'string' ? Date.parse(value) : value.getTime()
}

/**
 * Whether a published `cancel` product in `published` supersedes `product`.
 * Matching is by permalink, the only supersession detail a participant sees.
 */
export function isCancelledBy(
  product: WeatherProductStateSubject,
  published: readonly WeatherProductStateSubject[],
): boolean {
  return published.some(
    other =>
      other !== product &&
      other.permalink !== product.permalink &&
      other.payload.action === 'cancel' &&
      other.payload.supersedesPermalink === product.permalink,
  )
}

/**
 * A product's state at `scenarioNow`: `cancelled` when a published `cancel`
 * product in `published` supersedes it (it wins over every time-based state),
 * else `pending` before effective, `expired` from expiry on, else `active`.
 *
 * @param product The product.
 * @param scenarioNow The exercise's scenario now (a `Date` from `scenarioNow()` or an ISO instant).
 * @param published The other published weather products the caller holds (the site list); optional.
 */
export function productState(
  product: WeatherProductStateSubject,
  scenarioNow: Date | string,
  published: readonly WeatherProductStateSubject[] = [],
): WeatherProductState {
  if (isCancelledBy(product, published)) {
    return 'cancelled'
  }

  const now = instant(scenarioNow)
  if (now < Date.parse(product.payload.effectiveScenarioTime)) {
    return 'pending'
  }

  return now >= Date.parse(product.payload.expiresScenarioTime) ? 'expired' : 'active'
}

/** The styling key a product renders under (chip, banner, tile tokens). */
export type WeatherSeverityKey = WeatherProductType

/**
 * The severity key for a product: its product type (`warning` / `watch` /
 * `advisory`). The ALERT severity (emergency / advisory / info) is a different
 * thing, derived server-side by story 04's `WeatherAlertSeverityMap`; this key
 * only selects the product's own presentation (icon + text + color, never
 * color-only, NFR-001).
 */
export function weatherSeverityKey(product: {
  readonly payload: Pick<WeatherProductProjection, 'productType'>
}): WeatherSeverityKey {
  return product.payload.productType
}
