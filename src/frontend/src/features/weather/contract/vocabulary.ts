/**
 * features/weather/contract/vocabulary.ts
 * ---------------------------------------------------------------------------
 * The weather payload vocabulary (weather-source story 01, #752; WX-010,
 * WX-001/003). The TS twin of `Features/Weather/Contracts/WeatherVocabulary.cs`:
 * every list and limit here equals the C# one, both pinned by
 * `weatherContract.json` (weatherContract.test.ts on this side,
 * WeatherContractParityTests on the server).
 *
 * There is deliberately no severity: the alert severity is derived from the
 * product type in one place (story 04's `WeatherAlertSeverityMap`). No VTEC,
 * UGC or SAME codes.
 *
 * World: both (types only). No React, no MUI.
 */

/** Product types. A warning's IBW block is required and its alert cannot be switched off. */
export const WEATHER_PRODUCT_TYPES = ['watch', 'warning', 'advisory'] as const
export type WeatherProductType = (typeof WEATHER_PRODUCT_TYPES)[number]

/** The closed hazard list (WX-010). `other` is the escape hatch. */
export const WEATHER_HAZARDS = [
  'tornado',
  'severe_thunderstorm',
  'flash_flood',
  'flood',
  'hurricane',
  'tropical_storm',
  'storm_surge',
  'winter_storm',
  'blizzard',
  'ice_storm',
  'extreme_heat',
  'extreme_cold',
  'high_wind',
  'wildfire_smoke',
  'dense_fog',
  'other',
] as const
export type WeatherHazard = (typeof WEATHER_HAZARDS)[number]

/** Product actions. Every one but `new` supersedes a published product. */
export const WEATHER_PRODUCT_ACTIONS = ['new', 'update', 'upgrade', 'cancel'] as const
export type WeatherProductAction = (typeof WEATHER_PRODUCT_ACTIONS)[number]

/** The actions that must name the product they supersede. */
export const WEATHER_SUPERSEDING_ACTIONS = ['update', 'upgrade', 'cancel'] as const

/** The closed condition-icon vocabulary for current conditions and forecast periods. */
export const WEATHER_CONDITION_CODES = [
  'clear',
  'partly_cloudy',
  'cloudy',
  'rain',
  'showers',
  'thunderstorms',
  'snow',
  'sleet',
  'fog',
  'wind',
  'hot',
  'cold',
] as const
export type WeatherConditionCode = (typeof WEATHER_CONDITION_CODES)[number]

/** What `productState` returns. */
export const WEATHER_PRODUCT_STATES = ['pending', 'active', 'expired', 'cancelled'] as const
export type WeatherProductState = (typeof WEATHER_PRODUCT_STATES)[number]

/**
 * The payload bounds (`WeatherLimits.cs`). Strings are measured after the
 * server's plain-text cleaning; over-long values are rejected, never truncated.
 */
export const WEATHER_LIMITS = {
  narrativeMaxLength: 4000,
  headlineMaxLength: 200,
  ibwFieldMaxLength: 1000,
  actionMaxLength: 300,
  maxActions: 8,
  maxZones: 12,
  maxPeriods: 14,
  discussionMaxLength: 4000,
  uncertaintyNoteMaxLength: 1000,
  periodDetailMaxLength: 1000,
  shortTextMaxLength: 100,
  windDirMaxLength: 16,
  postTextMaxCodePoints: 280,
  minTempF: -80,
  maxTempF: 140,
  maxWindMph: 250,
} as const

function isOneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
}

export const isWeatherProductType = isOneOf(WEATHER_PRODUCT_TYPES)
export const isWeatherHazard = isOneOf(WEATHER_HAZARDS)
export const isWeatherProductAction = isOneOf(WEATHER_PRODUCT_ACTIONS)
export const isWeatherConditionCode = isOneOf(WEATHER_CONDITION_CODES)
