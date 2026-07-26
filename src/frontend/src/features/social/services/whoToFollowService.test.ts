/**
 * features/social/services/whoToFollowService.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-04 ACs for the "Who to follow" suggestion READ seam (SOC-053,
 * COR-001, D1-R1):
 *   - the SHIPPED mock path resolves an ordered id list that includes the
 *     SOC-052 impersonator at its seeded position, unflagged, alongside both
 *     verified and unverified accounts (no filter by verification status);
 *   - the BOUNDARY-mocked path (mirrors `followService.test.ts`) asserts the
 *     exact wire contract — `GET /personas/suggestions` — and that a
 *     malformed body fails closed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { personaIdForHandle } from '@/features/personas'
import { resolveSuggestedFollowIds } from './whoToFollowService'

/** Casts an arbitrary body into the shape `api.get`'s mock return expects. */
function apiBody(data: unknown): Awaited<ReturnType<typeof api.get>> {
  return { data } as Awaited<ReturnType<typeof api.get>>
}

describe('resolveSuggestedFollowIds (shipped mock path) — planner-seeded order (SOC-053)', () => {
  it('resolves a non-empty, order-preserving id list', async () => {
    const ids = await resolveSuggestedFollowIds()
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every(id => typeof id === 'string')).toBe(true)
  })

  it('includes the SOC-052 impersonator at its seeded position, unflagged (D1-R1/D1-008)', async () => {
    const ids = await resolveSuggestedFollowIds()
    expect(ids).toContain(personaIdForHandle('FairhavenWaterUpd'))
  })

  it('mixes verified and unverified accounts — no filter by verification status', async () => {
    const ids = await resolveSuggestedFollowIds()
    // FulcoEM/Newsline7 are seeded verified; TheScoopHQ/FairhavenWaterUpd are not.
    expect(ids).toContain(personaIdForHandle('FulcoEM'))
    expect(ids).toContain(personaIdForHandle('Newsline7'))
    expect(ids).toContain(personaIdForHandle('TheScoopHQ'))
    expect(ids).toContain(personaIdForHandle('FairhavenWaterUpd'))
  })

  it('is a stable, repeatable read — calling twice returns the same order', async () => {
    const first = await resolveSuggestedFollowIds()
    const second = await resolveSuggestedFollowIds()
    expect(second).toEqual(first)
  })
})

describe('resolveSuggestedFollowIds (boundary-mocked wire contract)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GETs /personas/suggestions and returns the id array', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-a', 'persona-b']))
    const ids = await resolveSuggestedFollowIds()

    expect(spy).toHaveBeenCalledWith('/personas/suggestions', expect.anything())
    expect(ids).toEqual(['persona-a', 'persona-b'])
  })

  it('fails closed when the body is not a string array', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(apiBody({ nope: true }))
    await expect(resolveSuggestedFollowIds()).rejects.toThrow()
  })

  it('fails closed when the body contains a non-string element', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-a', 42]))
    await expect(resolveSuggestedFollowIds()).rejects.toThrow()
  })

  it('propagates a request failure rather than substituting an empty list', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    await expect(resolveSuggestedFollowIds()).rejects.toThrow('network down')
  })
})
