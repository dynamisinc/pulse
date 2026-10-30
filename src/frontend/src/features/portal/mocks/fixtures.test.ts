import { describe, expect, it } from 'vitest'
import {
  isAlertDto,
  isChannelContentSummaryDto,
  isChannelContentTombstoneDto,
  isContentRetractedDto,
  isHostRelativePath,
  isIsoScenarioTime,
} from '@/features/channels/contract'
import wire from '../contract/portalWireContract.json'
import { isForbiddenKey } from '../contract/forbiddenKeys'
import { isPortalDto, isPortalResourceList } from '../contract/guards'
import { PORTAL_DEFAULT_MODULE_ORDER, PORTAL_MODULE_CHANNELS } from '../contract/vocabulary'
import {
  BUSY_STREAM_POSTS_PER_MINUTE,
  MOCK_EMERGENCY_ALERT,
  MOCK_INCIDENT_LEAD,
  PORTAL_MODULE_SUBSETS,
  PORTAL_SCENARIOS,
  PORTAL_SCENARIO_KEYS,
  PORTAL_SOURCE_CHANNELS,
  portalForChannels,
} from './fixtures'

/**
 * Exercise-portal story 02 (#768), ACs "Fixtures" and "Host-relative URLs":
 * every scenario is in shape, uses scenario-time strings, and holds no
 * absolute URL or hostname.
 */

const scenarios = PORTAL_SCENARIO_KEYS.map(key => PORTAL_SCENARIOS[key])

/** Every string anywhere in `value`, with its JSON path. */
function strings(value: unknown, path = '$'): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => strings(item, `${path}.${key}`))
  }
  return []
}

