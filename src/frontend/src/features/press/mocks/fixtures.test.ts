import { describe, expect, it } from 'vitest'
import {
  isChannelContentTombstoneDto,
  isHostRelativePath,
  isIsoScenarioTime,
} from '@/features/channels/contract'
import wire from '../contract/pressWireContract.json'
import {
  isReleaseAuthorDto,
  isReleaseContentDto,
  isReleaseOrgDto,
  isReleaseParticipantPayload,
} from '../contract/guards'
import { PARTICIPANT_PAYLOAD_KEYS } from '../contract/vocabulary'
import { isForbiddenKey } from '@/features/portal/contract'
import {
  MOCK_EMBARGOED_RELEASE_AUTHOR,
  MOCK_FULTON_ORG,
  MOCK_HARBOR_ORG,
  MOCK_PENDING_RELEASE_AUTHOR,
  MOCK_PUBLISHED_RELEASE_AUTHOR,
  MOCK_PUBLISHED_RELEASE_CONTENT,
  MOCK_RETRACTED_RELEASE_TOMBSTONE,
  MOCK_RETURNED_RELEASE_AUTHOR,
  PRESS_SCENARIOS,
} from './fixtures'

/**
 * Press-room story 01 (#738), ACs "Contracts and fixtures" and "Participant-safe
 * projection": every fixture passes its guard, holds only scenario-time strings
 * and host-relative links, and the participant fixtures leak nothing staff-only.
 */

const authorReleases = [
  MOCK_PUBLISHED_RELEASE_AUTHOR,
  MOCK_EMBARGOED_RELEASE_AUTHOR,
  MOCK_RETURNED_RELEASE_AUTHOR,
  MOCK_PENDING_RELEASE_AUTHOR,
]

const orgs = [MOCK_FULTON_ORG, MOCK_HARBOR_ORG]

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

const everything = [
  ...orgs,
  ...authorReleases,
  MOCK_PUBLISHED_RELEASE_CONTENT,
  MOCK_RETRACTED_RELEASE_TOMBSTONE,
]

describe('press fixtures', () => {
  it.each(orgs)('org $name passes its guard', org => {
    expect(isReleaseOrgDto(org)).toBe(true)
  })

  it('one org has a full letterhead, the other is NEUTRAL (all null)', () => {
    const full = MOCK_FULTON_ORG.letterhead
    expect(full.logo).not.toBeNull()
    expect(full.address).not.toBeNull()
    expect(full.defaultContact).not.toBeNull()
    expect(MOCK_HARBOR_ORG.letterhead).toEqual({ logo: null, address: null, defaultContact: null })
  })

  it.each(authorReleases)('author release in state $state passes its guard', dto => {
    expect(isReleaseAuthorDto(dto)).toBe(true)
  })

  it('covers published, embargoed, returned, pending approval and retracted', () => {
    expect(authorReleases.map(r => r.state).sort()).toEqual(
      ['pending_approval', 'published', 'returned', 'scheduled'],
    )
    expect(MOCK_EMBARGOED_RELEASE_AUTHOR.scheduledScenarioTime).not.toBeNull()
    expect(MOCK_RETURNED_RELEASE_AUTHOR.returnNote).not.toBeNull()
    expect(MOCK_PUBLISHED_RELEASE_AUTHOR.scheduledScenarioTime).toBeNull()
    expect(isChannelContentTombstoneDto(MOCK_RETRACTED_RELEASE_TOMBSTONE)).toBe(true)
    expect(MOCK_RETRACTED_RELEASE_TOMBSTONE.kind).toBe('release')
  })

  it('the published participant read passes its guard and matches the author view', () => {
    expect(isReleaseContentDto(MOCK_PUBLISHED_RELEASE_CONTENT)).toBe(true)
    expect(MOCK_PUBLISHED_RELEASE_CONTENT.id).toBe(MOCK_PUBLISHED_RELEASE_AUTHOR.id)
    expect(MOCK_PUBLISHED_RELEASE_CONTENT.permalink).toBe(MOCK_PUBLISHED_RELEASE_AUTHOR.permalink)
    expect(MOCK_PUBLISHED_RELEASE_CONTENT.permalink).toMatch(/^\/press\/[a-z0-9-]+\/[a-z0-9-]+$/)
  })

  it('the participant payload has exactly the participant keys', () => {
    const payload = MOCK_PUBLISHED_RELEASE_CONTENT.payload
    expect(Object.keys(payload).sort()).toEqual([...PARTICIPANT_PAYLOAD_KEYS].sort())
    expect(isReleaseParticipantPayload(payload)).toBe(true)
  })

  it('the serialized participant fixtures contain no forbidden key (XC-002)', () => {
    for (const fixture of [MOCK_PUBLISHED_RELEASE_CONTENT, MOCK_RETRACTED_RELEASE_TOMBSTONE]) {
      const roundTripped: unknown = JSON.parse(JSON.stringify(fixture))
      const leaks = keys(roundTripped).filter(key =>
        isForbiddenKey(key, wire.participantForbiddenKeyPatterns, wire.participantAllowedWords),
      )
      expect(leaks).toEqual([])
    }
  })

  it('every instant is a fixed scenario-time ISO string with an offset (COR-053)', () => {
    const instants = strings(everything)
      .filter(([path]) => /(ScenarioTime|scenarioTime)$/.test(path))
    expect(instants.length).toBeGreaterThan(0)
    for (const [path, instant] of instants) expect(isIsoScenarioTime(instant), path).toBe(true)
  })

  it('every permalink and media URL is host-relative', () => {
    const links = strings(everything).filter(([path]) => /\.(permalink|url|posterUrl)$/.test(path))
    expect(links.length).toBeGreaterThan(0)
    for (const [path, value] of links) expect(isHostRelativePath(value), path).toBe(true)
  })

  it('each scenario serves guard-valid orgs and releases', () => {
    for (const scenario of Object.values(PRESS_SCENARIOS)) {
      expect(scenario.orgs.every(isReleaseOrgDto)).toBe(true)
      expect(scenario.releases.every(isReleaseAuthorDto)).toBe(true)
    }
    expect(PRESS_SCENARIOS.activeNewsrooms.releases).toHaveLength(authorReleases.length)
  })
})
