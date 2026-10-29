import { describe, expect, it } from 'vitest'
import {
  MOCK_ALERTS,
  MOCK_OUTLETS,
  MOCK_PUBLISHED_ARTICLE,
  MOCK_RETRACTED_RELEASE,
  MOCK_REVISED_WEATHER_PRODUCT,
  MOCK_STAFF_CONTENT,
} from '../mocks/fixtures'
import {
  isAlertDto,
  isAlertsChangedDto,
  isChannelContentDto,
  isChannelContentListDto,
  isChannelContentReadDto,
  isChannelContentStaffDto,
  isChannelContentSummaryDto,
  isChannelContentTombstoneDto,
  isContentMediaDto,
  isContentRetractedDto,
  isContentRevisedDto,
  isHostRelativePath,
  isIsoScenarioTime,
  isLinkPreviewDto,
  isOutletDto,
} from './guards'
import type { ContentMediaDto } from './types'

/**
 * Channels-foundation story 02 (#698), AC "TS types and runtime guards": an
 * out-of-shape response fails closed; extra keys are tolerated (additive
 * evolution), mirroring the shell's `isAlert`.
 */

const media: ContentMediaDto = {
  id: 'm-1',
  kind: 'image',
  role: 'hero',
  url: '/media/m-1?sig=abc',
  posterUrl: null,
  contentType: 'image/jpeg',
  width: 1200,
  height: 630,
  durationSec: null,
  alt: 'Flooded street',
  caption: null,
}

function without(value: object | undefined, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value }
  delete copy[key]
  return copy
}

const [firstOutlet] = MOCK_OUTLETS
const [firstAlert] = MOCK_ALERTS

describe('isIsoScenarioTime', () => {
  it.each(['2026-12-02T14:05:00Z', '2026-12-02T14:05:00.1234567+00:00', '2026-12-02T09:05-05:00'])(
    'accepts %s', value => expect(isIsoScenarioTime(value)).toBe(true),
  )

  it.each(['Dec 2 2026 14:05', '2026-12-02', '2026-12-02T14:05:00', '1764684300000', '', '2026-13-45T99:99:00Z'])(
    'rejects non-ISO or offset-less %j', value => expect(isIsoScenarioTime(value)).toBe(false),
  )

  it('rejects a non-string', () => expect(isIsoScenarioTime(1764684300000)).toBe(false))
})

describe('isHostRelativePath', () => {
  it('accepts a path', () => expect(isHostRelativePath('/news/newsline-7/a')).toBe(true))

  it.each([
    'https://x.test/news/a', '//x.test/news/a', 'news/a', '/x?u=https://evil.test', '\\\\x\\a',
    '/\t/evil.test/x', '/\n/evil.test', '/a\u0000b',
  ])(
    'rejects %s', value => expect(isHostRelativePath(value)).toBe(false),
  )
})

