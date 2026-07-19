/**
 * features/controller/services/composeService.test.ts
 * ---------------------------------------------------------------------------
 * Security-critical coverage for the post-as-persona publish seam (persona-
 * operation/01; CTL-001, COR-018, SOC-003, XC-002, XC-004, NFR-004).
 *
 * `composeAsPersona` is a thin wrapper over the shipped `createPost`, so these
 * tests verify the WIRING that matters:
 *  - the XC-004 telemetry event (emitted by `createPost`) carries
 *    `origin: 'controller-as-persona'`, the acting-human controller id
 *    (COR-018), the persona id, and BOTH wall-clock + scenario timestamps;
 *  - the ONLY participant path (`toParticipantView`) structurally drops every
 *    controller-provenance field (SOC-003/XC-002);
 *  - a stored-XSS payload is stripped before it reaches the created post
 *    (NFR-004 — via `createPost`'s sanitizer, not re-implemented here).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getEmittedTelemetryEvents,
  resetTelemetryBuffer,
} from '@/core/telemetry'
import { toParticipantView } from '@/features/social'
import { composeAsPersona, type ComposeAsPersonaInput } from './composeService'

// composeAsPersona → createPost → buildAndEmit best-effort POSTs via the shared
// axios client; mock it so these pure tests never touch the network (mirrors
// features/social/services/postService.test.ts).
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

const BASE_INPUT: ComposeAsPersonaInput = {
  exerciseId: 'ex-mock-0001',
  timeZone: 'America/New_York',
  scenarioTime: '2032-05-01T10:00:00.000Z',
  authorPersonaId: 'persona-fairhavenwater',
  actingHumanId: 'human-ctl-7',
  text: 'Boil-water advisory lifted for Zone 3.',
}

beforeEach(() => {
  resetTelemetryBuffer()
})

describe('composeAsPersona — telemetry (XC-004, COR-018)', () => {
  it('emits exactly one post event with controller-as-persona provenance + dual time', () => {
    composeAsPersona(BASE_INPUT)

    const posts = getEmittedTelemetryEvents().filter(e => e.eventType === 'post')
    expect(posts).toHaveLength(1)
    const event = posts[0]
    expect(event?.channel).toBe('social')
    // SOC-003: the controller sent it, and the telemetry knows.
    expect(event?.origin).toBe('controller-as-persona')
    // XC-004: actor is the persona; the operating human rides on actingHumanId.
    expect(event?.actor.kind).toBe('persona')
    expect(event?.actor.personaId).toBe('persona-fairhavenwater')
    // COR-018: the operating controller is attributed.
    expect(event?.actor.actingHumanId).toBe('human-ctl-7')
    // Dual time: scenario is the passed instant; wall-clock is stamped too.
    expect(event?.scenarioTime).toBe('2032-05-01T10:00:00.000Z')
    expect(typeof event?.wallClockTime).toBe('string')
    expect(event?.wallClockTime.length).toBeGreaterThan(0)
  })

  it('stamps the created post as controller-as-persona authored by the active persona', () => {
    const post = composeAsPersona(BASE_INPUT)
    expect(post.origin).toBe('controller-as-persona')
    expect(post.authorPersonaId).toBe('persona-fairhavenwater')
    expect(post.actingHumanId).toBe('human-ctl-7')
    expect(post.scenarioTime).toBe('2032-05-01T10:00:00.000Z')
  })
})

describe('composeAsPersona — origin never participant-visible (SOC-003/XC-002)', () => {
  it('drops origin/actingHumanId/createdWallClock/injectId from the participant view', () => {
    const post = composeAsPersona(BASE_INPUT)
    const view = toParticipantView(post)

    expect(view).not.toHaveProperty('origin')
    expect(view).not.toHaveProperty('actingHumanId')
    expect(view).not.toHaveProperty('createdWallClock')
    expect(view).not.toHaveProperty('injectId')
    // The participant DOES still see the persona-authored content + scenario time.
    expect(view.authorPersonaId).toBe('persona-fairhavenwater')
    expect(view.scenarioTime).toBe('2032-05-01T10:00:00.000Z')
  })
})

describe('composeAsPersona — content security (NFR-004)', () => {
  it('strips a stored-XSS <script> payload from the composed text before publish', () => {
    const post = composeAsPersona({
      ...BASE_INPUT,
      text: '<script>window.__xss = true</script>Advisory update',
    })
    expect(post.text).not.toMatch(/<script/i)
    expect(post.text).toContain('Advisory update')
  })

  // A different vector than the <script> case above: an attribute-based
  // payload on an ordinary-looking tag. Exercises the sanitizer's "strip
  // every tag" path, not just the special-cased <script>/<style> block — a
  // regression that only special-cased <script> would still fail this.
  it('strips a stored-XSS <img onerror> payload from the composed text before publish', () => {
    const post = composeAsPersona({
      ...BASE_INPUT,
      text: '<img src="x" onerror="window.__xss = true">Advisory update',
    })
    expect(post.text).not.toMatch(/onerror/i)
    expect(post.text).not.toContain('<img')
    expect(post.text).toContain('Advisory update')
  })

  it('never lets a stored-XSS payload survive as far as the participant view either', () => {
    const post = composeAsPersona({
      ...BASE_INPUT,
      text: '<script>alert(document.cookie)</script>Zone 3 is clear.',
    })
    const view = toParticipantView(post)
    expect(view.text).not.toMatch(/<script/i)
    expect(view.text).toContain('Zone 3 is clear.')
  })
})

describe('composeAsPersona — origin cannot be overridden by the caller (defense in depth)', () => {
  it('fixes origin to controller-as-persona even if an untyped caller smuggles a different one', () => {
    // ComposeAsPersonaInput has no `origin` field, so this can only happen via
    // an untyped/JS caller bypassing the type system — simulate that with a
    // deliberate unsafe cast rather than assuming TS alone protects this.
    const maliciousInput = {
      ...BASE_INPUT,
      origin: 'participant',
    } as unknown as ComposeAsPersonaInput

    const post = composeAsPersona(maliciousInput)
    expect(post.origin).toBe('controller-as-persona')
  })
})

describe('composeAsPersona — exercise stamping (COR-001)', () => {
  it('stamps the post and its telemetry event with the caller-supplied exerciseId', () => {
    const post = composeAsPersona({ ...BASE_INPUT, exerciseId: 'ex-other-9999' })
    expect(post.exerciseId).toBe('ex-other-9999')

    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'post')
    expect(events).toHaveLength(1)
    expect(events[0]?.exerciseId).toBe('ex-other-9999')
  })
})
