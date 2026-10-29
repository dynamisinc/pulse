import { describe, expect, it } from 'vitest'
import { MOCK_PUBLISHED_ARTICLE } from '@/features/channels/mocks/fixtures'
import {
  WEATHER_FORECAST_FIXTURE,
  WEATHER_FORECAST_FIXTURES,
  WEATHER_PRODUCT_FIXTURES,
  WEATHER_UPGRADE_FIXTURE,
  WEATHER_WATCH_FIXTURE,
} from './fixtures'
import {
  isForecastDto,
  isForecastPayload,
  isForecastPeriod,
  isWeatherProductDto,
  isWeatherProductProjection,
} from './guards'

type Mutable = Record<string, unknown>

/** A deep copy of a fixture payload with one top-level key replaced. */
function withKey(payload: object, key: string, value: unknown): Mutable {
  const copy = structuredClone(payload) as Mutable
  copy[key] = value
  return copy
}

function withoutKey(payload: object, key: string): Mutable {
  const copy = structuredClone(payload) as Mutable
  delete copy[key]
  return copy
}

describe('isWeatherProductProjection (fails closed)', () => {
  const watch = WEATHER_WATCH_FIXTURE.payload
  const warning = WEATHER_UPGRADE_FIXTURE.payload

  it('accepts every product fixture', () => {
    for (const product of WEATHER_PRODUCT_FIXTURES) {
      expect(isWeatherProductProjection(product.payload)).toBe(true)
    }
  })

  it('tolerates an extra key (additive evolution)', () => {
    expect(isWeatherProductProjection(withKey(watch, 'futureField', 1))).toBe(true)
  })

  it.each([
    ['productType outside the vocabulary', 'productType', 'emergency'],
    ['hazard outside the closed list', 'hazard', 'meteor'],
    ['action outside the vocabulary', 'action', 'extend'],
    ['effective without an offset', 'effectiveScenarioTime', '2026-12-02T13:30:00'],
    ['expires not an instant', 'expiresScenarioTime', 'Dec 2 2026'],
    ['expires equal to effective', 'expiresScenarioTime', '2026-12-02T13:30:00Z'],
    ['expires before effective', 'expiresScenarioTime', '2026-12-02T13:00:00Z'],
    ['no zones', 'zoneSlugs', []],
    ['thirteen zones', 'zoneSlugs', Array.from({ length: 13 }, (_, i) => `zone-${i}`)],
    ['a non-slug zone', 'zoneSlugs', ['Kestrel County']],
    ['a duplicate zone', 'zoneSlugs', ['harbor-point', 'harbor-point']],
    ['nine actions', 'actions', Array.from({ length: 9 }, () => 'Act.')],
    ['an over-long action', 'actions', ['x'.repeat(301)]],
    ['an empty action', 'actions', ['']],
    ['a supersedes link on a new product', 'supersedesPermalink', '/weather/weather-desk/other'],
    ['ibw that is not an object', 'ibw', 'tornado'],
  ])('rejects %s', (_label, key, value) => {
    expect(isWeatherProductProjection(withKey(watch, key, value))).toBe(false)
  })

  it.each(['productType', 'hazard', 'action', 'zoneSlugs', 'effectiveScenarioTime', 'expiresScenarioTime', 'ibw', 'actions', 'supersedesPermalink'])(
    'rejects a payload missing %s',
    key => {
      expect(isWeatherProductProjection(withoutKey(watch, key))).toBe(false)
    },
  )

  it('requires the IBW block on a warning, but not on a watch', () => {
    expect(isWeatherProductProjection(withKey(warning, 'ibw', null))).toBe(false)
    expect(isWeatherProductProjection(withKey(watch, 'ibw', null))).toBe(true)
  })

  it('rejects an IBW block with an empty field', () => {
    const ibw = { ...warning.ibw, impacts: '' }
    expect(isWeatherProductProjection(withKey(warning, 'ibw', ibw))).toBe(false)
  })

  it('accepts a superseding product with no resolved link, but never an absolute or protocol-relative one', () => {
    expect(isWeatherProductProjection(withKey(warning, 'supersedesPermalink', null))).toBe(true)
    expect(isWeatherProductProjection(withKey(warning, 'supersedesPermalink', 'https://evil.test/x'))).toBe(false)
    expect(isWeatherProductProjection(withKey(warning, 'supersedesPermalink', '//evil.test/x'))).toBe(false)
  })

  it('rejects anything that is not an object', () => {
    for (const value of [null, undefined, 'watch', 42, []]) {
      expect(isWeatherProductProjection(value)).toBe(false)
    }
  })
})

