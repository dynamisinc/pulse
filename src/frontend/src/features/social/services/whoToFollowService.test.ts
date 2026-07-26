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

describe('resolveSuggestedFollowIds — the server-applied `limit` cap (backend story 08)', () => {
  it('caps the shipped mock path to a strict PREFIX of the uncapped order', async () => {
    const all = await resolveSuggestedFollowIds()
    const capped = await resolveSuggestedFollowIds(3)

    expect(capped).toHaveLength(3)
    expect(capped).toEqual(all.slice(0, 3))
  })

  it('honours the cap in MOCK mode too, so mock and live cannot disagree', async () => {
    // The mock adapter parses `?limit=` back out of the very URL the live path
    // sends. A client/server key mismatch (`?limit=` vs `?count=`) therefore
    // fails here, not only against a real backend — this feature's most
    // productive defect class is exactly that divergence.
    expect(await resolveSuggestedFollowIds(1)).toHaveLength(1)
  })

  it('returns the whole eligible set when no cap is given', async () => {
    const all = await resolveSuggestedFollowIds()
    expect(all.length).toBeGreaterThan(3)
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

  it('puts the cap on the wire as ?limit=N, the key the server reads', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-a']))
    await resolveSuggestedFollowIds(3)

    expect(spy).toHaveBeenCalledWith('/personas/suggestions?limit=3', expect.anything())
  })

  it('sends no query string at all when no cap is given', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-a']))
    await resolveSuggestedFollowIds()

    expect(spy).toHaveBeenCalledWith('/personas/suggestions', expect.anything())
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
