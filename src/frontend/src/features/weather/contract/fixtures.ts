/**
 * features/weather/contract/fixtures.ts
 * ---------------------------------------------------------------------------
 * Canned weather content (weather-source story 01, #752): a watch, a warning,
 * an upgrade (watch → warning), a cancel of that upgrade, and two forecasts
 * for the same zone that disagree (WX-003). Every fixture is typed against the
 * contract AND passes its runtime guard (fixtures.test.ts).
 *
 * FICTIONAL by rule (WX-001, story 14's scan): no real forecast office,
 * agency, county code or URL; the zones are invented places. Every instant is
 * SCENARIO time (COR-053); every link is host-relative (FC-9.3). The outlet is
 * the channels mock's Weather Desk (same id), so the two mock sets compose.
 *
 * World: both (data only).
 */

import { contentPermalink } from '@/features/channels/contract'
import type { OutletRefDto } from '@/features/channels/contract'
import type { ForecastDto, WeatherProductDto } from './types'

const weatherDesk: OutletRefDto = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a03',
  channelId: 'weather',
  slug: 'weather-desk',
  name: 'The Weather Desk',
  skinKey: 'weather-desk',
}

/** The fictional zones the fixtures name. */
export const WEATHER_FIXTURE_ZONES = ['kestrel-county-north', 'kestrel-county-south', 'harbor-point'] as const

const productBase = {
  channelId: 'weather',
  kind: 'weather_product',
  outlet: weatherDesk,
  state: 'published',
  dek: null,
  kicker: null,
  category: null,
  hero: null,
  updatedScenarioTime: null,
  featured: false,
  byline: null,
  media: [],
  revisions: [],
  pairedPostId: null,
  alertId: null,
} as const

/** A tornado watch for the north and south county zones (new issuance). */
export const WEATHER_WATCH_FIXTURE: WeatherProductDto = {
  ...productBase,
  id: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70a01',
  slug: 'tornado-watch-1',
  permalink: contentPermalink('weather', 'weather-desk', 'tornado-watch-1'),
  headline: 'Tornado Watch in effect for Kestrel County until 7 PM',
  publishedScenarioTime: '2026-12-02T13:25:00Z',
  bodyHtml: 'Conditions are favorable for tornadoes in and near the watch area.',
  pairedPostId: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70b01',
  alertId: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70c01',
  payload: {
    productType: 'watch',
    hazard: 'tornado',
    action: 'new',
    supersedesPermalink: null,
    zoneSlugs: ['kestrel-county-north', 'kestrel-county-south'],
    effectiveScenarioTime: '2026-12-02T13:30:00Z',
    expiresScenarioTime: '2026-12-02T19:00:00Z',
    ibw: null,
    actions: ['Review your shelter plan.', 'Keep a way to receive warnings close by.'],
  },
}

/** The watch upgraded to a tornado warning for the north zone. */
export const WEATHER_UPGRADE_FIXTURE: WeatherProductDto = {
  ...productBase,
  id: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70a02',
  slug: 'tornado-warning-1',
  permalink: contentPermalink('weather', 'weather-desk', 'tornado-warning-1'),
  headline: 'Tornado Warning for northern Kestrel County until 3:15 PM',
  publishedScenarioTime: '2026-12-02T14:20:00Z',
  bodyHtml: 'At 2:18 PM, a storm capable of producing a tornado was located near Alder Ridge, moving northeast at 30 mph.',
  alertId: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70c02',
  payload: {
    productType: 'warning',
    hazard: 'tornado',
    action: 'upgrade',
    supersedesPermalink: contentPermalink('weather', 'weather-desk', 'tornado-watch-1'),
    zoneSlugs: ['kestrel-county-north'],
    effectiveScenarioTime: '2026-12-02T14:20:00Z',
    expiresScenarioTime: '2026-12-02T15:15:00Z',
    ibw: {
      what: 'Radar-indicated tornado.',
      where: 'Northern Kestrel County, including Alder Ridge and Millbrook.',
      when: 'Until 3:15 PM.',
      impacts: 'Flying debris will be dangerous to those caught without shelter. Mobile homes will be damaged or destroyed.',
    },
    actions: ['Take shelter now in a basement or an interior room on the lowest floor.'],
  },
}

/** A flash flood warning for the coast (a new issuance, no supersession). */
export const WEATHER_WARNING_FIXTURE: WeatherProductDto = {
  ...productBase,
  id: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70a03',
  slug: 'flash-flood-warning-1',
  permalink: contentPermalink('weather', 'weather-desk', 'flash-flood-warning-1'),
  headline: 'Flash Flood Warning for Harbor Point until 6 PM',
  publishedScenarioTime: '2026-12-02T15:00:00Z',
  bodyHtml: 'Heavy rain is falling over Harbor Point. Two to three inches have fallen in the last hour.',
  alertId: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70c03',
  payload: {
    productType: 'warning',
    hazard: 'flash_flood',
    action: 'new',
    supersedesPermalink: null,
    zoneSlugs: ['harbor-point'],
    effectiveScenarioTime: '2026-12-02T15:00:00Z',
    expiresScenarioTime: '2026-12-02T18:00:00Z',
    ibw: {
      what: 'Flash flooding caused by thunderstorms.',
      where: 'Harbor Point, including the Lower Quay and Canal Street.',
      when: 'Until 6 PM.',
      impacts: 'Flooding of low-water crossings, small streams and urban streets.',
    },
    actions: ['Turn around, do not drown.', 'Move to higher ground now.'],
  },
}

