import { describe, expect, it } from 'vitest'
import {
  KNOWN_TELEMETRY_EVENT_TYPES,
  telemetryEventV0Schema,
} from './schema'

/**
 * A minimal, fully-valid v0 envelope. Individual tests spread + override
 * fields to exercise a single validation rule at a time.
 */
function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'v0',
    eventId: 'event-1',
    exerciseId: 'exercise-1',
    eventType: 'post',
    channel: 'social',
    actor: { kind: 'participant', participantId: 'participant-1' },
    wallClockTime: '2026-07-16T19:45:00.000Z',
    scenarioTime: '2033-09-04T09:00:00.000Z',
    timeZone: 'America/Chicago',
    emittedAt: '2026-07-16T19:45:00.000Z',
    ...overrides,
  }
}

describe('telemetryEventV0Schema', () => {
  it('validates a minimal, fully-populated v0 event', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent())
    expect(result.success).toBe(true)
  })

  it('validates a v0 event with every optional field populated', () => {
    const result = telemetryEventV0Schema.safeParse(
      validEvent({
        actor: {
          kind: 'persona',
          participantId: 'participant-1',
          personaId: 'persona-1',
          actingHumanId: 'human-1',
          sessionId: 'session-1',
          role: 'controller',
        },
        origin: 'controller-as-persona',
        injectId: 'inject-1',
        target: { entityType: 'post', entityId: 'post-1' },
        payload: { body: 'hello', tags: ['a', 'b'] },
      }),
    )
    expect(result.success).toBe(true)
  })

  // ---------------------------------------------------------------------
  // Isolation (XC-001 / COR-001): exerciseId is required and non-empty.
  // ---------------------------------------------------------------------

  it('rejects an event with no exerciseId field at all', () => {
    const { exerciseId: _drop, ...withoutExerciseId } = validEvent()
    const result = telemetryEventV0Schema.safeParse(withoutExerciseId)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.path.includes('exerciseId'))).toBe(true)
    }
  })

  it('rejects an event with an empty-string exerciseId', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ exerciseId: '' }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.path.includes('exerciseId'))).toBe(true)
    }
  })

  it('rejects an event with a null exerciseId', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ exerciseId: null }))
    expect(result.success).toBe(false)
  })

  // ---------------------------------------------------------------------
  // Envelope shape
  // ---------------------------------------------------------------------

  it('rejects a schemaVersion other than the locked "v0" literal', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ schemaVersion: 'v1' }))
    expect(result.success).toBe(false)
  })

  it('rejects a missing schemaVersion', () => {
    const { schemaVersion: _drop, ...withoutVersion } = validEvent()
    const result = telemetryEventV0Schema.safeParse(withoutVersion)
    expect(result.success).toBe(false)
  })

  it('rejects an unknown channel', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ channel: 'carrier-pigeon' }))
    expect(result.success).toBe(false)
  })

  it('rejects a missing actor block', () => {
    const { actor: _drop, ...withoutActor } = validEvent()
    const result = telemetryEventV0Schema.safeParse(withoutActor)
    expect(result.success).toBe(false)
  })

  it('rejects an unknown actor.kind', () => {
    const result = telemetryEventV0Schema.safeParse(
      validEvent({ actor: { kind: 'robot' } }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects an unknown origin', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ origin: 'time-traveler' }))
    expect(result.success).toBe(false)
  })

  it('rejects an unknown top-level key (the envelope is closed — extend via payload)', () => {
    // strictObject: unknown keys fail loudly rather than being silently
    // stripped, so a typo'd field or top-level event data can't slip through.
    const result = telemetryEventV0Schema.safeParse(validEvent({ notAField: 'nope' }))
    expect(result.success).toBe(false)
  })

  it.each(['wallClockTime', 'scenarioTime', 'emittedAt'])(
    'rejects a non-date-time string for %s',
    field => {
      const result = telemetryEventV0Schema.safeParse(validEvent({ [field]: 'not-a-date' }))
      expect(result.success).toBe(false)
    },
  )

  it.each(['2033', 'March 4 2033'])(
    'rejects a lenient, non-ISO-8601 date-time string %s (stricter than Date.parse)',
    value => {
      // Date.parse would accept these; the v0 schema must not, so a malformed
      // timestamp cannot reach E10/E9/E8 downstream.
      const result = telemetryEventV0Schema.safeParse(validEvent({ wallClockTime: value }))
      expect(result.success).toBe(false)
    },
  )

  it('rejects an empty timeZone', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ timeZone: '' }))
    expect(result.success).toBe(false)
  })

  it('rejects an empty eventType', () => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ eventType: '' }))
    expect(result.success).toBe(false)
  })

  it('accepts an eventType outside the documented Phase-1 vocabulary (open string)', () => {
    // The schema is deliberately open so later features (e.g. E8 engine event
    // types) can extend the vocabulary without an envelope migration.
    const result = telemetryEventV0Schema.safeParse(
      validEvent({ eventType: 'engine.observed' }),
    )
    expect(result.success).toBe(true)
  })

  // ---------------------------------------------------------------------
  // Documented v0 eventType vocabulary — every known type validates.
  // ---------------------------------------------------------------------

  it.each(KNOWN_TELEMETRY_EVENT_TYPES)('validates a hand-built "%s" event', eventType => {
    const result = telemetryEventV0Schema.safeParse(validEvent({ eventType }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.eventType).toBe(eventType)
    }
  })

  it('covers all 14 documented Phase-1 event types', () => {
    // Guards against someone silently trimming the documented vocabulary.
    expect(KNOWN_TELEMETRY_EVENT_TYPES).toHaveLength(14)
  })

  // ---------------------------------------------------------------------
  // Conditional attribution (superRefine) - XC-004 / COR-018 / COR-015.
  // A plain object schema can't express "required when a sibling field has
  // a particular value"; these rules close that silent-attribution-drop
  // hole via the envelope's superRefine.
  // ---------------------------------------------------------------------

  describe('conditional attribution (superRefine)', () => {
    it('rejects actor.kind "participant" without participantId', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({ actor: { kind: 'participant' } }),
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(
          result.error.issues.some(issue => issue.path.join('.') === 'actor.participantId'),
        ).toBe(true)
      }
    })

    it('rejects actor.kind "persona" without personaId', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({ actor: { kind: 'persona' } }),
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(
          result.error.issues.some(issue => issue.path.join('.') === 'actor.personaId'),
        ).toBe(true)
      }
    })

    it('rejects origin "controller-as-persona" without actor.actingHumanId (COR-018)', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({
          actor: { kind: 'persona', personaId: 'persona-1' },
          origin: 'controller-as-persona',
        }),
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(
          result.error.issues.some(issue => issue.path.join('.') === 'actor.actingHumanId'),
        ).toBe(true)
      }
    })

    it('accepts origin "controller-as-persona" when actor.actingHumanId is present (COR-018)', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({
          actor: { kind: 'persona', personaId: 'persona-1', actingHumanId: 'human-1' },
          origin: 'controller-as-persona',
        }),
      )
      expect(result.success).toBe(true)
    })

    it('rejects origin "inject" without injectId', () => {
      const result = telemetryEventV0Schema.safeParse(validEvent({ origin: 'inject' }))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.join('.') === 'injectId')).toBe(true)
      }
    })

    it('accepts origin "inject" when injectId is present', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({ origin: 'inject', injectId: 'inject-1' }),
      )
      expect(result.success).toBe(true)
    })

    it.each(['view', 'article_view'])(
      'rejects a "%s" event whose actor has neither participantId nor sessionId (COR-015)',
      eventType => {
        const result = telemetryEventV0Schema.safeParse(
          validEvent({ eventType, actor: { kind: 'system' } }),
        )
        expect(result.success).toBe(false)
      },
    )

    it('accepts a "view" event whose actor has only sessionId (anonymous reach counting, COR-015)', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({
          eventType: 'view',
          actor: { kind: 'system', sessionId: 'session-1' },
        }),
      )
      expect(result.success).toBe(true)
    })

    it.each(['system', 'engine'] as const)(
      'accepts a "%s" actor with no participant/session ids for a non-view event type',
      kind => {
        const result = telemetryEventV0Schema.safeParse(
          validEvent({ eventType: 'post', actor: { kind } }),
        )
        expect(result.success).toBe(true)
      },
    )
  })

  // ---------------------------------------------------------------------
  // Nested strict (silent-attribution-drop hole): unknown keys inside
  // nested blocks must reject too, mirroring the top-level unknown-key test.
  // ---------------------------------------------------------------------

  describe('nested strict objects', () => {
    it('rejects an unknown key inside actor', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({
          actor: { kind: 'participant', participantId: 'participant-1', extraField: 'nope' },
        }),
      )
      expect(result.success).toBe(false)
    })

    it('rejects an unknown key inside target', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({
          target: { entityType: 'post', entityId: 'post-1', extraField: 'nope' },
        }),
      )
      expect(result.success).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // Reserved envelope fields: correlationId / causationId / sequence / source.
  // ---------------------------------------------------------------------

  describe('reserved envelope fields', () => {
    it.each(['correlationId', 'causationId', 'source'])(
      'accepts a non-empty %s',
      field => {
        const result = telemetryEventV0Schema.safeParse(validEvent({ [field]: 'reserved-value-1' }))
        expect(result.success).toBe(true)
      },
    )

    it.each(['correlationId', 'causationId', 'source'])(
      'rejects an empty-string %s',
      field => {
        const result = telemetryEventV0Schema.safeParse(validEvent({ [field]: '' }))
        expect(result.success).toBe(false)
      },
    )

    it('accepts a non-negative integer sequence, including zero', () => {
      expect(telemetryEventV0Schema.safeParse(validEvent({ sequence: 0 })).success).toBe(true)
      expect(telemetryEventV0Schema.safeParse(validEvent({ sequence: 42 })).success).toBe(true)
    })

    it('rejects a negative sequence', () => {
      const result = telemetryEventV0Schema.safeParse(validEvent({ sequence: -1 }))
      expect(result.success).toBe(false)
    })

    it('rejects a non-integer sequence', () => {
      const result = telemetryEventV0Schema.safeParse(validEvent({ sequence: 1.5 }))
      expect(result.success).toBe(false)
    })

    it('validates a fully-populated event with every reserved envelope field set', () => {
      const result = telemetryEventV0Schema.safeParse(
        validEvent({
          correlationId: 'corr-1',
          causationId: 'evt-parent-1',
          sequence: 3,
          source: 'social-compose',
        }),
      )
      expect(result.success).toBe(true)
    })
  })
})
