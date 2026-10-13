/**
 * core/telemetry/mockSink.mute.test.ts
 * ---------------------------------------------------------------------------
 * `muteTelemetry()` (demo-polish C6): while any holder is muted the sink neither
 * buffers, logs, counts nor POSTs; releasing restores it. The hold is a COUNT, so
 * overlapping holders cannot unmute each other, and a release is idempotent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitTelemetryEvent,
  getEmittedTelemetryEvents,
  getTelemetryHealth,
  muteTelemetry,
  resetTelemetryBuffer,
} from './mockSink'
import type { TelemetryEventV0 } from './schema'

const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

function makeEvent(eventId: string): TelemetryEventV0 {
  return {
    schemaVersion: 'v0',
    eventId,
    exerciseId: 'exercise-1',
    eventType: 'view',
    channel: 'social',
    actor: { kind: 'participant', participantId: 'participant-1' },
    wallClockTime: '2026-07-16T19:45:00.000Z',
    scenarioTime: '2033-09-04T09:00:00.000Z',
    timeZone: 'America/Chicago',
    emittedAt: '2026-07-16T19:45:00.000Z',
  }
}

beforeEach(() => {
  resetTelemetryBuffer()
  postMock.mockReset()
  postMock.mockResolvedValue(undefined)
})

afterEach(() => {
  resetTelemetryBuffer()
  vi.restoreAllMocks()
})

describe('muteTelemetry', () => {
  it('drops an event entirely while muted: no buffer, no console log, no count, no POST', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const release = muteTelemetry()

    emitTelemetryEvent(makeEvent('muted-1'))

    expect(getEmittedTelemetryEvents()).toEqual([])
    expect(getTelemetryHealth()).toEqual({ emitted: 0, dropped: 0, buffered: 0 })
    expect(consoleSpy).not.toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
    release()
  })

  it('emits normally again once released', () => {
    const release = muteTelemetry()
    emitTelemetryEvent(makeEvent('muted-1'))
    release()

    emitTelemetryEvent(makeEvent('live-1'))

    expect(getEmittedTelemetryEvents().map(event => event.eventId)).toEqual(['live-1'])
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('is a COUNT: overlapping holders keep it muted until the last one releases', () => {
    const first = muteTelemetry()
    const second = muteTelemetry()

    first()
    emitTelemetryEvent(makeEvent('still-muted'))
    expect(getEmittedTelemetryEvents()).toEqual([])

    second()
    emitTelemetryEvent(makeEvent('live'))
    expect(getEmittedTelemetryEvents().map(event => event.eventId)).toEqual(['live'])
  })

  it('release is idempotent: a second call cannot release somebody else\'s hold', () => {
    const first = muteTelemetry()
    const second = muteTelemetry()

    first()
    first()
    emitTelemetryEvent(makeEvent('still-muted'))

    expect(getEmittedTelemetryEvents()).toEqual([])
    second()
  })

  it('resetTelemetryBuffer drops every hold, and a stale release afterwards cannot go below zero', () => {
    const stale = muteTelemetry()
    resetTelemetryBuffer()

    emitTelemetryEvent(makeEvent('after-reset'))
    expect(getEmittedTelemetryEvents()).toHaveLength(1)

    stale()
    const fresh = muteTelemetry()
    emitTelemetryEvent(makeEvent('muted-again'))
    expect(getEmittedTelemetryEvents()).toHaveLength(1)
    fresh()
  })
})
