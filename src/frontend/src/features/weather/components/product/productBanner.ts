/**
 * features/weather/components/product/productBanner.ts
 * ---------------------------------------------------------------------------
 * The pure state-banner model behind `ProductStateBanner` (weather-source
 * story 07, #758; COR-053). No React, no DOM, no clock: the caller passes the
 * scenario "now".
 *
 *   active    -> no banner ("IN EFFECT UNTIL …" is the default reading)
 *   pending   -> "EFFECTIVE IN 2 HR 5 MIN"
 *   expired   -> "EXPIRED"
 *   cancelled -> "CANCELLED"
 *
 * The countdown is pure instant arithmetic on the millisecond delta (never
 * calendar math, which runs in the browser zone), rounded UP to the minute so
 * it never reads "IN 0 MIN" while the product is still pending.
 */

import { productState } from '@/features/weather/contract'
import type { WeatherProductState, WeatherProductStateSubject } from '@/features/weather/contract'

export interface ProductBannerModel {
  readonly state: Exclude<WeatherProductState, 'active'>
  readonly text: string
}

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

/** "2 HR 5 MIN", "1 DAY 3 HR", "45 MIN": the two largest non-zero units, at least 1 MIN. */
export function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / MINUTE_MS))
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY)
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  const parts = [
    days > 0 ? `${days} ${days === 1 ? 'DAY' : 'DAYS'}` : null,
    hours > 0 ? `${hours} HR` : null,
    minutes > 0 ? `${minutes} MIN` : null,
  ].filter((part): part is string => part !== null)
  return parts.slice(0, 2).join(' ')
}

function instant(value: Date | string): number {
  return typeof value === 'string' ? Date.parse(value) : value.getTime()
}

/**
 * The banner for `product` at `scenarioNow`, or null when it is active (no
 * banner). `published` is the other published products the caller holds, so a
 * published cancel shows "CANCELLED" (see `productState`).
 */
export function productBanner(
  product: WeatherProductStateSubject,
  scenarioNow: Date | string,
  published: readonly WeatherProductStateSubject[] = [],
): ProductBannerModel | null {
  const state = productState(product, scenarioNow, published)
  switch (state) {
    case 'active':
      return null
    case 'pending': {
      const ms = Date.parse(product.payload.effectiveScenarioTime) - instant(scenarioNow)
      return { state, text: `EFFECTIVE IN ${formatCountdown(ms)}` }
    }
    case 'expired':
      return { state, text: 'EXPIRED' }
    case 'cancelled':
      return { state, text: 'CANCELLED' }
  }
}
