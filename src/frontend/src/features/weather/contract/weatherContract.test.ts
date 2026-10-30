import { describe, expect, it } from 'vitest'
import contract from './weatherContract.json'
import { productState } from './productState'
import type { WeatherProductStateSubject } from './productState'
import { WEATHER_SHAPE_KEYS } from './types'
import {
  WEATHER_CONDITION_CODES,
  WEATHER_HAZARDS,
  WEATHER_LIMITS,
  WEATHER_PRODUCT_ACTIONS,
  WEATHER_PRODUCT_STATES,
  WEATHER_PRODUCT_TYPES,
  WEATHER_SUPERSEDING_ACTIONS,
} from './vocabulary'

/**
 * Weather-source story 01 (#752): the TS half of the C#↔TS parity check.
 * `weatherContract.json` is the one golden file; the server's
 * WeatherContractParityTests asserts WeatherVocabulary, WeatherLimits, the
 * payload records and WeatherProductStates against the same file.
 */
describe('weather payload contract (WX-010, WX-001/003)', () => {
  it.each([
    ['productTypes', WEATHER_PRODUCT_TYPES],
    ['hazards', WEATHER_HAZARDS],
    ['productActions', WEATHER_PRODUCT_ACTIONS],
    ['supersedingActions', WEATHER_SUPERSEDING_ACTIONS],
    ['conditionCodes', WEATHER_CONDITION_CODES],
    ['productStates', WEATHER_PRODUCT_STATES],
  ] as const)('vocabulary.ts %s equals the golden list, in order', (name, values) => {
    expect([...values]).toEqual(contract.vocabulary[name])
  })

  it('WEATHER_LIMITS equals the golden limits', () => {
    expect({ ...WEATHER_LIMITS }).toEqual(contract.limits)
  })

  it('pins every shape the golden file names, and only those', () => {
    expect(Object.keys(WEATHER_SHAPE_KEYS).sort()).toEqual(Object.keys(contract.shapes).sort())
  })

  it.each(Object.entries(contract.shapes))('%s key set equals the golden key set', (name, keys) => {
    const tsKeys: readonly string[] = WEATHER_SHAPE_KEYS[name as keyof typeof WEATHER_SHAPE_KEYS]
    expect([...tsKeys].sort()).toEqual([...keys].sort())
  })

  it.each(contract.participantShapes)('participant shape %s carries no staff-only key (XC-002)', name => {
    const keys: readonly string[] = WEATHER_SHAPE_KEYS[name as keyof typeof WEATHER_SHAPE_KEYS]
    expect(keys.filter(k => contract.participantExcludedKeys.includes(k))).toEqual([])
  })

  it.each(contract.productStateCases)('productState: $name → $expected', c => {
    const product: WeatherProductStateSubject = {
      permalink: '/weather/weather-desk/subject',
      payload: {
        action: 'new',
        supersedesPermalink: null,
        effectiveScenarioTime: c.effective,
        expiresScenarioTime: c.expires,
      },
    }
    const cancel: WeatherProductStateSubject = {
      permalink: '/weather/weather-desk/subject-cancel',
      payload: {
        action: 'cancel',
        supersedesPermalink: product.permalink,
        effectiveScenarioTime: c.effective,
        expiresScenarioTime: c.expires,
      },
    }
    const published = c.cancelled ? [product, cancel] : [product]

    expect(productState(product, c.now, published)).toBe(c.expected)
    expect(productState(product, new Date(c.now), published)).toBe(c.expected)
  })
})