/** The tornado warning cancelled early: the storm has weakened. */
export const WEATHER_CANCEL_FIXTURE: WeatherProductDto = {
  ...productBase,
  id: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70a04',
  slug: 'tornado-warning-1-cancel',
  permalink: contentPermalink('weather', 'weather-desk', 'tornado-warning-1-cancel'),
  headline: 'Tornado Warning for northern Kestrel County is cancelled',
  publishedScenarioTime: '2026-12-02T14:55:00Z',
  bodyHtml: 'The storm that prompted the warning has weakened and no longer poses an immediate threat.',
  payload: {
    productType: 'warning',
    hazard: 'tornado',
    action: 'cancel',
    supersedesPermalink: contentPermalink('weather', 'weather-desk', 'tornado-warning-1'),
    zoneSlugs: ['kestrel-county-north'],
    effectiveScenarioTime: '2026-12-02T14:55:00Z',
    expiresScenarioTime: '2026-12-02T15:15:00Z',
    ibw: {
      what: 'The tornado threat has ended.',
      where: 'Northern Kestrel County.',
      when: 'Effective now.',
      impacts: 'None expected; heavy rain may continue.',
    },
    actions: [],
  },
}

const forecastBase = {
  channelId: 'weather',
  kind: 'forecast',
  outlet: weatherDesk,
  state: 'published',
  dek: null,
  kicker: null,
  category: null,
  hero: null,
  updatedScenarioTime: null,
  featured: false,
  byline: null,
  bodyHtml: '',
  media: [],
  revisions: [],
  pairedPostId: null,
  alertId: null,
} as const

/** The morning forecast for the north zone (single temperatures). */
export const WEATHER_FORECAST_FIXTURE: ForecastDto = {
  ...forecastBase,
  id: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70d01',
  slug: 'forecast-north-am',
  permalink: contentPermalink('weather', 'weather-desk', 'forecast-north-am'),
  headline: 'Forecast for northern Kestrel County',
  publishedScenarioTime: '2026-12-02T11:00:00Z',
  payload: {
    zoneSlug: 'kestrel-county-north',
    current: {
      tempF: 68,
      condition: 'Partly Cloudy',
      conditionCode: 'partly_cloudy',
      windMph: 12,
      windDir: 'S',
      humidityPct: 74,
      observedScenarioTime: '2026-12-02T10:55:00Z',
    },
    periods: [
      {
        label: 'This Afternoon',
        tempF: 74,
        hiF: null,
        loF: null,
        condition: 'Thunderstorms Likely',
        conditionCode: 'thunderstorms',
        precipPct: 70,
        windText: 'S 15 to 20 mph',
        detail: 'Thunderstorms likely after 1 PM. Some storms could be severe.',
      },
      {
        label: 'Tonight',
        tempF: 52,
        hiF: null,
        loF: null,
        condition: 'Showers',
        conditionCode: 'showers',
        precipPct: 50,
        windText: 'NW 10 mph',
        detail: 'Showers ending after midnight.',
      },
    ],
    discussion: 'A strong cold front crosses the county this afternoon.',
    uncertaintyNote: null,
  },
}

/**
 * A later forecast for the SAME zone that differs from the first (WX-003):
 * hi/lo pairs, a revised discussion and an uncertainty note.
 */
export const WEATHER_FORECAST_UPDATE_FIXTURE: ForecastDto = {
  ...forecastBase,
  id: '3e7a1c90-5b2d-4f6e-8a10-c4d5e6f70d02',
  slug: 'forecast-north-pm',
  permalink: contentPermalink('weather', 'weather-desk', 'forecast-north-pm'),
  headline: 'Updated forecast for northern Kestrel County',
  publishedScenarioTime: '2026-12-02T16:00:00Z',
  payload: {
    zoneSlug: 'kestrel-county-north',
    current: {
      tempF: 58,
      condition: 'Rain',
      conditionCode: 'rain',
      windMph: 18,
      windDir: 'NW',
      humidityPct: 92,
      observedScenarioTime: '2026-12-02T15:55:00Z',
    },
    periods: [
      {
        label: 'Tonight',
        tempF: null,
        hiF: 58,
        loF: 41,
        condition: 'Rain Ending',
        conditionCode: 'rain',
        precipPct: 60,
        windText: 'NW 15 to 25 mph',
        detail: 'Rain ending by 9 PM, then clearing. Turning colder.',
      },
      {
        label: 'Thursday',
        tempF: null,
        hiF: 47,
        loF: 33,
        condition: 'Sunny',
        conditionCode: 'clear',
        precipPct: 0,
        windText: 'W 10 mph',
        detail: 'Sunny and cooler.',
      },
    ],
    discussion: 'The front moved through faster than expected; the severe threat has ended.',
    uncertaintyNote: 'Overnight lows depend on how quickly the clouds clear.',
  },
}

/** Every product fixture, in issuance order. */
export const WEATHER_PRODUCT_FIXTURES: readonly WeatherProductDto[] = [
  WEATHER_WATCH_FIXTURE,
  WEATHER_UPGRADE_FIXTURE,
  WEATHER_CANCEL_FIXTURE,
  WEATHER_WARNING_FIXTURE,
]

/** Both forecast fixtures, in issuance order. */
export const WEATHER_FORECAST_FIXTURES: readonly ForecastDto[] = [
  WEATHER_FORECAST_FIXTURE,
  WEATHER_FORECAST_UPDATE_FIXTURE,
]
