/**
 * features/social/services/feedService.following.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE branch of story 02's Following scope (SOC-081): with the mock
 * adapter off, `resolveFeed('following')` must send `GET /api/feed` with
 * `?scope=following` — the SAME single-endpoint contract story 01 already
 * calls, just parameterized (`docs/features/profiles-social-graph/07-follow-
 * graph-api.md`) — and `resolveFeed()` with NO argument (every existing All
 * Posts caller) must send the EXACT SAME request as before this story, so
 * that path stays byte-identical.
 *
 * Lives in its own file — mirrors `useComposePost.live.test.ts`'s own
 * rationale — because `vi.mock('@/core/config/mockData', ...)` is hoisted to
 * the WHOLE module, and this test wants a real `USE_MOCK_DATA = false` without
 * disturbing the mock-mode sibling spec in `feedService.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/features/social'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

import { api } from '@/core/services/api'
import { resolveFeed } from './feedService'

const mockedGet = vi.mocked(api.get)

function seededPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-a',
    exerciseId: 'ex-live-0001',
    authorPersonaId: 'persona-a',
    actingHumanId: 'human-a',
    text: 'hello',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T13:00:00Z',
    origin: 'participant',
    ...overrides,
  }
}

afterEach(() => {
  mockedGet.mockReset()
})

describe('resolveFeed — LIVE mode (SOC-081)', () => {
  it('resolveFeed() with no argument sends the SAME request as before story 02 (byte-identical)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: [seededPost()],
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    })

    const posts = await resolveFeed()

    expect(mockedGet).toHaveBeenCalledWith('/feed', undefined)
    expect(posts).toHaveLength(1)
  })

  it("resolveFeed('all') is equally byte-identical to the no-argument call", async () => {
    mockedGet.mockResolvedValueOnce({
      data: [],
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    })

    await resolveFeed('all')

    expect(mockedGet).toHaveBeenCalledWith('/feed', undefined)
  })

  it("resolveFeed('following') sends ?scope=following — the follow-graph API's documented seam", async () => {
    mockedGet.mockResolvedValueOnce({
      data: [seededPost({ authorPersonaId: 'persona-followed' })],
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    })

    const posts = await resolveFeed('following')

    expect(mockedGet).toHaveBeenCalledWith('/feed', { params: { scope: 'following' } })
    expect(posts).toHaveLength(1)
  })

  it("resolveFeed('following') resolves an empty array for an empty follow set — never a fallback", async () => {
    mockedGet.mockResolvedValueOnce({
      data: [],
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    })

    const posts = await resolveFeed('following')

    expect(posts).toEqual([])
  })

  it('propagates a rejection (e.g. the documented unknown-scope 400) rather than substituting a default feed', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Request failed with status code 400'))

    await expect(resolveFeed('following')).rejects.toThrow()
  })
})