describe('content guards', () => {
  it('accept the fixtures', () => {
    for (const item of [MOCK_PUBLISHED_ARTICLE, MOCK_REVISED_WEATHER_PRODUCT]) {
      expect(isChannelContentDto(item)).toBe(true)
      expect(isChannelContentSummaryDto(item)).toBe(true)
      expect(isChannelContentReadDto(item)).toBe(true)
    }
    expect(isChannelContentTombstoneDto(MOCK_RETRACTED_RELEASE)).toBe(true)
    expect(isChannelContentReadDto(MOCK_RETRACTED_RELEASE)).toBe(true)
    expect(MOCK_OUTLETS.every(isOutletDto)).toBe(true)
    expect(MOCK_ALERTS.every(isAlertDto)).toBe(true)
    expect(MOCK_STAFF_CONTENT.every(isChannelContentStaffDto)).toBe(true)
    expect(isContentMediaDto(media)).toBe(true)
  })

  it('tolerate extra keys (additive evolution)', () => {
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, futureField: { x: 1 } })).toBe(true)
    expect(isAlertDto({ ...MOCK_ALERTS[0], futureField: true })).toBe(true)
    expect(isOutletDto({ ...MOCK_OUTLETS[0], futureField: 'x' })).toBe(true)
  })

  it('reject a missing id', () => {
    expect(isChannelContentDto(without(MOCK_PUBLISHED_ARTICLE, 'id'))).toBe(false)
    expect(isChannelContentTombstoneDto(without(MOCK_RETRACTED_RELEASE, 'id'))).toBe(false)
    expect(isOutletDto(without(firstOutlet, 'id'))).toBe(false)
    expect(isAlertDto(without(firstAlert, 'id'))).toBe(false)
  })

  it('reject a missing nullable key (null is required, not absence)', () => {
    expect(isChannelContentDto(without(MOCK_PUBLISHED_ARTICLE, 'dek'))).toBe(false)
  })

  it('reject a non-ISO scenarioTime', () => {
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, publishedScenarioTime: 'Dec 2 2026' })).toBe(false)
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, updatedScenarioTime: '2026-12-02' })).toBe(false)
    expect(isChannelContentTombstoneDto({ ...MOCK_RETRACTED_RELEASE, retractedScenarioTime: 'yesterday' })).toBe(false)
    expect(isAlertDto({ ...MOCK_ALERTS[0], scenarioTime: 'Dec 2 2026 14:20' })).toBe(false)
  })

  it('reject an unknown vocabulary value', () => {
    expect(isAlertDto({ ...MOCK_ALERTS[0], severity: 'critical' })).toBe(false)
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, kind: 'podcast' })).toBe(false)
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, channelId: 'radio' })).toBe(false)
    expect(isContentMediaDto({ ...media, role: 'banner' })).toBe(false)
  })

  it('reject a draft or scheduled status on a participant read', () => {
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, state: 'draft' })).toBe(false)
    expect(isChannelContentReadDto({ ...MOCK_PUBLISHED_ARTICLE, state: 'scheduled' })).toBe(false)
  })

  it('reject a staff-only revision kind in participant revisions', () => {
    const revisions = [{ number: 2, kind: 'silent_rewrite', scenarioTime: '2026-12-02T14:32:00Z', note: null }]
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, revisions })).toBe(false)
  })

  it('reject an absolute permalink, home route or alert href (FC-9.3)', () => {
    expect(isChannelContentDto({ ...MOCK_PUBLISHED_ARTICLE, permalink: 'https://x.test/news/a/b' })).toBe(false)
    expect(isOutletDto({ ...MOCK_OUTLETS[0], homeRoute: '//x.test/news' })).toBe(false)
    expect(isAlertDto({ ...MOCK_ALERTS[0], href: 'https://x.test/weather' })).toBe(false)
  })

  it('a summary is not a tombstone and a tombstone is not a content read with a body', () => {
    expect(isChannelContentDto(MOCK_RETRACTED_RELEASE)).toBe(false)
    expect(isChannelContentTombstoneDto(MOCK_PUBLISHED_ARTICLE)).toBe(false)
  })

  it('validates the list, frames and link preview', () => {
    const list = (item: unknown) => ({ items: [item], nextCursor: null })
    expect(isChannelContentListDto(list(MOCK_PUBLISHED_ARTICLE))).toBe(true)
    expect(isChannelContentListDto(list(MOCK_RETRACTED_RELEASE))).toBe(false)
    expect(isChannelContentListDto({ nextCursor: null })).toBe(false)
    expect(isAlertsChangedDto({ alerts: MOCK_ALERTS })).toBe(true)
    expect(isAlertsChangedDto({ alerts: [{ ...MOCK_ALERTS[0], severity: 'none' }] })).toBe(false)
    expect(isContentRevisedDto({
      id: 'x', channelId: 'news', permalink: '/news/a/b', updatedScenarioTime: '2026-12-02T14:32:00Z',
      revisions: [], headline: 'H', dek: null,
    })).toBe(true)
    expect(isContentRetractedDto({
      id: 'x', channelId: 'news', permalink: '/news/a/b', retractedScenarioTime: 'soon',
    })).toBe(false)
    expect(isLinkPreviewDto({ title: 'T', sourceName: 'S', permalink: '/news/a/b' })).toBe(true)
    expect(isLinkPreviewDto({ title: 'T', sourceName: 'S', permalink: 'https://x.test/a' })).toBe(false)
  })

  it('a staff read accepts draft status with no participant state', () => {
    const draft = { ...MOCK_STAFF_CONTENT[0], status: 'draft', state: null, publishedScenarioTime: null }
    expect(isChannelContentStaffDto(draft)).toBe(true)
    expect(isChannelContentStaffDto({ ...draft, origin: 'robot' })).toBe(false)
    expect(isChannelContentStaffDto({ ...draft, version: -1 })).toBe(false)
    expect(isChannelContentStaffDto({ ...draft, revisionCount: 1.5 })).toBe(false)
    expect(isChannelContentStaffDto({ ...draft, version: Number.NaN })).toBe(false)
  })

  it.each([null, undefined, 'x', 42, []])('reject a non-object %j', value => {
    expect(isChannelContentReadDto(value)).toBe(false)
    expect(isAlertDto(value)).toBe(false)
    expect(isOutletDto(value)).toBe(false)
  })
})
