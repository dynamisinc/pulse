import { describe, expect, it } from 'vitest'
import { api } from '@/core/services/api'
import {
  isAlertsChangedDto,
  isChannelContentListDto,
  isChannelContentReadDto,
  isChannelContentStaffDto,
  isLinkPreviewDto,
  isOutletDto,
} from '../contract/guards'
import { WIRE_SHAPE_KEYS } from '../contract/types'
import { channelsMockAdapter, withChannelsMock } from './channelsMock'
import {
  MOCK_ALERTS,
  MOCK_OUTLETS,
  MOCK_PUBLISHED_ARTICLE,
  MOCK_RETRACTED_RELEASE,
  MOCK_REVISED_WEATHER_PRODUCT,
  MOCK_STAFF_CONTENT,
} from './fixtures'

/**
 * Channels-foundation story 02 (#698), AC "Mock fixtures": fixtures for one
 * outlet per content channel, a published, a retracted and a revised item, and
 * two alerts, served behind the shared axios client.
 */

const mock = { adapter: channelsMockAdapter }

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort()
}

describe('channels fixtures', () => {
  it('have one outlet per content channel', () => {
    expect(MOCK_OUTLETS.map(o => o.channelId).sort()).toEqual(['news', 'press', 'weather'])
  })

  it('have a published, a retracted and a revised item, and two alerts', () => {
    expect(MOCK_PUBLISHED_ARTICLE.state).toBe('published')
    expect(MOCK_PUBLISHED_ARTICLE.revisions).toHaveLength(0)
    expect(MOCK_RETRACTED_RELEASE.state).toBe('retracted')
    expect(MOCK_REVISED_WEATHER_PRODUCT.revisions.length).toBeGreaterThan(0)
    expect(MOCK_REVISED_WEATHER_PRODUCT.updatedScenarioTime).not.toBeNull()
    expect(MOCK_ALERTS).toHaveLength(2)
  })

  it('carry exactly the frozen key set of their shape', () => {
    const keysOf = (shape: keyof typeof WIRE_SHAPE_KEYS) => [...WIRE_SHAPE_KEYS[shape]].sort()
    for (const outlet of MOCK_OUTLETS) expect(sortedKeys(outlet)).toEqual(keysOf('OutletDto'))
    for (const item of [MOCK_PUBLISHED_ARTICLE, MOCK_REVISED_WEATHER_PRODUCT]) {
      expect(sortedKeys(item)).toEqual(keysOf('ChannelContentDto'))
    }
    expect(sortedKeys(MOCK_RETRACTED_RELEASE)).toEqual(keysOf('ChannelContentTombstoneDto'))
    for (const alert of MOCK_ALERTS) expect(sortedKeys(alert)).toEqual(keysOf('AlertDto'))
    for (const item of MOCK_STAFF_CONTENT) expect(sortedKeys(item)).toEqual(keysOf('ChannelContentStaffDto'))
  })

  it('contain no absolute URL anywhere (FC-9.3)', () => {
    const all = JSON.stringify([MOCK_OUTLETS, MOCK_PUBLISHED_ARTICLE, MOCK_REVISED_WEATHER_PRODUCT,
      MOCK_RETRACTED_RELEASE, MOCK_ALERTS, MOCK_STAFF_CONTENT])
    expect(all).not.toMatch(/:\/\//)
  })
})

describe('channels mock adapter (through the shared axios client)', () => {
  it('serves outlets, filtered by channel, and one by slug', async () => {
    const all = await api.get('/outlets', mock)
    expect(all.data).toHaveLength(3)
    expect((all.data as unknown[]).every(isOutletDto)).toBe(true)

    const news = await api.get('/outlets', { ...mock, params: { channel: 'news' } })
    expect(news.data).toEqual([MOCK_OUTLETS[0]])

    const bySlug = await api.get('/outlets/weather-desk', mock)
    expect(bySlug.data).toEqual(MOCK_OUTLETS[2])
  })

  it('returns copies, so mutating a response never changes the fixtures', async () => {
    const response = await api.get('/outlets/newsline-7', mock)
    response.data.name = 'Changed'
    expect(MOCK_OUTLETS[0]?.name).toBe('Newsline 7')
  })

  it('serves a channel list of summaries (no body)', async () => {
    const response = await api.get('/channels/news/content', mock)
    expect(isChannelContentListDto(response.data)).toBe(true)
    expect(response.data.items).toHaveLength(1)
    expect(response.data.items[0]).not.toHaveProperty('bodyHtml')
  })

  it('serves a published permalink and a retracted tombstone', async () => {
    const published = await api.get('/channels/weather/content/weather-desk/tornado-warning-1', mock)
    expect(isChannelContentReadDto(published.data)).toBe(true)
    expect(published.data).toEqual(MOCK_REVISED_WEATHER_PRODUCT)

    const retracted = await api.get('/channels/press/content/wire-room/shelter-locations-update', mock)
    expect(retracted.data).toEqual(MOCK_RETRACTED_RELEASE)
    expect(retracted.data).not.toHaveProperty('bodyHtml')
  })

  it('answers an unknown permalink or route with the same 404', async () => {
    await expect(api.get('/channels/news/content/newsline-7/nope', mock))
      .rejects.toMatchObject({ response: { status: 404 } })
    await expect(api.get('/channels/news/content/other-outlet/emergency-call-delays', mock))
      .rejects.toMatchObject({ response: { status: 404 } })
    await expect(api.get('/unknown', mock)).rejects.toMatchObject({ response: { status: 404 } })
    await expect(api.post('/content-items', {}, mock)).rejects.toMatchObject({ response: { status: 404 } })
  })

  it('serves alerts, alert history and link previews', async () => {
    const alerts = await api.get('/alerts', mock)
    expect(isAlertsChangedDto(alerts.data)).toBe(true)
    expect(alerts.data.alerts).toHaveLength(2)

    const history = await api.get('/alerts/history', mock)
    expect(history.data.alerts.map((a: { id: string }) => a.id))
      .toEqual(MOCK_ALERTS.map(a => a.id))

    const preview = await api.get('/link-previews', {
      ...mock, params: { path: MOCK_PUBLISHED_ARTICLE.permalink },
    })
    expect(isLinkPreviewDto(preview.data)).toBe(true)
  })

  it('serves the staff reads', async () => {
    const list = await api.get('/content-items', mock)
    expect((list.data as unknown[]).every(isChannelContentStaffDto)).toBe(true)
    const [first] = MOCK_STAFF_CONTENT
    const one = await api.get(`/content-items/${first?.id ?? ''}`, mock)
    expect(one.data).toEqual(first)
  })

  it('withChannelsMock swaps in the adapter at the one flip point (mock on in tests)', () => {
    expect(withChannelsMock()).toEqual({ adapter: channelsMockAdapter })
    expect(withChannelsMock({ params: { a: 1 } }))
      .toEqual({ params: { a: 1 }, adapter: channelsMockAdapter })
  })
})
