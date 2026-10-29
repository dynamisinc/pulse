/**
 * features/channels/mocks/channelsMock.ts
 * ---------------------------------------------------------------------------
 * The channels mock seam (channels-foundation story 02, #698; FC-8 `mocks/`).
 * Mirrors `brandTokens.ts` / `useAlerts.ts`: every channels request still goes
 * through the shared axios client (`api`), so base URL, headers and
 * interceptors run exactly as they will against the live FC-4 routes; only
 * the transport is swapped, at ONE env-guarded flip point
 * (`USE_MOCK_CHANNELS`, WAVE0-REVIEW precedent 15). A production build without
 * `VITE_USE_MOCK_DATA` sends real requests and fails closed.
 *
 * Wave-2+ frontend stories call `api.get(path, withChannelsMock())` and run
 * against `fixtures.ts` until the backend story for that route lands; nothing
 * else changes when it does.
 *
 * The adapter answers the FC-4 participant routes (outlets, content list,
 * permalink read, alerts, alert history, link previews) and the staff
 * `GET /content-items[/{id}]` reads. Anything else is a 404, as is an unknown
 * slug or id: the same single not-found the live API gives (FC-9.1). It never
 * reads or sends an exercise id.
 *
 * World: both (data only).
 */

import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type {
  ChannelContentListDto,
  ChannelContentSummaryDto,
  ChannelContentDto,
  LinkPreviewDto,
} from '../contract/types'
import {
  MOCK_ALERTS,
  MOCK_OUTLETS,
  MOCK_PUBLISHED_CONTENT,
  MOCK_RETRACTED_RELEASE,
  MOCK_STAFF_CONTENT,
} from './fixtures'

/**
 * The SINGLE mock/live flip point for every channels request. Mock in dev/test
 * (or with the explicit `VITE_USE_MOCK_DATA=true` opt-in); live otherwise.
 */
export const USE_MOCK_CHANNELS = USE_MOCK_DATA

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  return { data, status, statusText: status === 200 ? 'OK' : 'Not Found', headers: {}, config }
}

function toSummary(item: ChannelContentDto): ChannelContentSummaryDto {
  return {
    id: item.id,
    channelId: item.channelId,
    kind: item.kind,
    outlet: item.outlet,
    slug: item.slug,
    permalink: item.permalink,
    state: item.state,
    headline: item.headline,
    dek: item.dek,
    kicker: item.kicker,
    category: item.category,
    hero: item.hero,
    publishedScenarioTime: item.publishedScenarioTime,
    updatedScenarioTime: item.updatedScenarioTime,
    featured: item.featured,
  }
}

function paramOf(config: InternalAxiosRequestConfig, url: URL, name: string): string | null {
  const params = config.params as Record<string, unknown> | undefined
  const fromParams = params?.[name]
  if (fromParams !== undefined && fromParams !== null) return String(fromParams)
  return url.searchParams.get(name)
}

/** Resolves one GET against the fixtures: `[status, body]`. */
function route(config: InternalAxiosRequestConfig): [number, unknown] {
  if ((config.method ?? 'get').toLowerCase() !== 'get') return [404, null]

  // A dummy origin only to parse the path and query; nothing is fetched.
  const url = new URL(config.url ?? '', 'http://mock.invalid')
  const segments = url.pathname.split('/').filter(Boolean)

  if (segments[0] === 'outlets') {
    if (segments.length === 1) {
      const channel = paramOf(config, url, 'channel')
      return [200, MOCK_OUTLETS.filter(o => channel === null || o.channelId === channel)]
    }
    const outlet = MOCK_OUTLETS.find(o => o.slug === segments[1])
    return segments.length === 2 && outlet ? [200, outlet] : [404, null]
  }

  if (segments[0] === 'channels' && segments[2] === 'content') {
    const channelId = segments[1]
    if (segments.length === 3) {
      const outletSlug = paramOf(config, url, 'outlet')
      const category = paramOf(config, url, 'category')
      const featured = paramOf(config, url, 'featured') === 'true'
      const items = MOCK_PUBLISHED_CONTENT
        .filter(i => i.channelId === channelId)
        .filter(i => outletSlug === null || i.outlet.slug === outletSlug)
        .filter(i => category === null || i.category === category)
        .filter(i => !featured || i.featured)
        .map(toSummary)
      const body: ChannelContentListDto = { items, nextCursor: null }
      return [200, body]
    }
    if (segments.length === 5) {
      const permalink = `/${channelId}/${segments[3]}/${segments[4]}`
      const published = MOCK_PUBLISHED_CONTENT.find(i => i.permalink === permalink)
      if (published) return [200, published]
      if (MOCK_RETRACTED_RELEASE.permalink === permalink) return [200, MOCK_RETRACTED_RELEASE]
    }
    return [404, null]
  }

  if (segments[0] === 'alerts' && segments.length === 1) return [200, { alerts: MOCK_ALERTS }]
  if (segments[0] === 'alerts' && segments[1] === 'history' && segments.length === 2) {
    const newestFirst = [...MOCK_ALERTS]
      .sort((a, b) => b.scenarioTime.localeCompare(a.scenarioTime))
    return [200, { alerts: newestFirst }]
  }

  if (segments[0] === 'link-previews' && segments.length === 1) {
    const item = MOCK_PUBLISHED_CONTENT.find(i => i.permalink === paramOf(config, url, 'path'))
    if (!item) return [404, null]
    const preview: LinkPreviewDto = {
      title: item.headline,
      description: item.dek,
      image: item.hero,
      sourceName: item.outlet.name,
      permalink: item.permalink,
    }
    return [200, preview]
  }

  if (segments[0] === 'content-items') {
    if (segments.length === 1) return [200, MOCK_STAFF_CONTENT]
    const item = MOCK_STAFF_CONTENT.find(i => i.id === segments[1])
    return segments.length === 2 && item ? [200, item] : [404, null]
  }

  return [404, null]
}

/**
 * Answers channels requests from the fixtures. A non-200 rejects like axios
 * does for a real response (default `validateStatus`), so callers exercise
 * their not-found path.
 */
export const channelsMockAdapter: AxiosAdapter = config => {
  const [status, data] = route(config)
  const response = respond(config, status, data)
  if (status >= 200 && status < 300) return Promise.resolve(response)
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config,
    response,
  })
  return Promise.reject(error)
}

/**
 * The request config every channels call passes to `api`: the mock adapter
 * when `USE_MOCK_CHANNELS` is on, the caller's config untouched otherwise.
 */
export function withChannelsMock<D = unknown>(
  config?: AxiosRequestConfig<D>,
): AxiosRequestConfig<D> | undefined {
  return USE_MOCK_CHANNELS ? { ...config, adapter: channelsMockAdapter } : config
}