describe('isForecastPayload (fails closed)', () => {
  const forecast = WEATHER_FORECAST_FIXTURE.payload
  const [period] = forecast.periods
  if (!period) throw new Error('the forecast fixture has periods')

  it('accepts both forecast fixtures (single temperatures and hi/lo pairs)', () => {
    for (const item of WEATHER_FORECAST_FIXTURES) {
      expect(isForecastPayload(item.payload)).toBe(true)
    }
  })

  it.each([
    ['a non-slug zone', 'zoneSlug', 'North County'],
    ['no periods', 'periods', []],
    ['fifteen periods', 'periods', Array.from({ length: 15 }, () => period)],
    ['a missing current block', 'current', null],
    ['an over-long discussion', 'discussion', 'x'.repeat(4001)],
    ['a non-string uncertainty note', 'uncertaintyNote', 3],
  ])('rejects %s', (_label, key, value) => {
    expect(isForecastPayload(withKey(forecast, key, value))).toBe(false)
  })

  it.each([
    ['a condition code outside the icon vocabulary', 'conditionCode', 'tornado'],
    ['a fractional temperature', 'tempF', 70.5],
    ['an impossible temperature', 'tempF', 200],
    ['precipitation over 100', 'precipPct', 101],
    ['an empty label', 'label', ''],
  ])('rejects a period with %s', (_label, key, value) => {
    expect(isForecastPeriod(withKey(period, key, value))).toBe(false)
  })

  it('needs exactly one of tempF or a hiF + loF pair, with hi not below lo', () => {
    const pair = { ...period, tempF: null, hiF: 70, loF: 50 }
    expect(isForecastPeriod(pair)).toBe(true)
    expect(isForecastPeriod({ ...pair, tempF: 60 })).toBe(false)
    expect(isForecastPeriod({ ...pair, loF: null })).toBe(false)
    expect(isForecastPeriod({ ...pair, hiF: 40 })).toBe(false)
    expect(isForecastPeriod({ ...period, tempF: null })).toBe(false)
  })

  it('rejects a current block with a bad code or humidity', () => {
    expect(isForecastPayload(withKey(forecast, 'current', { ...forecast.current, conditionCode: 'drizzle' }))).toBe(false)
    expect(isForecastPayload(withKey(forecast, 'current', { ...forecast.current, humidityPct: -1 }))).toBe(false)
  })
})

describe('DTO guards', () => {
  it('accept the fixtures under the FC-3 content guard', () => {
    for (const product of WEATHER_PRODUCT_FIXTURES) {
      expect(isWeatherProductDto(product)).toBe(true)
      expect(isForecastDto(product)).toBe(false)
    }

    for (const forecast of WEATHER_FORECAST_FIXTURES) {
      expect(isForecastDto(forecast)).toBe(true)
      expect(isWeatherProductDto(forecast)).toBe(false)
    }
  })

  it('reject another channel’s content and an out-of-shape payload', () => {
    expect(isWeatherProductDto(MOCK_PUBLISHED_ARTICLE)).toBe(false)
    expect(isWeatherProductDto({ ...WEATHER_WATCH_FIXTURE, payload: {} })).toBe(false)
    expect(isForecastDto({ ...WEATHER_FORECAST_FIXTURE, payload: { zoneSlug: 'kestrel-county-north' } })).toBe(false)
  })
})
