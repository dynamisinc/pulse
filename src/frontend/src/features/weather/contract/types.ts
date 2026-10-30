/**
 * features/weather/contract/types.ts
 * ---------------------------------------------------------------------------
 * The weather payload wire shapes (weather-source story 01, #752). The TS twin
 * of `Features/Weather/Contracts/WeatherPayloads.cs`; every key list is pinned
 * by `weatherContract.json` on both sides.
 *
 * Participant shapes (`WeatherProductProjection`, `ForecastPayload`) are the
 * `payload` of a `ChannelContentDto` (FC-3): headline, dek, narrative
 * (`bodyHtml`), media and permalink are the foundation's and are not repeated.
 * Staff shapes (`WeatherProductPayload` with its `delivery` block) are what the
 * editors (story 11) write; a participant never receives them (XC-002).
 *
 * Every instant is a SCENARIO-time ISO string (COR-053). Units are US customary.
 *
 * World: both (types only). No React, no MUI.
 */

import type { ChannelContentDto } from '@/features/channels/contract'
import { wireKeys } from '@/features/channels/contract'
import type {
  WeatherConditionCode,
  WeatherHazard,
  WeatherProductAction,
  WeatherProductType,
} from './vocabulary'

/** The impact-based warning block (plain text). */
export interface WeatherIbw {
  readonly what: string
  readonly where: string
  readonly when: string
  readonly impacts: string
}
export const WEATHER_IBW_KEYS = wireKeys<WeatherIbw>()(['what', 'where', 'when', 'impacts'])

/** The participant-safe `weather_product` payload: no delivery block, no content ids. */
export interface WeatherProductProjection {
  readonly productType: WeatherProductType
  readonly hazard: WeatherHazard
  readonly action: WeatherProductAction
  /** The superseded product's host-relative permalink (update / upgrade / cancel), else null. */
  readonly supersedesPermalink: string | null
  readonly zoneSlugs: readonly string[]
  readonly effectiveScenarioTime: string
  readonly expiresScenarioTime: string
  /** Always set on a warning; optional on a watch or advisory. */
  readonly ibw: WeatherIbw | null
  readonly actions: readonly string[]
}
export const WEATHER_PRODUCT_PROJECTION_KEYS = wireKeys<WeatherProductProjection>()([
  'productType',
  'hazard',
  'action',
  'supersedesPermalink',
  'zoneSlugs',
  'effectiveScenarioTime',
  'expiresScenarioTime',
  'ibw',
  'actions',
])

/** Current conditions. */
export interface ForecastCurrent {
  readonly tempF: number
  readonly condition: string
  readonly conditionCode: WeatherConditionCode
  readonly windMph: number
  readonly windDir: string
  readonly humidityPct: number
  readonly observedScenarioTime: string
}
export const FORECAST_CURRENT_KEYS = wireKeys<ForecastCurrent>()([
  'tempF',
  'condition',
  'conditionCode',
  'windMph',
  'windDir',
  'humidityPct',
  'observedScenarioTime',
])

/** One period: exactly one of `tempF` or the `hiF` + `loF` pair is set. */
export interface ForecastPeriod {
  readonly label: string
  readonly tempF: number | null
  readonly hiF: number | null
  readonly loF: number | null
  readonly condition: string
  readonly conditionCode: WeatherConditionCode
  readonly precipPct: number
  readonly windText: string
  readonly detail: string
}
export const FORECAST_PERIOD_KEYS = wireKeys<ForecastPeriod>()([
  'label',
  'tempF',
  'hiF',
  'loF',
  'condition',
  'conditionCode',
  'precipPct',
  'windText',
  'detail',
])

/**
 * The `forecast` payload (stored = projected; nothing staff-only). A later
 * forecast for the same zone may say something different (WX-003).
 */
export interface ForecastPayload {
  readonly zoneSlug: string
  readonly current: ForecastCurrent
  readonly periods: readonly ForecastPeriod[]
  readonly discussion: string | null
  readonly uncertaintyNote: string | null
}
export const FORECAST_PAYLOAD_KEYS = wireKeys<ForecastPayload>()([
  'zoneSlug',
  'current',
  'periods',
  'discussion',
  'uncertaintyNote',
])

/** The `@WeatherDesk` post half of the delivery block. */
export interface WeatherDeliveryPost {
  readonly enabled: boolean
  /** ≤ 280 code points, or null for the headline verbatim (story 04). */
  readonly text: string | null
}
export const WEATHER_DELIVERY_POST_KEYS = wireKeys<WeatherDeliveryPost>()(['enabled', 'text'])

/** Staff-only: whether publishing raises the alert and posts (story 04 consumes it). */
export interface WeatherDelivery {
  /** A non-cancel warning cannot set false. */
  readonly raiseAlert: boolean
  readonly post: WeatherDeliveryPost
}
export const WEATHER_DELIVERY_KEYS = wireKeys<WeatherDelivery>()(['raiseAlert', 'post'])

/**
 * Staff-only: the STORED `weather_product` payload, as the server normalizes
 * it. An editor sends this shape without `supersedesPermalink` (the server
 * derives it from `supersedesContentId`).
 */
export interface WeatherProductPayload extends WeatherProductProjection {
  readonly supersedesContentId: string | null
  readonly delivery: WeatherDelivery
}
export const WEATHER_PRODUCT_PAYLOAD_KEYS = wireKeys<WeatherProductPayload>()([
  'productType',
  'hazard',
  'action',
  'supersedesContentId',
  'supersedesPermalink',
  'zoneSlugs',
  'effectiveScenarioTime',
  'expiresScenarioTime',
  'ibw',
  'actions',
  'delivery',
])

/** Every key list `weatherContract.json` pins, by C# record name. */
export const WEATHER_SHAPE_KEYS = {
  WeatherProductProjection: WEATHER_PRODUCT_PROJECTION_KEYS,
  WeatherIbw: WEATHER_IBW_KEYS,
  ForecastPayload: FORECAST_PAYLOAD_KEYS,
  ForecastCurrent: FORECAST_CURRENT_KEYS,
  ForecastPeriod: FORECAST_PERIOD_KEYS,
  WeatherProductPayload: WEATHER_PRODUCT_PAYLOAD_KEYS,
  WeatherDelivery: WEATHER_DELIVERY_KEYS,
  WeatherDeliveryPost: WEATHER_DELIVERY_POST_KEYS,
} as const

/** A published weather product as a participant reads it: the FC-3 DTO, payload narrowed. */
export interface WeatherProductDto extends Omit<ChannelContentDto, 'kind' | 'channelId' | 'payload'> {
  readonly channelId: 'weather'
  readonly kind: 'weather_product'
  readonly payload: WeatherProductProjection
}

/** A published forecast as a participant reads it. */
export interface ForecastDto extends Omit<ChannelContentDto, 'kind' | 'channelId' | 'payload'> {
  readonly channelId: 'weather'
  readonly kind: 'forecast'
  readonly payload: ForecastPayload
}
