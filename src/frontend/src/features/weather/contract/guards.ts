/**
 * features/weather/contract/guards.ts
 * ---------------------------------------------------------------------------
 * Runtime guards for the weather payloads a client READS (weather-source story
 * 01, #752). Same discipline as the channels guards: an out-of-shape payload
 * fails CLOSED (false; the caller treats it as an error, never casts it), extra
 * keys are tolerated so the contract can grow additively. The guards re-check
 * the server's rules a renderer depends on — closed vocabularies, scenario-time
 * instants with an offset, expiry after effect, the IBW block on every
 * warning, host-relative links — so a bad payload can never half-render.
 *
 * World: both. No React, no MUI.
 */

import {
  isChannelContentDto,
  isHostRelativePath,
  isIsoScenarioTime,
  isSlug,
} from '@/features/channels/contract'
import type {
  ForecastCurrent,
  ForecastDto,
  ForecastPayload,
  ForecastPeriod,
  WeatherIbw,
  WeatherProductDto,
  WeatherProductProjection,
} from './types'
import {
  WEATHER_LIMITS,
  isWeatherConditionCode,
  isWeatherHazard,
  isWeatherProductAction,
  isWeatherProductType,
} from './vocabulary'

type Candidate = Record<string, unknown>

function asRecord(value: unknown): Candidate | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Candidate)
    : null
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isNullableText(value: unknown, max: number): value is string | null {
  return value === null || isText(value, max)
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isNullableTemp(value: unknown): value is number | null {
  return value === null || isWholeNumber(value, WEATHER_LIMITS.minTempF, WEATHER_LIMITS.maxTempF)
}

export function isWeatherIbw(value: unknown): value is WeatherIbw {
  const c = asRecord(value)
  const max = WEATHER_LIMITS.ibwFieldMaxLength
  return (
    !!c &&
    isText(c.what, max) &&
    isText(c.where, max) &&
    isText(c.when, max) &&
    isText(c.impacts, max)
  )
}

/** The participant-safe `weather_product` payload. */
export function isWeatherProductProjection(value: unknown): value is WeatherProductProjection {
  const c = asRecord(value)
  if (
    !c ||
    !isWeatherProductType(c.productType) ||
    !isWeatherHazard(c.hazard) ||
    !isWeatherProductAction(c.action) ||
    !isIsoScenarioTime(c.effectiveScenarioTime) ||
    !isIsoScenarioTime(c.expiresScenarioTime) ||
    Date.parse(c.expiresScenarioTime) <= Date.parse(c.effectiveScenarioTime)
  ) {
    return false
  }

  const zones = c.zoneSlugs
  if (
    !Array.isArray(zones) ||
    zones.length < 1 ||
    zones.length > WEATHER_LIMITS.maxZones ||
    !zones.every(isSlug) ||
    new Set(zones).size !== zones.length
  ) {
    return false
  }

  const actions = c.actions
  if (
    !Array.isArray(actions) ||
    actions.length > WEATHER_LIMITS.maxActions ||
    !actions.every(a => isText(a, WEATHER_LIMITS.actionMaxLength))
  ) {
    return false
  }

  // A `new` product supersedes nothing; the others carry the server-derived link (or null).
  const supersedes = c.supersedesPermalink
  const supersedesOk =
    c.action === 'new' ? supersedes === null : supersedes === null || isHostRelativePath(supersedes)
  // The IBW block is required on a warning (WX-010).
  const ibwOk = c.ibw === null ? c.productType !== 'warning' : isWeatherIbw(c.ibw)
  return supersedesOk && ibwOk
}

export function isForecastCurrent(value: unknown): value is ForecastCurrent {
  const c = asRecord(value)
  return (
    !!c &&
    isWholeNumber(c.tempF, WEATHER_LIMITS.minTempF, WEATHER_LIMITS.maxTempF) &&
    isText(c.condition, WEATHER_LIMITS.shortTextMaxLength) &&
    isWeatherConditionCode(c.conditionCode) &&
    isWholeNumber(c.windMph, 0, WEATHER_LIMITS.maxWindMph) &&
    isText(c.windDir, WEATHER_LIMITS.windDirMaxLength) &&
    isWholeNumber(c.humidityPct, 0, 100) &&
    isIsoScenarioTime(c.observedScenarioTime)
  )
}

export function isForecastPeriod(value: unknown): value is ForecastPeriod {
  const c = asRecord(value)
  if (!c || !isNullableTemp(c.tempF) || !isNullableTemp(c.hiF) || !isNullableTemp(c.loF)) {
    return false
  }

  // Exactly one of tempF or the hiF + loF pair; never a lone hi or lo, never hi below lo.
  const single = c.tempF !== null && c.hiF === null && c.loF === null
  const pair =
    c.tempF === null && typeof c.hiF === 'number' && typeof c.loF === 'number' && c.hiF >= c.loF
  return (
    (single || pair) &&
    isText(c.label, WEATHER_LIMITS.shortTextMaxLength) &&
    isText(c.condition, WEATHER_LIMITS.shortTextMaxLength) &&
    isWeatherConditionCode(c.conditionCode) &&
    isWholeNumber(c.precipPct, 0, 100) &&
    isText(c.windText, WEATHER_LIMITS.shortTextMaxLength) &&
    isText(c.detail, WEATHER_LIMITS.periodDetailMaxLength)
  )
}

/** The `forecast` payload. */
export function isForecastPayload(value: unknown): value is ForecastPayload {
  const c = asRecord(value)
  return (
    !!c &&
    isSlug(c.zoneSlug) &&
    isForecastCurrent(c.current) &&
    Array.isArray(c.periods) &&
    c.periods.length >= 1 &&
    c.periods.length <= WEATHER_LIMITS.maxPeriods &&
    c.periods.every(isForecastPeriod) &&
    isNullableText(c.discussion, WEATHER_LIMITS.discussionMaxLength) &&
    isNullableText(c.uncertaintyNote, WEATHER_LIMITS.uncertaintyNoteMaxLength)
  )
}

/** A published weather product DTO: the FC-3 content guard plus the payload guard. */
export function isWeatherProductDto(value: unknown): value is WeatherProductDto {
  return (
    isChannelContentDto(value) &&
    value.channelId === 'weather' &&
    value.kind === 'weather_product' &&
    isWeatherProductProjection(value.payload)
  )
}

/** A published forecast DTO. */
export function isForecastDto(value: unknown): value is ForecastDto {
  return (
    isChannelContentDto(value) &&
    value.channelId === 'weather' &&
    value.kind === 'forecast' &&
    isForecastPayload(value.payload)
  )
}
