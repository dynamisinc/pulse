import { describe, expect, it } from 'vitest'
import { buildTelemetryEvent, TelemetryValidationError, type BuildTelemetryEventInput } from './emitter'
import { telemetryEventV0Schema } from './schema'

/** A minimal, fully-valid `buildTelemetryEvent` input. */
function validInput(overrides: Partial<BuildTelemetryEventInput> = {}): BuildTelemetryEventInput {
  return {
    exerciseId: 'exercise-1',
    eventType: 'post',
    channel: 'social',
    actor: { kind: 'participant', participantId: 'participant-1' },
    wallClockTime: '2026-07-16T19:45:00.000Z',
    scenarioTime: '2033-09-04T09:00:00.000Z',
    timeZone: 'America/Chicago',
    ...overrides,
  }
}

describe('buildTelemetryEvent', () => {
  it('stamps a generated eventId and an emittedAt timestamp', () => {
    const before = Date.now()
    const event = buildTelemetryEvent(validInput())
    const after = Date.now()

    expect(event.eventId).toBeTruthy()
    expect(typeof event.eventId).toBe('string')

    expect(event.emittedAt).toBeTruthy()
    const emittedAtMs = Date.parse(event.emittedAt)
    expect(Number.isNaN(emittedAtMs)).toBe(false)
    expect(emittedAtMs).toBeGreaterThanOrEqual(before)
    expect(emittedAtMs).toBeLessThanOrEqual(after)
  })

  it('stamps a different eventId on every call (no collisions)', () => {
    const first = buildTelemetryEvent(validInput())
    const second = buildTelemetryEvent(validInput())
    expect(first.eventId).not.toBe(second.eventId)
  })

  it('defaults schemaVersion to the locked "v0" literal', () => {
    const event = buildTelemetryEvent(validInput())
    expect(event.schemaVersion).toBe('v0')
  })

  it('returns an event that independently validates against the v0 schema', () => {
    const event = buildTelemetryEvent(validInput())
    const result = telemetryEventV0Schema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it('preserves caller-supplied fields on the built event', () => {
    const event = buildTelemetryEvent(
      validInput({
        eventType: 'reaction',
        target: { entityType: 'post', entityId: 'post-42' },
      }),
    )

    expect(event.eventType).toBe('reaction')
    expect(event.exerciseId).toBe('exercise-1')
    expect(event.target).toEqual({ entityType: 'post', entityId: 'post-42' })
  })

  // ---------------------------------------------------------------------
  // Isolation (XC-001 / COR-001): a missing/empty exerciseId must never
  // build into an emittable event.
  // ---------------------------------------------------------------------

  it('throws TelemetryValidationError when exerciseId is missing', () => {
    const { exerciseId: _drop, ...withoutExerciseId } = validInput()

    expect(() => buildTelemetryEvent(withoutExerciseId as BuildTelemetryEventInput)).toThrow(
      TelemetryValidationError,
    )
  })

  it('throws TelemetryValidationError when exerciseId is an empty string', () => {
    expect(() => buildTelemetryEvent(validInput({ exerciseId: '' }))).toThrow(
      TelemetryValidationError,
    )
  })

  it('surfaces the exerciseId path in the thrown error issues', () => {
    expect.assertions(2)
    try {
      buildTelemetryEvent(validInput({ exerciseId: '' }))
    } catch (error) {
      expect(error).toBeInstanceOf(TelemetryValidationError)
      const validationError = error as TelemetryValidationError
      expect(validationError.issues.some(issue => issue.path.includes('exerciseId'))).toBe(true)
    }
  })

  it('never returns a malformed event for an invalid input (throws instead)', () => {
    let event: unknown
    try {
      event = buildTelemetryEvent(validInput({ exerciseId: '' }))
    } catch {
      event = undefined
    }
    expect(event).toBeUndefined()
  })

  // ---------------------------------------------------------------------
  // Other required-field validation (not just isolation)
  // ---------------------------------------------------------------------

  it('throws TelemetryValidationError for an unrecognized channel', () => {
    expect(() =>
      buildTelemetryEvent(
        // Intentionally invalid at runtime; cast bypasses the compile-time union.
        validInput({ channel: 'carrier-pigeon' as BuildTelemetryEventInput['channel'] }),
      ),
    ).toThrow(TelemetryValidationError)
  })

  it('throws TelemetryValidationError for a non-ISO scenarioTime', () => {
    expect(() => buildTelemetryEvent(validInput({ scenarioTime: 'not-a-date' }))).toThrow(
      TelemetryValidationError,
    )
  })
})
