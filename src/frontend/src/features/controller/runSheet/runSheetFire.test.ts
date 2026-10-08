/**
 * features/controller/runSheet/runSheetFire.test.ts
 * ---------------------------------------------------------------------------
 * The fire service in MOCK mode (the default under Vitest) - demo-polish C3, AC "Fire /
 * Fire next / Skip" and "Reply beats": what blocks a fire (unknown persona, nothing to post,
 * a reply whose parent has not been fired), the post a beat becomes (`controller-as-persona`,
 * the acting human, scenario time, media, baseline, parent), and the mock path through
 * `createPost` + `postStore`. The LIVE wire body and failure classification are in
 * `runSheetFire.live.test.ts` (it needs `USE_MOCK_DATA` forced off for the whole file).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { registerMockMedia, resetMockMediaRegistry } from '@/core/media'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { completeFire, failFire, skipBeat, type RunSheetData } from './runSheetModel'
import {
  FIRE_PARENT_FIRST,
  buildPostInput,
  fireBlockReason,
  findPersonaForHandle,
  sendBeat,
  type PersonaLookup,
} from './runSheetFire'
import {
  FIXED_SCENARIO_NOW,
  MOCK_ACTING_HUMAN_ID,
  MOCK_EXERCISE_ID,
  beatFixture,
  personaFixture,
  sheetFixture,
  useFixedClock,
} from './runSheetTestKit'

const fulco = personaFixture('FulcoEM')
const tbrandt = personaFixture('tbrandt41')
const LOADED: PersonaLookup = { personas: [fulco, tbrandt], loading: false, failed: false }

beforeEach(() => {
  useFixedClock()
  resetTelemetryBuffer()
  postStore.resetForTests()
  resetMockMediaRegistry()
})
afterEach(() => {
  resetExerciseClock()
  postStore.resetForTests()
})

function blocked(data: RunSheetData, beatId: string, lookup: PersonaLookup = LOADED): string {
  const beat = data.beats.find(candidate => candidate.id === beatId)
  if (beat === undefined) throw new Error('no such beat')
  const decision = fireBlockReason(data, beat, lookup, MOCK_EXERCISE_ID)
  if (decision.ok) throw new Error('expected the beat to be blocked')
  return decision.reason
}

describe('persona resolution', () => {
  it('matches the handle case-insensitively', () => {
    expect(findPersonaForHandle([fulco], 'fulcoem', MOCK_EXERCISE_ID)).toBe(fulco)
    expect(findPersonaForHandle([fulco], 'FULCOEM', MOCK_EXERCISE_ID)).toBe(fulco)
  })

  it('never resolves a persona stamped with another exercise', () => {
    const foreign = personaFixture('FulcoEM', { exerciseId: 'ex-other' })
    expect(findPersonaForHandle([foreign], 'FulcoEM', MOCK_EXERCISE_ID)).toBeUndefined()
  })
})

describe('fireBlockReason', () => {
  it('lets a plain beat through, resolving its persona', () => {
    const data = sheetFixture([beatFixture()])
    const decision = fireBlockReason(data, beatFixture(), LOADED, MOCK_EXERCISE_ID)
    expect(decision).toEqual({ ok: true, persona: fulco })
  })

  it('blocks an unknown persona handle with a message naming the handle', () => {
    const data = sheetFixture([beatFixture({ persona: { handle: 'ghost' } })])
    expect(blocked(data, 'b1')).toBe(
      'Unknown persona @ghost: no persona with that handle exists in this exercise. '
      + 'Edit the beat to choose one.',
    )
  })

  it('says personas are loading rather than calling a handle unknown', () => {
    const data = sheetFixture([beatFixture()])
    const loading: PersonaLookup = { personas: [], loading: true, failed: false }
    expect(blocked(data, 'b1', loading)).toContain('still loading')
  })

  it('says the persona read failed when it did, with nothing cached', () => {
    const data = sheetFixture([beatFixture()])
    const failed: PersonaLookup = { personas: [], loading: false, failed: true }
    expect(blocked(data, 'b1', failed)).toContain('could not be loaded')
  })

  it('blocks a beat with nothing to post (no text, no media)', () => {
    const data = sheetFixture([beatFixture({ text: '   ' })])
    expect(blocked(data, 'b1')).toContain('Nothing to post')
    const withMedia = sheetFixture([beatFixture({ text: '', media: [{ mediaId: 'm', alt: 'a' }] })])
    const beat = withMedia.beats[0]
    expect(beat && fireBlockReason(withMedia, beat, LOADED, MOCK_EXERCISE_ID).ok).toBe(true)
  })

  describe('reply beats', () => {
    const chain = (): RunSheetData => sheetFixture([
      beatFixture({ id: 'p', order: 1, title: 'Parent' }),
      beatFixture({ id: 'c', order: 2, title: 'Child', replyTo: { beatId: 'p' } }),
    ])

    it('is disabled with "Fire the parent first" until the parent is fired', () => {
      expect(blocked(chain(), 'c')).toBe(FIRE_PARENT_FIRST)
      expect(FIRE_PARENT_FIRST).toBe('Fire the parent first')
    })

    it('keeps that exact reason and adds context when the parent is skipped, failed or unconfirmed', () => {
      expect(blocked(skipBeat(chain(), 'p'), 'c')).toMatch(/^Fire the parent first \(.*skipped/)
      expect(blocked(failFire(chain(), 'p', { kind: 'failed', message: 'x' }), 'c'))
        .toMatch(/^Fire the parent first \(.*did not go out/)
      expect(blocked(failFire(chain(), 'p', { kind: 'unconfirmed', message: 'x' }), 'c'))
        .toMatch(/^Fire the parent first \(.*may already be live/)
    })

    it('posts against the parent\'s firedPostId once the parent is fired', () => {
      const fired = completeFire(chain(), 'p', { postId: 'post-parent', scenarioTime: FIXED_SCENARIO_NOW })
      const child = fired.beats[1]
      const decision = child && fireBlockReason(fired, child, LOADED, MOCK_EXERCISE_ID)
      expect(decision).toEqual({ ok: true, persona: fulco, parentPostId: 'post-parent' })
    })

    it('posts against an existing post id for replyTo.postId, with no parent beat needed', () => {
      const data = sheetFixture([beatFixture({ replyTo: { postId: 'post-existing' } })])
      const beat = data.beats[0]
      const decision = beat && fireBlockReason(data, beat, LOADED, MOCK_EXERCISE_ID)
      expect(decision).toEqual({ ok: true, persona: fulco, parentPostId: 'post-existing' })
    })
  })
})

describe('buildPostInput', () => {
  const ctx = {
    exerciseId: MOCK_EXERCISE_ID,
    timeZone: 'America/New_York',
    actingHumanId: MOCK_ACTING_HUMAN_ID,
    persona: fulco,
  }

  it('is a controller-as-persona post by the acting human, stamped with SCENARIO time', () => {
    const input = buildPostInput(beatFixture(), ctx)
    expect(input).toMatchObject({
      origin: 'controller-as-persona',
      authorPersonaId: fulco.id,
      actingHumanId: MOCK_ACTING_HUMAN_ID,
      scenarioTime: FIXED_SCENARIO_NOW,
      text: beatFixture().text,
    })
    expect(input.media).toBeUndefined()
    expect(input.parentPostId).toBeUndefined()
    expect(input.engagementBaseline).toBeUndefined()
  })

  it('carries media, baseline and parent when the beat has them', () => {
    const beat = beatFixture({
      media: [{ mediaId: 'm1', alt: 'Brown water' }],
      engagementBaseline: { like: 120, repost: 40 },
    })
    const input = buildPostInput(beat, { ...ctx, parentPostId: 'post-1' })
    expect(input.media).toEqual([{ mediaId: 'm1', alt: 'Brown water' }])
    expect(input.engagementBaseline).toEqual({ like: 120, repost: 40 })
    expect(input.parentPostId).toBe('post-1')
  })
})

describe('sendBeat - mock mode (no backend)', () => {
  const ctx = {
    exerciseId: MOCK_EXERCISE_ID,
    timeZone: 'America/New_York',
    actingHumanId: MOCK_ACTING_HUMAN_ID,
    persona: fulco,
  }

  it('creates the post in the store as controller-as-persona and returns its id', async () => {
    const result = await sendBeat(buildPostInput(beatFixture(), ctx))
    expect(result.kind).toBe('fired')
    if (result.kind !== 'fired') return
    expect(result.scenarioTime).toBe(FIXED_SCENARIO_NOW)
    const post = postStore.getPosts().find(candidate => candidate.id === result.postId)
    expect(post).toMatchObject({
      origin: 'controller-as-persona',
      actingHumanId: MOCK_ACTING_HUMAN_ID,
      authorPersonaId: fulco.id,
      scenarioTime: FIXED_SCENARIO_NOW,
    })
  })

  it('links a reply to its parent and honours the engagement baseline', async () => {
    const parent = await sendBeat(buildPostInput(beatFixture({ id: 'p' }), ctx))
    if (parent.kind !== 'fired') throw new Error('parent should have fired')
    const reply = await sendBeat(buildPostInput(
      beatFixture({ id: 'c', engagementBaseline: { like: 77 } }),
      { ...ctx, persona: tbrandt, parentPostId: parent.postId },
    ))
    if (reply.kind !== 'fired') throw new Error('reply should have fired')
    const stored = postStore.getPosts().find(post => post.id === reply.postId)
    expect(stored?.inReplyTo?.postId).toBe(parent.postId)
    expect(stored?.counts.like).toBe(77)
  })

  it('resolves library media through the mock registry', async () => {
    registerMockMedia({
      id: 'mock-media-x',
      kind: 'image',
      url: '/mock-media/x.svg',
      width: 10,
      height: 10,
      fileName: 'x.svg',
      uploadedAtScenario: FIXED_SCENARIO_NOW,
    })
    const result = await sendBeat(buildPostInput(
      beatFixture({ media: [{ mediaId: 'mock-media-x', alt: 'A photo' }] }),
      ctx,
    ))
    expect(result.kind).toBe('fired')
    if (result.kind !== 'fired') return
    const post = postStore.getPosts().find(candidate => candidate.id === result.postId)
    expect(post?.media?.[0]).toMatchObject({ id: 'mock-media-x', alt: 'A photo' })
  })

  it('reports a mock-mode rejection (unknown media id) as FAILED: nothing was created', async () => {
    const before = postStore.getPosts().length
    const result = await sendBeat(buildPostInput(
      beatFixture({ media: [{ mediaId: 'does-not-exist', alt: 'A photo' }] }),
      ctx,
    ))
    expect(result).toMatchObject({ kind: 'failed' })
    expect(result.kind === 'failed' && result.message).toContain('Not posted')
    expect(postStore.getPosts().length).toBe(before)
  })
})
