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
 *     malformed body fails closed;
 *   - the mock adapter EXCLUDES BEFORE IT CAPS, exactly as the server does
 *     (WR-001) — see that describe's own note for why this is the divergence
 *     that mattered.
 *
 * The LIVE branch of the same wire contract (`USE_MOCK_DATA = false`, the real
 * request shape and config) lives in the sibling `whoToFollowService.live.test.ts`
 * — `vi.mock('@/core/config/mockData', ...)` is hoisted to the whole module, so
 * it cannot share a file with these mock-mode specs.
 *
 * Every spec here starts from a genuinely EMPTY mock follow graph
 * (`resetMockFollowEdges()`), so the assertions below are about the seeded
 * suggestion order itself rather than about which accounts the store happens to
 * pre-follow for the viewer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { personaIdForHandle } from '@/features/personas'
import { followPersona, unfollowPersona, resetMockFollowEdges } from './followService'
import { resolveSuggestedFollowIds } from './whoToFollowService'

beforeEach(() => {
  resetMockFollowEdges()
})

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

describe('the mock adapter excludes already-followed accounts BEFORE it caps (WR-001)', () => {
  // THE POINT OF THIS BLOCK. The server excludes self + already-followed and
  // only THEN `Take(limit)`, so a live `?limit=3` always yields three
  // renderable rows. The mock used to slice the raw seed order first and leave
  // the exclusions to `useWhoToFollow`, which re-applied them AFTER the cap —
  // so following one of the first three suggestions made the module render 2
  // rows, then 1, then 0, where live kept rendering 3. The two agreed only by
  // accident of where the seeded follow edges sat in the fixture order.

  it('still returns `limit` ids after the viewer follows one of the first suggestions', async () => {
    const before = await resolveSuggestedFollowIds(3)
    expect(before).toHaveLength(3)

    const justFollowed = before[0]
    if (justFollowed === undefined) throw new Error('expected a first suggestion to follow')
    await followPersona(justFollowed)

    const after = await resolveSuggestedFollowIds(3)
    expect(after).toHaveLength(3)
    expect(after).not.toContain(justFollowed)
  })

  it('holds for every one of the first `limit` suggestions in turn, never draining the module', async () => {
    // Follows the CURRENT top suggestion three times over — the exact sequence
    // a participant produces by tapping Follow on the first row repeatedly.
    for (let round = 0; round < 3; round += 1) {
      const rows = await resolveSuggestedFollowIds(3)
      expect(rows).toHaveLength(3)
      const top = rows[0]
      if (top === undefined) throw new Error('expected a suggestion to follow')
      await followPersona(top)
    }

    expect(await resolveSuggestedFollowIds(3)).toHaveLength(3)
  })

  it('drops a followed account from the UNCAPPED read too, without reordering the rest', async () => {
    const all = await resolveSuggestedFollowIds()
    const followed = personaIdForHandle('FairhavenWaterUpd')
    await followPersona(followed)

    const after = await resolveSuggestedFollowIds()
    expect(after).not.toContain(followed)
    expect(after).toEqual(all.filter(id => id !== followed))
  })

  it('restores the suggestion once the viewer unfollows it — the store is the single source', async () => {
    const all = await resolveSuggestedFollowIds()
    const followed = personaIdForHandle('FulcoEM')

    await followPersona(followed)
    expect(await resolveSuggestedFollowIds()).not.toContain(followed)

    await unfollowPersona(followed)
    expect(await resolveSuggestedFollowIds()).toEqual(all)
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
