import { describe, expect, it } from 'vitest'
import { KNOWN_TELEMETRY_EVENT_TYPES } from '@/core/telemetry/schema'
import { CONTENT_KINDS, WIRE_SHAPE_KEYS } from '@/features/channels/contract'
import wire from './pressWireContract.json'
import { isForbiddenKey } from '@/features/portal/contract'
import { PRESS_TELEMETRY_SHAPES } from './telemetry'
import { PRESS_WIRE_SHAPE_KEYS } from './types'
import {
  INPUT_PATHS,
  LETTERHEAD_EXT_KEYS,
  PARTICIPANT_PAYLOAD_KEYS,
  PRESS_LIMITS,
  RELEASE_STATES,
  STAFF_ONLY_PAYLOAD_KEYS,
  WIRE_ROOM_SLUG,
  isInputPath,
  isReleaseState,
} from './vocabulary'

function shapeKeys(name: string): readonly string[] {
  return PRESS_WIRE_SHAPE_KEYS[name as keyof typeof PRESS_WIRE_SHAPE_KEYS]
}

function isForbidden(key: string): boolean {
  return isForbiddenKey(key, wire.participantForbiddenKeyPatterns, wire.participantAllowedWords)
}

/**
 * Press-room story 01 (#738): the TS half of the C#<->TS parity check.
 * `pressWireContract.json` is the one golden file; the server's
 * PressContractParityTests asserts the C# records, PressVocabulary and
 * PressTelemetry against the same file, so the two sides can only agree.
 */
describe('press wire contract (PC-1 / PC-2 / PC-5)', () => {
  it.each([
    ['releaseStates', RELEASE_STATES],
    ['inputPaths', INPUT_PATHS],
    ['letterheadExtKeys', LETTERHEAD_EXT_KEYS],
  ] as const)('vocabulary.ts %s equals the golden list, in order', (name, values) => {
    expect([...values]).toEqual(wire.vocabulary[name])
  })

  it('carries the wire-room slug, the limits and the payload key lists', () => {
    expect(WIRE_ROOM_SLUG).toBe(wire.wireRoomSlug)
    expect(PRESS_LIMITS).toEqual(wire.limits)
    expect([...PARTICIPANT_PAYLOAD_KEYS]).toEqual(wire.participantPayloadKeys)
    expect([...STAFF_ONLY_PAYLOAD_KEYS]).toEqual(wire.staffOnlyPayloadKeys)
  })

  it('release is a registered FC-1 content kind', () => {
    expect(CONTENT_KINDS).toContain('release')
  })

  it('the guards close over the vocabulary', () => {
    for (const state of wire.vocabulary.releaseStates) expect(isReleaseState(state)).toBe(true)
    for (const path of wire.vocabulary.inputPaths) expect(isInputPath(path)).toBe(true)
    expect(isReleaseState('archived')).toBe(false)
    expect(isInputPath('pdf')).toBe(false)
  })

  it('pins every shape the golden file names, and only those', () => {
    expect(Object.keys(PRESS_WIRE_SHAPE_KEYS).sort()).toEqual(Object.keys(wire.shapes).sort())
  })

  it.each(Object.entries(wire.shapes))('%s key set equals the golden key set', (name, keys) => {
    expect([...shapeKeys(name)].sort()).toEqual([...keys].sort())
  })

  describe('no leakage by construction (XC-002)', () => {
    // The participant graph: the press participant shapes plus the FC-3 shape
    // they sit beside (ContentMediaDto), so a leak one level down fails too.
    const participantGraph: Record<string, readonly string[]> = {
      ...Object.fromEntries(wire.participantShapes.map(name => [name, shapeKeys(name)])),
      ContentMediaDto: WIRE_SHAPE_KEYS.ContentMediaDto,
    }

    it.each(Object.entries(participantGraph))('%s has no forbidden key', (_, keys) => {
      expect(keys.filter(isForbidden)).toEqual([])
    })

    it('the participant payload keys are exactly the golden participant list', () => {
      expect([...shapeKeys('ReleaseParticipantPayloadDto')]).toEqual(wire.participantPayloadKeys)
    })

    it('every staff-only payload key trips the forbidden check, and sits in no participant shape', () => {
      for (const key of wire.staffOnlyPayloadKeys) {
        expect(isForbidden(key), key).toBe(true)
        for (const name of wire.participantShapes) expect(shapeKeys(name)).not.toContain(key)
      }
    })

    it('the author shapes trip the same check (the test can fail)', () => {
      expect(shapeKeys('ReleaseAuthorPayloadDto').filter(isForbidden).sort()).toEqual(
        ['boilerplate', 'crossPost', 'inputPath', 'orgPersonaId'],
      )
      expect(shapeKeys('ReleaseAuthorDto').filter(isForbidden).sort()).toEqual(['orgPersonaId', 'version'])
    })
  })

  describe('telemetry vocabulary (PC-5)', () => {
    it('declares exactly the golden shapes, in order', () => {
      expect(PRESS_TELEMETRY_SHAPES).toEqual(wire.telemetry)
    })

    it.each(wire.telemetry.map(t => t.eventType))('%s is a registered event type', eventType => {
      expect(KNOWN_TELEMETRY_EVENT_TYPES as readonly string[]).toContain(eventType)
    })

    it('no payload key names release text or a wall-clock value', () => {
      for (const shape of PRESS_TELEMETRY_SHAPES) {
        for (const key of shape.payloadKeys as readonly string[]) {
          expect(/wallclock|headline|body|text/i.test(key), `${shape.eventType}.${key}`).toBe(false)
        }
      }
    })
  })
})
