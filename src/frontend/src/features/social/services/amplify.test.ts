/**
 * features/social/services/amplify.test.ts
 * ---------------------------------------------------------------------------
 * Covers amplification story-01 ACs (SOC-020, SOC-003, XC-004, COR-053,
 * NFR-004):
 *   - repost() emits exactly one XC-004 'repost' event on the social channel,
 *     attributed to the amplifier persona, carrying provenance (origin) and a
 *     target pointing at the amplified post — and returns a participant-safe
 *     record with NO provenance field to leak (XC-002);
 *   - quotePost() sanitizes the commentary on ingest (NFR-004), emits one
 *     'quote' event, and returns the sanitized commentary;
 *   - an inject-origin amplification carries its injectId on the envelope;
 *   - the caller-supplied scenarioTime is stamped verbatim (COR-053).
 *
 * NOTE: this file lives under `src/features/social/**`, so the participant
 * wall-clock ESLint ban (COR-053) applies — never `Date.now()` / `new Date()`.
 * The `api` mock keeps the telemetry sink's best-effort POST off the network
 * (mirrors postService.test.ts; also avoids the CI teardown race a real async
 * POST-reject can trigger).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { quotePost, repost, type QuotePostInput, type RepostInput } from './amplify'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

function repostInput(overrides: Partial<RepostInput> = {}): RepostInput {
  return {
    exerciseId: 'ex-test-1',
    timeZone: 'America/Chicago',
    scenarioTime: '2033-09-04T13:32:00Z',
    amplifierPersonaId: 'persona-mvega_fh',
    actingHumanId: 'human-participant-mvega',
    originalPostId: 'post-seed-fwupd-rumor',
    origin: 'participant',
    ...overrides,
  }
}

function quoteInput(overrides: Partial<QuotePostInput> = {}): QuotePostInput {
  return {
    ...repostInput(),
    commentary: 'this is not confirmed — please wait for the official account',
    ...overrides,
  }
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetTelemetryBuffer()
})

describe('exercise isolation (COR-001)', () => {
  it('stamps the record with the caller-supplied exerciseId only — never a different one', () => {
    const record = repost(repostInput({ exerciseId: 'ex-alpha' }))
    expect(record.exerciseId).toBe('ex-alpha')

    const otherExerciseRecord = repost(repostInput({ exerciseId: 'ex-bravo' }))
    expect(otherExerciseRecord.exerciseId).toBe('ex-bravo')
    expect(otherExerciseRecord.exerciseId).not.toBe(record.exerciseId)
  })

  it('stamps the telemetry envelope with the same exerciseId as the record (no cross-exercise drift)', () => {
    const record = repost(repostInput({ exerciseId: 'ex-alpha' }))

    const event = getEmittedTelemetryEvents().find(e => e.eventType === 'repost')
    expect(event?.exerciseId).toBe('ex-alpha')
    expect(event?.exerciseId).toBe(record.exerciseId)
  })

  it('quotePost stamps exerciseId on both the record and its telemetry envelope', () => {
    const record = quotePost(quoteInput({ exerciseId: 'ex-charlie' }))

    expect(record.exerciseId).toBe('ex-charlie')
    const event = getEmittedTelemetryEvents().find(e => e.eventType === 'quote')
    expect(event?.exerciseId).toBe('ex-charlie')
  })
})

describe('repost (SOC-020)', () => {
  it('returns a participant-safe repost record pointing at the original', () => {
    const record = repost(repostInput())

    expect(record.kind).toBe('repost')
    expect(record.originalPostId).toBe('post-seed-fwupd-rumor')
    expect(record.amplifierPersonaId).toBe('persona-mvega_fh')
    expect(record.scenarioTime).toBe('2033-09-04T13:32:00Z')
    expect(record.id).toMatch(/^repost-/)
    // No provenance leaked onto the returned record (XC-002).
    expect(record).not.toHaveProperty('origin')
    expect(record).not.toHaveProperty('actingHumanId')
  })

  it('emits exactly one XC-004 "repost" event with provenance + target (SOC-003)', () => {
    repost(repostInput({ origin: 'controller-as-persona' }))

    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'repost')
    expect(events).toHaveLength(1)
    const event = events[0]
    if (!event) throw new Error('expected a repost event')

    expect(event.channel).toBe('social')
    expect(event.actor.kind).toBe('persona')
    expect(event.actor.personaId).toBe('persona-mvega_fh')
    expect(event.actor.actingHumanId).toBe('human-participant-mvega')
    expect(event.origin).toBe('controller-as-persona')
    expect(event.target?.entityId).toBe('post-seed-fwupd-rumor')
    expect(event.scenarioTime).toBe('2033-09-04T13:32:00Z')
    expect(event.timeZone).toBe('America/Chicago')
  })

  it('carries the injectId on the envelope for an inject-origin repost', () => {
    repost(repostInput({ origin: 'inject', injectId: '042' }))

    const event = getEmittedTelemetryEvents().find(e => e.eventType === 'repost')
    expect(event?.origin).toBe('inject')
    expect(event?.injectId).toBe('042')
  })
})

describe('quotePost (SOC-020, NFR-004)', () => {
  it('returns a quote record carrying the commentary + original reference', () => {
    const record = quotePost(quoteInput())

    expect(record.kind).toBe('quote')
    expect(record.originalPostId).toBe('post-seed-fwupd-rumor')
    expect(record.commentary).toBe(
      'this is not confirmed — please wait for the official account',
    )
    expect(record.id).toMatch(/^quote-/)
    expect(record).not.toHaveProperty('origin')
  })

  it('sanitizes the commentary on ingest (NFR-004) — strips script markup', () => {
    const record = quotePost(
      quoteInput({ commentary: 'look <script>alert(1)</script> at this' }),
    )

    expect(record.commentary).not.toContain('<script>')
    expect(record.commentary).not.toContain('alert(1)')
    expect(record.commentary).toContain('look')
    expect(record.commentary).toContain('at this')
  })

  it('emits exactly one XC-004 "quote" event on the social channel', () => {
    quotePost(quoteInput())

    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'quote')
    expect(events).toHaveLength(1)
    const event = events[0]
    if (!event) throw new Error('expected a quote event')

    expect(event.channel).toBe('social')
    expect(event.actor.kind).toBe('persona')
    expect(event.target?.entityId).toBe('post-seed-fwupd-rumor')
    expect(event.origin).toBe('participant')
  })

  it('threads a causationId onto the envelope when supplied (SOC-022 seam)', () => {
    quotePost(quoteInput({ causationId: 'evt-original-post-1' }))

    const event = getEmittedTelemetryEvents().find(e => e.eventType === 'quote')
    expect(event?.causationId).toBe('evt-original-post-1')
  })
})
