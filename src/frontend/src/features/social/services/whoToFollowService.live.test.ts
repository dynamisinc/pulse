/**
 * features/social/services/whoToFollowService.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE branch of story 04's suggestion read (SOC-053) against the REAL
 * endpoint backend story 08 shipped: with the mock adapter off,
 * `resolveSuggestedFollowIds()` must send `GET /api/personas/suggestions` — and
 * `resolveSuggestedFollowIds(3)` must put the cap on the wire as `?limit=3`,
 * the exact key `SuggestionEndpoints` reads.
 *
 * WHY IT IS A SEPARATE FILE FROM `whoToFollowService.test.ts` (WR-005). That
 * sibling's "wire contract" block spies on `api.get` while `USE_MOCK_DATA` is
 * still TRUE, so its `expect(spy).toHaveBeenCalledWith(url, expect.anything())`
 * is asserting the MOCK call shape: the second argument it matches is
 * `{ adapter: mockAdapter }`, and `expect.anything()` explicitly does NOT match
 * the `undefined` config the live path passes. It therefore could not have
 * caught a live-path regression — the two branches differ in exactly that
 * argument. This file drives the branch that actually reaches the network, and
 * asserts the config too, not just the URL.
 *
 * `vi.mock('@/core/config/mockData', ...)` is hoisted to the WHOLE module, so a
 * real `USE_MOCK_DATA = false` cannot share a file with the mock-mode specs —
 * the same rationale (and the same pattern) as
 * `feedService.following.live.test.ts` / `useComposePost.live.test.ts`.
 *
 * Story 04's own doc gated its Complete status on this test existing alongside
 * a merged story 08; both now hold.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

import { api } from '@/core/services/api'
import { resolveSuggestedFollowIds } from './whoToFollowService'

const mockedGet = vi.mocked(api.get)

/** The bare id array the live endpoint returns (`08-suggestions-api.md`, As-built 1). */
function idsBody(ids: string[]) {
  return { data: ids, status: 200, statusText: 'OK', headers: {}, config: {} }
}

afterEach(() => {
  mockedGet.mockReset()
})

describe('resolveSuggestedFollowIds — LIVE mode (SOC-053, backend story 08)', () => {
  it('GETs /personas/suggestions with NO axios config — never the mock adapter', async () => {
    mockedGet.mockResolvedValueOnce(idsBody(['persona-a', 'persona-b']))

    const ids = await resolveSuggestedFollowIds()

    // `undefined`, asserted literally: the mock branch passes `{ adapter }` here,
    // and `expect.anything()` would have accepted either.
    expect(mockedGet).toHaveBeenCalledWith('/personas/suggestions', undefined)
    expect(ids).toEqual(['persona-a', 'persona-b'])
  })

  it('puts the cap on the wire as ?limit=N — the key the server reads', async () => {
    mockedGet.mockResolvedValueOnce(idsBody(['persona-a', 'persona-b', 'persona-c']))

    await resolveSuggestedFollowIds(3)

    expect(mockedGet).toHaveBeenCalledWith('/personas/suggestions?limit=3', undefined)
  })

  it('sends no query string at all when no cap is given', async () => {
    mockedGet.mockResolvedValueOnce(idsBody(['persona-a']))

    await resolveSuggestedFollowIds()

    const url = mockedGet.mock.calls[0]?.[0]
    expect(url).toBe('/personas/suggestions')
  })

  it('relays the server order UNMODIFIED — no re-sort, no ranking', async () => {
    mockedGet.mockResolvedValueOnce(idsBody(['persona-c', 'persona-a', 'persona-b']))

    await expect(resolveSuggestedFollowIds()).resolves.toEqual([
      'persona-c',
      'persona-a',
      'persona-b',
    ])
  })

  it('resolves an EMPTY array as an empty suggestion set — never a mock fallback', async () => {
    mockedGet.mockResolvedValueOnce(idsBody([]))

    await expect(resolveSuggestedFollowIds()).resolves.toEqual([])
  })

  it('fails closed when the live body is not a bare string array (e.g. an envelope)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { personaId: 'persona-a', personaIds: ['persona-b'], count: 1 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    })

    await expect(resolveSuggestedFollowIds()).rejects.toThrow()
  })

  it('propagates a request failure (the documented 400/401/403) rather than substituting a list', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Request failed with status code 400'))

    await expect(resolveSuggestedFollowIds()).rejects.toThrow()
  })
})
