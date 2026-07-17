import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAndEmit,
  buildTelemetryEvent,
  generateEventId,
  TelemetryValidationError,
  type BuildTelemetryEventInput,
} from './emitter'
import { telemetryEventV0Schema } from './schema'
import { getEmittedTelemetryEvents, getTelemetryHealth, resetTelemetryBuffer } from './mockSink'

// `buildAndEmit` routes through the mock sink, which best-effort POSTs via the
// shared axios client - mock it so these tests never touch the network (mirrors
// mockSink.test.ts).
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

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

describe('generateEventId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a UUID-shaped string', () => {
    const id = generateEventId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 25 }, () => generateEventId()))
    expect(ids.size).toBe(25)
  })

  it('produces a UUIDv4-shaped id via the getRandomValues fallback when randomUUID is absent', () => {
    const realCrypto = globalThis.crypto
    // Expose ONLY getRandomValues - no randomUUID - the plain-HTTP-deploy case
    // (COR-008/COR-009) generateEventId is designed to survive.
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })

    const id = generateEventId()

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('still returns a unique, non-throwing id when crypto is entirely unavailable', () => {
    vi.stubGlobal('crypto', undefined)

    let first = ''
    let second = ''

    expect(() => {
      first = generateEventId()
      second = generateEventId()
    }).not.toThrow()

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })
})

describe('buildAndEmit', () => {
  beforeEach(() => {
    resetTelemetryBuffer()
  })

  afterEach(() => {
    resetTelemetryBuffer()
  })

  it('returns the built event and emits it to the sink on valid input', () => {
    const event = buildAndEmit(validInput())

    expect(event).not.toBeNull()
    expect(getEmittedTelemetryEvents()).toHaveLength(1)
    expect(getEmittedTelemetryEvents()[0]).toEqual(event)
  })

  it('returns null, never throws, on invalid input', () => {
    expect(() => buildAndEmit(validInput({ exerciseId: '' }))).not.toThrow()

    const result = buildAndEmit(validInput({ exerciseId: '' }))
    expect(result).toBeNull()
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('counts a build failure in getTelemetryHealth().dropped without emitting anything', () => {
    const before = getTelemetryHealth().dropped

    buildAndEmit(validInput({ exerciseId: '' }))

    expect(getTelemetryHealth().dropped).toBe(before + 1)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })
})
