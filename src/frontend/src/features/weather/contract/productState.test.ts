import { describe, expect, it } from 'vitest'
import {
  WEATHER_CANCEL_FIXTURE,
  WEATHER_PRODUCT_FIXTURES,
  WEATHER_UPGRADE_FIXTURE,
  WEATHER_WARNING_FIXTURE,
  WEATHER_WATCH_FIXTURE,
} from './fixtures'
import { isCancelledBy, productState, weatherSeverityKey } from './productState'

describe('productState over the fixture storm (scenario time only, COR-053)', () => {
  const published = WEATHER_PRODUCT_FIXTURES
  // What a site read at `now` would hold: only products already published (story 03).
  const publishedAt = (now: string) =>
    published.filter(p => Date.parse(p.publishedScenarioTime) <= Date.parse(now))

  it.each([
    // [label, scenario now, watch, upgrade (tornado warning), flash flood warning]
    ['before anything is effective', '2026-12-02T13:00:00Z', 'pending', 'pending', 'pending'],
    ['the watch is up', '2026-12-02T13:45:00Z', 'active', 'pending', 'pending'],
    ['the warning is up, the watch still runs', '2026-12-02T14:30:00Z', 'active', 'active', 'pending'],
    ['the warning is cancelled early', '2026-12-02T15:00:00Z', 'active', 'cancelled', 'active'],
    ['the flood warning is up', '2026-12-02T16:00:00Z', 'active', 'cancelled', 'active'],
    ['everything has run out', '2026-12-02T19:00:00Z', 'expired', 'cancelled', 'expired'],
  ] as const)('%s', (_label, now, watch, upgrade, flood) => {
    expect(productState(WEATHER_WATCH_FIXTURE, now, publishedAt(now))).toBe(watch)
    expect(productState(WEATHER_UPGRADE_FIXTURE, now, publishedAt(now))).toBe(upgrade)
    expect(productState(WEATHER_WARNING_FIXTURE, now, publishedAt(now))).toBe(flood)
  })

  it('a cancel only cancels when the caller holds it: without the list the warning runs on its own times', () => {
    expect(productState(WEATHER_UPGRADE_FIXTURE, '2026-12-02T14:30:00Z')).toBe('active')
    expect(productState(WEATHER_UPGRADE_FIXTURE, '2026-12-02T15:15:00Z')).toBe('expired')
  })

  it('a cancel cancels only the product it supersedes, never itself or an upgrade target', () => {
    expect(isCancelledBy(WEATHER_UPGRADE_FIXTURE, published)).toBe(true)
    expect(isCancelledBy(WEATHER_CANCEL_FIXTURE, published)).toBe(false)
    // The upgrade supersedes the watch, but an upgrade is not a cancel.
    expect(isCancelledBy(WEATHER_WATCH_FIXTURE, published)).toBe(false)
    expect(isCancelledBy(WEATHER_WARNING_FIXTURE, published)).toBe(false)
  })

  it('the cancel product itself follows its own times', () => {
    expect(productState(WEATHER_CANCEL_FIXTURE, '2026-12-02T15:00:00Z', published)).toBe('active')
  })
})

describe('weatherSeverityKey', () => {
  it('is the product type, for every fixture', () => {
    expect(weatherSeverityKey(WEATHER_WATCH_FIXTURE)).toBe('watch')
    expect(weatherSeverityKey(WEATHER_UPGRADE_FIXTURE)).toBe('warning')
    expect(weatherSeverityKey(WEATHER_WARNING_FIXTURE)).toBe('warning')
    expect(weatherSeverityKey({ payload: { productType: 'advisory' } })).toBe('advisory')
  })
})
