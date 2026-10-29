import { describe, expect, it } from 'vitest'
import { KNOWN_TELEMETRY_EVENT_TYPES } from '@/core/telemetry/schema'
import type { ChannelIconId } from '@/features/participant-shell/channelNavConfig'
import wire from './wireContract.json'
import { WIRE_SHAPE_KEYS } from './types'
import {
  type ChannelId,
  ALERT_SEVERITIES,
  CHANNEL_IDS,
  CHANNEL_REALTIME_EVENTS,
  CONTENT_CHANNEL_IDS,
  CONTENT_KINDS,
  CONTENT_MEDIA_KINDS,
  CONTENT_ORIGINS,
  CONTENT_STATUSES,
  MEDIA_ROLES,
  PARTICIPANT_CONTENT_STATES,
  PARTICIPANT_REVISION_KINDS,
  REVISION_KINDS,
  STAMP_MOVING_REVISION_KINDS,
} from './vocabulary'

/**
 * Channels-foundation story 02 (#698): the TS half of the C#↔TS parity check.
 * `wireContract.json` is the one golden file; the server's
 * ChannelContractParityTests asserts the C# records and ChannelVocabulary
 * against the same file, so the two sides can only agree with each other.
 */
describe('channels wire contract (FC-1 / FC-3 / FC-5 / FC-6b)', () => {
  it.each([
    ['channelIds', CHANNEL_IDS],
    ['contentChannelIds', CONTENT_CHANNEL_IDS],
    ['contentKinds', CONTENT_KINDS],
    ['contentStatuses', CONTENT_STATUSES],
    ['participantContentStates', PARTICIPANT_CONTENT_STATES],
    ['contentOrigins', CONTENT_ORIGINS],
    ['revisionKinds', REVISION_KINDS],
    ['participantRevisionKinds', PARTICIPANT_REVISION_KINDS],
    ['stampMovingRevisionKinds', STAMP_MOVING_REVISION_KINDS],
    ['alertSeverities', ALERT_SEVERITIES],
    ['mediaRoles', MEDIA_ROLES],
    ['contentMediaKinds', CONTENT_MEDIA_KINDS],
    ['realtimeEvents', CHANNEL_REALTIME_EVENTS],
  ] as const)('vocabulary.ts %s equals the golden list, in order', (name, values) => {
    expect([...values]).toEqual(wire.vocabulary[name])
  })

  it('names exactly the participant channel catalog ids', () => {
    // Compile-time: ChannelId and the shell's catalog icon ids are the same union
    // (the server test pins ChannelVocabulary.ChannelIds to ChannelCatalog.All).
    const sameUnion: [ChannelId] extends [ChannelIconId]
      ? [ChannelIconId] extends [ChannelId] ? true : false
      : false = true
    expect(sameUnion).toBe(true)
    expect([...CHANNEL_IDS]).toEqual(wire.vocabulary.channelIds)
  })

  it('pins every shape the golden file names, and only those', () => {
    expect(Object.keys(WIRE_SHAPE_KEYS).sort()).toEqual(Object.keys(wire.shapes).sort())
  })

  it.each(Object.entries(wire.shapes))('%s key set equals the golden key set', (name, keys) => {
    const tsKeys = WIRE_SHAPE_KEYS[name as keyof typeof WIRE_SHAPE_KEYS]
    expect([...tsKeys].sort()).toEqual([...keys].sort())
  })

  it.each(wire.participantShapes)('participant shape %s carries no staff-only key (XC-002)', name => {
    const keys: readonly string[] = WIRE_SHAPE_KEYS[name as keyof typeof WIRE_SHAPE_KEYS]
    expect(keys.filter(k => wire.participantExcludedKeys.includes(k))).toEqual([])
    expect(keys.filter(k => /wallclock/i.test(k))).toEqual([])
  })

  it('the tombstone carries no body, headline or payload', () => {
    const keys: readonly string[] = WIRE_SHAPE_KEYS.ChannelContentTombstoneDto
    for (const key of ['bodyHtml', 'headline', 'dek', 'media', 'payload', 'revisions', 'hero']) {
      expect(keys).not.toContain(key)
    }
  })

  it('KNOWN_TELEMETRY_EVENT_TYPES gains exactly the FC-6b entries', () => {
    const known: readonly string[] = KNOWN_TELEMETRY_EVENT_TYPES
    const fc6b = known.slice(known.indexOf('steering_action') + 1)
    expect(fc6b).toEqual(wire.telemetryEventTypes)
    expect(new Set(known).size).toBe(known.length)
  })
})
