/**
 * features/controller/services/liveStorylineActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE escalation-dial GET/POST calls (feature: world-steering,
 * story 09 — "Escalation dial live"; CTL-022, COR-001):
 *  - `getStoryline` maps a valid wire body to `LiveStorylineSteeringState`
 *    (including `title`, Gate-1 W-008), defaulting a missing `targetIntensity`
 *    to `null`;
 *  - `setStorylineTarget` posts `{ target }` to the right URL and maps the
 *    authoritative response the same way;
 *  - a malformed response body (missing/wrong-typed field, unknown phase
 *    literal) THROWS rather than being cast blindly (COR-001 defence in
 *    depth) — the caller (`liveStorylineStore`) is what catches it;
 *  - both request URLs `encodeURIComponent` the storyline id (Gate-1 S-002).
 *
 * `@/core/services/api` is mocked at the module boundary (mirrors
 * `liveReviewStore.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}))

import { getStoryline, PRIMARY_STORYLINE_SENTINEL, setStorylineTarget } from './liveStorylineActions'

function wireBody(overrides: Record<string, unknown> = {}) {
  return {
    storylineId: 'storyline-real-guid',
    title: 'Water main contamination fears',
    exerciseId: 'ex-live-0001',
    intensity: 62,
    targetIntensity: null,
    phase: 'Escalating',
    ...overrides,
  }
}

describe('PRIMARY_STORYLINE_SENTINEL', () => {
  it('is the literal "primary" — mirrors the backend StorylineSteeringService constant exactly', () => {
    expect(PRIMARY_STORYLINE_SENTINEL).toBe('primary')
  })
})

describe('getStoryline', () => {
  it('GETs /steering/storylines/{id} and maps a valid response', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ targetIntensity: 78 }) })

    const result = await getStoryline(PRIMARY_STORYLINE_SENTINEL)

    expect(getMock).toHaveBeenCalledWith('/steering/storylines/primary')
    expect(result).toEqual({
      storylineId: 'storyline-real-guid',
      title: 'Water main contamination fears',
      exerciseId: 'ex-live-0001',
      intensity: 62,
      targetIntensity: 78,
      phase: 'Escalating',
    })
  })

  it('defaults a missing targetIntensity to null', async () => {
    const body = wireBody()
    delete (body as Record<string, unknown>).targetIntensity
    getMock.mockResolvedValueOnce({ data: body })

    const result = await getStoryline('storyline-real-guid')

    expect(result.targetIntensity).toBeNull()
  })

  it('throws on a malformed body (never a blind cast, COR-001 defence in depth)', async () => {
    getMock.mockResolvedValueOnce({ data: { storylineId: 'x' } }) // missing required fields

    await expect(getStoryline('storyline-real-guid')).rejects.toThrow()
  })

  it('throws on an unknown phase literal', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ phase: 'NotAPhase' }) })

    await expect(getStoryline('storyline-real-guid')).rejects.toThrow()
  })

  it('URL-encodes the storyline id (Gate-1 S-002)', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody() })

    await getStoryline('weird id/with?chars')

    expect(getMock).toHaveBeenCalledWith('/steering/storylines/weird%20id%2Fwith%3Fchars')
  })
})

describe('setStorylineTarget', () => {
  it('POSTs { target } to /steering/storylines/{id}/target and maps the authoritative response', async () => {
    postMock.mockResolvedValueOnce({ data: wireBody({ targetIntensity: 90 }) })

    const result = await setStorylineTarget('storyline-real-guid', 90)

    expect(postMock).toHaveBeenCalledWith('/steering/storylines/storyline-real-guid/target', { target: 90 })
    expect(result.targetIntensity).toBe(90)
  })

  it('posts target: null to clear the target', async () => {
    postMock.mockResolvedValueOnce({ data: wireBody({ targetIntensity: null }) })

    await setStorylineTarget('storyline-real-guid', null)

    expect(postMock).toHaveBeenCalledWith('/steering/storylines/storyline-real-guid/target', { target: null })
  })

  it('throws on a malformed body', async () => {
    postMock.mockResolvedValueOnce({ data: null })

    await expect(setStorylineTarget('storyline-real-guid', 50)).rejects.toThrow()
  })

  it('URL-encodes the storyline id (Gate-1 S-002)', async () => {
    postMock.mockResolvedValueOnce({ data: wireBody() })

    await setStorylineTarget('weird id/with?chars', 50)

    expect(postMock).toHaveBeenCalledWith('/steering/storylines/weird%20id%2Fwith%3Fchars/target', { target: 50 })
  })
})
