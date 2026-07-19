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
})
