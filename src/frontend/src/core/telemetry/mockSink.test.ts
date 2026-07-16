import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitTelemetryEvent, getEmittedTelemetryEvents, resetTelemetryBuffer } from './mockSink'
import type { TelemetryEventV0 } from './schema'

const postMock = vi.fn()

// `vi.mock` calls are hoisted above imports by Vitest, so `mockSink` (imported
// above) picks up this mocked `api` rather than the real axios client.
vi.mock('@/core/services/api', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

function makeEvent(overrides: Partial<TelemetryEventV0> = {}): TelemetryEventV0 {
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

describe('emitTelemetryEvent / mock sink', () => {
  beforeEach(() => {
    resetTelemetryBuffer()
    postMock.mockReset()
    postMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetTelemetryBuffer()
  })

  it('appends the event to the in-memory buffer', () => {
    const event = makeEvent()
    emitTelemetryEvent(event)

    expect(getEmittedTelemetryEvents()).toEqual([event])
  })

  it('preserves emission order across multiple events', () => {
    const first = makeEvent({ eventId: 'event-1', eventType: 'post' })
    const second = makeEvent({ eventId: 'event-2', eventType: 'reaction' })

    emitTelemetryEvent(first)
    emitTelemetryEvent(second)

    expect(getEmittedTelemetryEvents()).toEqual([first, second])
  })

  it('logs the event to the dev console', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const event = makeEvent({ eventType: 'login' })

    emitTelemetryEvent(event)

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('login'), event)
    consoleSpy.mockRestore()
  })

  it('best-effort POSTs the event to the mocked /telemetry endpoint', () => {
    const event = makeEvent()
    emitTelemetryEvent(event)

    expect(postMock).toHaveBeenCalledWith('/telemetry', event)
  })

  it('swallows a POST rejection without throwing back into the caller', async () => {
    postMock.mockRejectedValue(new Error('network down'))
    const event = makeEvent()

    expect(() => emitTelemetryEvent(event)).not.toThrow()

    // Flush the microtask queue so the swallowed rejection's .catch() runs
    // before the test ends (guards against an unhandled rejection).
    await Promise.resolve()
    await Promise.resolve()

    // The caller-visible effects (buffer, log) still happened despite the
    // telemetry POST failing — a send failure must never undo the emit.
    expect(getEmittedTelemetryEvents()).toEqual([event])
  })

  it('round-trips through getEmittedTelemetryEvents() and resetTelemetryBuffer()', () => {
    emitTelemetryEvent(makeEvent({ eventId: 'event-1' }))
    emitTelemetryEvent(makeEvent({ eventId: 'event-2' }))
    expect(getEmittedTelemetryEvents()).toHaveLength(2)

    resetTelemetryBuffer()

    expect(getEmittedTelemetryEvents()).toEqual([])
  })

  it('returns a snapshot copy that cannot be mutated to affect the buffer', () => {
    emitTelemetryEvent(makeEvent())
    const snapshot = getEmittedTelemetryEvents() as TelemetryEventV0[]
    snapshot.push(makeEvent({ eventId: 'not-really-emitted' }))

    expect(getEmittedTelemetryEvents()).toHaveLength(1)
  })
})