/** Every object key anywhere in `value`. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys)
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)])
  }
  return []
}

// A scheme (`https:`, `javascript:`), a protocol-relative `//host`, or a bare
// `www.` / `name.tld/` hostname.
const ABSOLUTE_URL = new RegExp(
  [
    String.raw`[a-z][a-z0-9+.-]*://`,
    String.raw`(^|[\s"'(=])//[^/]`,
    String.raw`\bwww\.`,
    String.raw`\b[a-z0-9-]+\.(com|net|org|gov|io|test|local|invalid)\b`,
  ].join('|'),
  'i',
)

describe('portal fixtures', () => {
  it.each(scenarios)('$key: the portal and resources pass their guards', scenario => {
    expect(isPortalDto(scenario.portal)).toBe(true)
    expect(isPortalResourceList(scenario.resources)).toBe(true)
  })

  it.each(scenarios)('$key: every module input passes its FC-3 guard', scenario => {
    for (const item of [...scenario.topStories, ...scenario.pressLatest, ...scenario.weather]) {
      expect(isChannelContentSummaryDto(item)).toBe(true)
    }
    expect(scenario.topStories.every(s => s.channelId === 'news' && s.featured)).toBe(true)
    expect(scenario.pressLatest.every(s => s.channelId === 'press')).toBe(true)
    expect(scenario.weather.every(s => s.channelId === 'weather')).toBe(true)
    expect(scenario.alerts.every(isAlertDto)).toBe(true)
    expect(scenario.retracted.every(isChannelContentTombstoneDto)).toBe(true)
    expect(scenario.retractedFrames.every(isContentRetractedDto)).toBe(true)
  })

  it.each(scenarios)('$key: every instant is a scenario-time ISO string (COR-053)', scenario => {
    const instants = strings(scenario).filter(([path]) => /(ScenarioTime|scenarioTime)$/.test(path))
    expect(instants.length).toBeGreaterThan(0)
    for (const [path, instant] of instants) {
      expect(isIsoScenarioTime(instant), path).toBe(true)
    }
  })

  it.each(scenarios)('$key: lists are newest first', scenario => {
    for (const list of [scenario.topStories, scenario.pressLatest, scenario.weather]) {
      const times = list.map(s => Date.parse(s.publishedScenarioTime))
      expect(times).toEqual([...times].sort((a, b) => b - a))
    }
    const posts = scenario.socialPosts.map(p => Date.parse(p.scenarioTime))
    expect(posts).toEqual([...posts].sort((a, b) => b - a))
  })

  it('normal day / Staged: filler only, calm weather, no alert, a slow stream', () => {
    const day = PORTAL_SCENARIOS.normalDay
    expect(day.alerts).toEqual([])
    expect(day.topStories.every(s => s.kicker === null)).toBe(true)
    expect(day.weather.map(w => w.kind)).toEqual(['forecast'])
    expect(day.socialPosts.length).toBeLessThan(10)
    expect(day.portal.modules.map(m => m.id)).toEqual([...PORTAL_DEFAULT_MODULE_ORDER])
  })

  it('incident day: a pinned lead, an emergency alert, a busy stream', () => {
    const day = PORTAL_SCENARIOS.incidentDay
    expect(day.topStories[0]).toBe(MOCK_INCIDENT_LEAD)
    expect(day.alerts).toEqual([MOCK_EMERGENCY_ALERT])
    expect(MOCK_EMERGENCY_ALERT.severity).toBe('emergency')
    expect(day.weather.map(w => w.kind)).toEqual(['weather_product'])

    const times = day.socialPosts.map(p => Date.parse(p.scenarioTime))
    expect(day.socialPosts).toHaveLength(BUSY_STREAM_POSTS_PER_MINUTE)
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(60_000)
    expect(new Set(day.socialPosts.map(p => p.id)).size).toBe(day.socialPosts.length)
  })

  it('no resources: an empty shelf, and the portal says so', () => {
    const day = PORTAL_SCENARIOS.noResources
    expect(day.resources).toEqual([])
    expect(day.portal.hasResources).toBe(false)
  })

  it('every other scenario has a shelf the portal advertises', () => {
    for (const s of scenarios.filter(s => s.key !== 'noResources')) {
      expect(s.portal.hasResources).toBe(s.resources.length > 0)
    }
  })

  it('kiosk-lite: the incident portal in the kiosk variant, with the lead retracted', () => {
    const kiosk = PORTAL_SCENARIOS.kioskLite
    const incident = PORTAL_SCENARIOS.incidentDay
    expect(kiosk.variant).toBe('kiosk')
    expect(kiosk.portal).toEqual(incident.portal)
    expect(kiosk.topStories.map(s => s.id)).not.toContain(MOCK_INCIDENT_LEAD.id)
    expect(kiosk.retracted.map(t => t.permalink)).toEqual([MOCK_INCIDENT_LEAD.permalink])
    expect(kiosk.retractedFrames.map(f => f.id)).toEqual([MOCK_INCIDENT_LEAD.id])
    expect(Date.parse(kiosk.retracted[0]?.retractedScenarioTime ?? ''))
      .toBeGreaterThan(Date.parse(MOCK_INCIDENT_LEAD.publishedScenarioTime))
  })

  describe('every subset of the four content modules', () => {
    it('enumerates all 16 subsets of the source channels, once each', () => {
      expect(PORTAL_MODULE_SUBSETS).toHaveLength(16)
      expect(new Set(PORTAL_MODULE_SUBSETS.map(s => [...s].sort().join(','))).size).toBe(16)
      expect(PORTAL_MODULE_SUBSETS[0]).toEqual([])
      const all = PORTAL_MODULE_SUBSETS[15] ?? []
      expect([...all].sort()).toEqual([...PORTAL_SOURCE_CHANNELS].sort())
    })

    it.each(PORTAL_MODULE_SUBSETS.map(s => [s.join('+') || '(none)', s] as const))(
      '%s: only the enabled channels\' modules, in default order',
      (_, enabled) => {
        const dto = portalForChannels(enabled)
        expect(isPortalDto(dto)).toBe(true)
        expect(dto.modules.every(m => enabled.includes(PORTAL_MODULE_CHANNELS[m.id]))).toBe(true)
        const expected = PORTAL_DEFAULT_MODULE_ORDER
          .filter(id => enabled.includes(PORTAL_MODULE_CHANNELS[id]))
        expect(dto.modules.map(m => m.id)).toEqual(expected)
      },
    )
  })

  describe('host-relative URLs (FC-9.3 tripwire)', () => {
    it('the pattern catches absolute URLs and hostnames (the tripwire can fail)', () => {
      for (const bad of [
        'https://pulse.example.com/x', '//cdn.test/a.png', 'see www.fairhaven.gov', 'mailto://x', 'evil.com/path',
        '<a href="//evil.test">x</a>', 'javascript://%0aalert(1)',
      ]) {
        expect(ABSOLUTE_URL.test(bad), bad).toBe(true)
      }
      for (const ok of ['/weather/weather-desk/tornado-warning-1', '/media/m-1', '2026-12-02T14:20:00Z', 'Go Eagles!']) {
        expect(ABSOLUTE_URL.test(ok), ok).toBe(false)
      }
    })

    it.each(scenarios)('$key holds no absolute URL or hostname anywhere', scenario => {
      const hits = strings(scenario).filter(([, value]) => ABSOLUTE_URL.test(value))
      expect(hits).toEqual([])
    })

    it.each(scenarios)('$key: every link field is host-relative', scenario => {
      const links = strings(scenario)
        .filter(([path]) => /\.(permalink|href|url|posterUrl)$/.test(path))
      for (const [path, value] of links) {
        expect(isHostRelativePath(value), path).toBe(true)
      }
      const anchors = strings(scenario)
        .flatMap(([, v]) => [...v.matchAll(/href="([^"]*)"/g)].map(m => m[1]))
      expect(anchors.every(isHostRelativePath)).toBe(true)
    })

    it('the subset portals hold no absolute URL either', () => {
      for (const enabled of PORTAL_MODULE_SUBSETS) {
        const hits = strings(portalForChannels(enabled)).filter(([, v]) => ABSOLUTE_URL.test(v))
        expect(hits).toEqual([])
      }
    })
  })

  it.each(scenarios)('$key: no participant-visible key looks staff-only (XC-002)', scenario => {
    const leaks = keys(scenario).filter(key =>
      isForbiddenKey(key, wire.participantForbiddenKeyPatterns, wire.participantAllowedWords),
    )
    expect(leaks).toEqual([])
  })
})
