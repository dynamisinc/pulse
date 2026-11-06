import { describe, expect, it } from 'vitest'
import {
  WEATHER_CANCEL_FIXTURE,
  WEATHER_FIXTURE_ZONES,
  WEATHER_FORECAST_FIXTURES,
  WEATHER_PRODUCT_FIXTURES,
  WEATHER_UPGRADE_FIXTURE,
  WEATHER_WARNING_FIXTURE,
  WEATHER_WATCH_FIXTURE,
} from './fixtures'
import { isForecastDto, isWeatherProductDto } from './guards'

const ALL_FIXTURES = [...WEATHER_PRODUCT_FIXTURES, ...WEATHER_FORECAST_FIXTURES]

describe('weather fixtures', () => {
  it('cover a watch, a warning, an upgrade, a cancel and two forecasts', () => {
    expect(WEATHER_WATCH_FIXTURE.payload.productType).toBe('watch')
    expect(WEATHER_WARNING_FIXTURE.payload).toMatchObject({ productType: 'warning', action: 'new' })
    expect(WEATHER_UPGRADE_FIXTURE.payload).toMatchObject({
      action: 'upgrade',
      supersedesPermalink: WEATHER_WATCH_FIXTURE.permalink,
    })
    expect(WEATHER_CANCEL_FIXTURE.payload).toMatchObject({
      action: 'cancel',
      supersedesPermalink: WEATHER_UPGRADE_FIXTURE.permalink,
    })
    expect(WEATHER_FORECAST_FIXTURES).toHaveLength(2)
  })

  it('every fixture passes its runtime guard', () => {
    for (const product of WEATHER_PRODUCT_FIXTURES) {
      expect(isWeatherProductDto(product)).toBe(true)
    }

    for (const forecast of WEATHER_FORECAST_FIXTURES) {
      expect(isForecastDto(forecast)).toBe(true)
    }
  })

  it('two forecasts for the same zone may disagree (WX-003)', () => {
    const [first, later] = WEATHER_FORECAST_FIXTURES
    expect(later?.payload.zoneSlug).toBe(first?.payload.zoneSlug)
    expect(later?.payload.current.tempF).not.toBe(first?.payload.current.tempF)
  })

  it('only name the fictional fixture zones', () => {
    const zones = new Set<string>(WEATHER_FIXTURE_ZONES)
    for (const product of WEATHER_PRODUCT_FIXTURES) {
      expect(product.payload.zoneSlugs.every(z => zones.has(z))).toBe(true)
    }

    for (const forecast of WEATHER_FORECAST_FIXTURES) {
      expect(zones.has(forecast.payload.zoneSlug)).toBe(true)
    }
  })

  it('contain no absolute URL or hostname (FC-9.3)', () => {
    const text = JSON.stringify(ALL_FIXTURES)
    expect(text).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i)
    expect(text).not.toMatch(/"\/\//)
    expect(text).not.toMatch(/www\./i)
  })

  it('are fictional: no real agency, office or county code (WX-001)', () => {
    const text = JSON.stringify(ALL_FIXTURES)
    const banned = [
      /National Weather Service/i,
      /\bNWS\b/,
      /\bNOAA\b/i,
      /weather\.gov/i,
      /\bWFO\b/,
      /\bFIPS\b/i,
      /\bVTEC\b/i,
      /\bSAME\b/,
    ]
    for (const pattern of banned) {
      expect(text).not.toMatch(pattern)
    }

    // A five-digit FIPS-like county code anywhere in the copy.
    expect(text).not.toMatch(/\b\d{5}\b/)
  })
})
