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
})
