import { describe, expect, it } from 'vitest'
import { KNOWN_TELEMETRY_EVENT_TYPES, telemetryEventV0Schema } from '@/core/telemetry/schema'
import { CHANNEL_IDS, WIRE_SHAPE_KEYS } from '@/features/channels/contract'
import channelsWire from '@/features/channels/contract/wireContract.json'
import wire from './portalWireContract.json'
import { isForbiddenKey } from './forbiddenKeys'
import { PORTAL_TELEMETRY_SHAPES } from './telemetry'
import { PORTAL_WIRE_SHAPE_KEYS } from './types'
import {
  PORTAL_DEFAULT_LAYOUT_KEY,
  PORTAL_DEFAULT_MODULE_ORDER,
  PORTAL_LAYOUT_KEYS,
  PORTAL_LIMITS,
  PORTAL_MODULE_CHANNELS,
  PORTAL_MODULE_IDS,
} from './vocabulary'

function shapeKeys(name: string): readonly string[] {
  return PORTAL_WIRE_SHAPE_KEYS[name as keyof typeof PORTAL_WIRE_SHAPE_KEYS]
}

function isForbidden(key: string): boolean {
  return isForbiddenKey(key, wire.participantForbiddenKeyPatterns, wire.participantAllowedWords)
}

/**
 * Exercise-portal story 02 (#768): the TS half of the C#↔TS parity check.
 * `portalWireContract.json` is the one golden file; the server's
 * PortalContractParityTests asserts the C# records, PortalVocabulary and
 * PortalTelemetry against the same file, so the two sides can only agree.
 */
describe('portal wire contract (PC-1 / PC-3 / PC-6)', () => {
  it.each([
    ['moduleIds', PORTAL_MODULE_IDS],
    ['defaultModuleOrder', PORTAL_DEFAULT_MODULE_ORDER],
    ['layoutKeys', PORTAL_LAYOUT_KEYS],
  ] as const)('vocabulary.ts %s equals the golden list, in order', (name, values) => {
    expect([...values]).toEqual(wire.vocabulary[name])
  })

  it('maps each module id to exactly one FC-1 channel id', () => {
    expect(PORTAL_MODULE_CHANNELS).toEqual(wire.moduleChannels)
    expect(Object.keys(PORTAL_MODULE_CHANNELS).sort()).toEqual([...PORTAL_MODULE_IDS].sort())
    for (const channelId of Object.values(PORTAL_MODULE_CHANNELS)) {
      expect(CHANNEL_IDS).toContain(channelId)
      expect(channelId).not.toBe('portal')
    }
  })

  it('the default order is a permutation of every module id', () => {
    expect([...PORTAL_DEFAULT_MODULE_ORDER].sort()).toEqual([...PORTAL_MODULE_IDS].sort())
    expect(PORTAL_DEFAULT_LAYOUT_KEY).toBe(wire.defaultLayoutKey)
  })

  it('carries the PC-1 limits', () => {
    expect(PORTAL_LIMITS).toEqual(wire.limits)
  })

  it('pins every shape the golden file names, and only those', () => {
    expect(Object.keys(PORTAL_WIRE_SHAPE_KEYS).sort()).toEqual(Object.keys(wire.shapes).sort())
  })

  it.each(Object.entries(wire.shapes))('%s key set equals the golden key set', (name, keys) => {
    expect([...shapeKeys(name)].sort()).toEqual([...keys].sort())
  })

  it('names no Deferred display shape (Q-35)', () => {
    expect(Object.keys(wire.shapes).filter(name => /display/i.test(name))).toEqual([])
  })

  describe('no leakage by construction (XC-002)', () => {
    // The participant graph: the portal's participant shapes plus the FC-3
    // shape they embed (ContentMediaDto), so a leak one level down fails too.
    const participantGraph: Record<string, readonly string[]> = {
      ...Object.fromEntries(wire.participantShapes.map(name => [name, shapeKeys(name)])),
      ContentMediaDto: WIRE_SHAPE_KEYS.ContentMediaDto,
    }

    it.each(Object.entries(participantGraph))('%s has no forbidden key', (_, keys) => {
      // token, hash, version, actingHumanId, lastSeen, wall clock, exerciseId
      expect(keys.filter(isForbidden)).toEqual([])
    })

    it('the forbidden patterns cover the channels-foundation staff-only keys that matter here', () => {
      for (const key of ['version', 'actingHumanId', 'publishedWallClock']) {
        expect(isForbidden(key)).toBe(true)
      }
      expect(channelsWire.participantExcludedKeys).toContain('version')
    })

    it.each([
      ['tokenHash', true], ['displayToken', true], ['accessTokens', true], ['actingHumanId', true],
      ['lastSeenAt', true], ['createdWallClock', true], ['exerciseId', true], ['version', true],
      ['last_seen', true], ['hashes', true], ['hashedPassword', true], ['accesstoken', true],
      ['lastseenat', true], ['hashtagTokenCount', true],
      ['hashtags', false], ['conversation', false], ['skinOverrides', false], ['title', false],
    ] as const)('fails safe, allowing only listed words: %s -> %s', (key, expected) => {
      expect(isForbidden(key)).toBe(expected)
    })

    it('a staff shape trips the same check (the test can fail)', () => {
      expect(PORTAL_WIRE_SHAPE_KEYS.PortalConfigStaffDto.filter(isForbidden)).toEqual(['version'])
    })
  })

  describe('telemetry vocabulary (PC-6, FU-2)', () => {
    it('declares exactly the golden shapes, in PC-6 order', () => {
      expect(PORTAL_TELEMETRY_SHAPES).toEqual(wire.telemetry)
    })

    it.each(wire.telemetry.map(t => t.eventType))('%s is registered (by F02, FC-6b)', eventType => {
      expect(KNOWN_TELEMETRY_EVENT_TYPES as readonly string[]).toContain(eventType)
      expect(channelsWire.telemetryEventTypes).toContain(eventType)
    })

    it.each(PORTAL_TELEMETRY_SHAPES.filter(s => !s.deferred))(
      '$eventType builds a valid v0 envelope from its declared target and payload',
      shape => {
        const payload = Object.fromEntries(
          shape.payloadKeys.map(key => [key, key === 'fields' ? ['portalName'] : 'x']),
        )
        const event = {
          schemaVersion: 'v0',
          eventId: 'e-1',
          exerciseId: 'ex-1',
          eventType: shape.eventType,
          channel: 'portal',
          actor: shape.emitter === 'client'
            ? { kind: 'participant', participantId: 'p-1', sessionId: 's-1' }
            : { kind: 'system', actingHumanId: 'h-1', role: 'controller' },
          wallClockTime: '2026-10-29T15:00:00Z',
          scenarioTime: '2026-12-02T14:00:00Z',
          timeZone: 'America/Chicago',
          target: {
            entityType: shape.entityType,
            ...(shape.hasEntityId ? { entityId: 'id-1' } : {}),
          },
          ...(shape.payloadKeys.length > 0 ? { payload } : {}),
          emittedAt: '2026-10-29T15:00:00Z',
        }
        expect(telemetryEventV0Schema.safeParse(event).success).toBe(true)
      },
    )
  })
})
