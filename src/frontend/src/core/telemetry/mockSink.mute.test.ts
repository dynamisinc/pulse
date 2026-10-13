/**
 * core/telemetry/mockSink.mute.test.ts
 * ---------------------------------------------------------------------------
 * `muteTelemetry()` (demo-polish C6): while any holder is muted the sink drops
 * PARTICIPANT-kind events -- no buffer, no log, no count, no POST -- and nothing else.
 * Every other actor kind (`persona`, `system`, `engine`) is emitted as usual: the mute is
 * held by the staff preview, but the sink is process-wide, and a controller's audit record
 * (the takedown's `steering_action`, a lifecycle event) can be emitted while a preview is
 * open. The hold is a COUNT, so overlapping holders cannot unmute each other, a release is
 * idempotent, and a release taken before a reset cannot decrement a hold taken after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAndEmit } from './emitter'
import {
  emitTelemetryEvent,
  getEmittedTelemetryEvents,
  getTelemetryHealth,
  muteTelemetry,
  resetTelemetryBuffer,
} from './mockSink'
import type { TelemetryActor, TelemetryEventV0 } from './schema'

const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

function makeEvent(
  eventId: string,
  overrides: Partial<TelemetryEventV0> = {},
): TelemetryEventV0 {
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
    ...overrides,
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

describe('muteTelemetry -- participant events', () => {
  it('drops a participant-kind event entirely while muted: no buffer, log, count or POST', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const release = muteTelemetry()

    emitTelemetryEvent(makeEvent('muted-1'))

    expect(getEmittedTelemetryEvents()).toEqual([])
    expect(getTelemetryHealth()).toEqual({ emitted: 0, dropped: 0, buffered: 0 })
    expect(consoleSpy).not.toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
    release()
  })

  it('emits participant events normally again once released', () => {
    const release = muteTelemetry()
    emitTelemetryEvent(makeEvent('muted-1'))
    release()

    emitTelemetryEvent(makeEvent('live-1'))

    expect(getEmittedTelemetryEvents().map(event => event.eventId)).toEqual(['live-1'])
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})

describe('muteTelemetry -- CR-001: it never swallows anything that is not a participant event', () => {
  const NON_PARTICIPANT_ACTORS: ReadonlyArray<readonly [string, TelemetryActor]> = [
    ['system', { kind: 'system', actingHumanId: 'human-controller-01', role: 'controller' }],
    ['engine', { kind: 'engine' }],
    ['persona', { kind: 'persona', personaId: 'persona-fulcoem', actingHumanId: 'human-1' }],
  ]

  it.each(NON_PARTICIPANT_ACTORS)(
    'a %s-kind event emitted WHILE muted is still buffered, counted and POSTed',
    (_label, actor) => {
      const release = muteTelemetry()
      const event = makeEvent('audit-1', { eventType: 'steering_action', channel: 'system', actor })

      emitTelemetryEvent(event)

      expect(getEmittedTelemetryEvents()).toEqual([event])
      expect(getTelemetryHealth().emitted).toBe(1)
      expect(postMock).toHaveBeenCalledTimes(1)
      expect(postMock).toHaveBeenCalledWith('/telemetry', event)
      release()
    },
  )

  it('keeps the takedown\'s audit record: a steering_action emitted from a request\'s `.then` after the preview opened', async () => {
    // The takedown (C5) emits its only record client-side, when the DELETE resolves -- which can
    // be after the controller has opened the preview. Opening the preview must not lose it.
    const release = muteTelemetry()

    await Promise.resolve().then(() => {
      buildAndEmit({
        exerciseId: 'exercise-1',
        eventType: 'steering_action',
        channel: 'system',
        actor: { kind: 'system', actingHumanId: 'human-controller-01', role: 'controller' },
        wallClockTime: '2026-07-16T19:45:00.000Z',
        scenarioTime: '2033-09-04T09:00:00.000Z',
        timeZone: 'America/Chicago',
        target: { entityType: 'post', entityId: 'post-9' },
        payload: { action: 'takedown', category: 'pii' },
      })
    })

    const [recorded] = getEmittedTelemetryEvents()
    expect(recorded).toMatchObject({
      eventType: 'steering_action',
      actor: { kind: 'system' },
      target: { entityId: 'post-9' },
    })
    expect(postMock).toHaveBeenCalledTimes(1)
    release()
  })

  it('in one mixed burst under a mute, only the participant events are lost', () => {
    const release = muteTelemetry()

    emitTelemetryEvent(makeEvent('p-1'))
    emitTelemetryEvent(makeEvent('s-1', { actor: { kind: 'system' } }))
    emitTelemetryEvent(makeEvent('p-2'))
    emitTelemetryEvent(makeEvent('e-1', { actor: { kind: 'engine' } }))
    emitTelemetryEvent(makeEvent('c-1', { actor: { kind: 'persona', personaId: 'persona-x' } }))

    expect(getEmittedTelemetryEvents().map(event => event.eventId)).toEqual(['s-1', 'e-1', 'c-1'])
    expect(postMock).toHaveBeenCalledTimes(3)
    release()
  })
})

describe('muteTelemetry -- holds', () => {
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

  it('resetTelemetryBuffer drops every hold', () => {
    muteTelemetry()
    resetTelemetryBuffer()

    emitTelemetryEvent(makeEvent('after-reset'))

    expect(getEmittedTelemetryEvents()).toHaveLength(1)
  })

  it('S-6: a release taken BEFORE a reset cannot decrement a hold taken AFTER it', () => {
    const stale = muteTelemetry()
    resetTelemetryBuffer()
    const fresh = muteTelemetry()

    stale()
    emitTelemetryEvent(makeEvent('must-stay-muted'))
    expect(getEmittedTelemetryEvents()).toEqual([])

    fresh()
    emitTelemetryEvent(makeEvent('after-fresh-release'))
    expect(getEmittedTelemetryEvents().map(event => event.eventId)).toEqual(['after-fresh-release'])
  })

  it('S-6: a stale release stays a no-op even when it runs more than once', () => {
    const stale = muteTelemetry()
    resetTelemetryBuffer()
    const fresh = muteTelemetry()

    stale()
    stale()
    emitTelemetryEvent(makeEvent('still-muted'))

    expect(getEmittedTelemetryEvents()).toEqual([])
    fresh()
  })
})
