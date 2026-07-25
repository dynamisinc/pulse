/**
 * features/controller/services/livePauseTierActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE tiered-pause actions (world-steering/07; CTL-023, COR-001,
 * COR-018):
 *  - `setPauseTier` POSTs `/steering/pause-tier` with the tier + acting human +
 *    time zone, and NO client `exerciseId` (COR-001 — the scope is resolved
 *    server-side, exactly like `liveEngineControlActions`);
 *  - it resolves void on success and rejects on failure so `usePauseState` can
 *    revert its optimistic flip;
 *  - `fetchPauseTier` GETs the same path and returns the server tier, rejecting
 *    an unrecognised/missing tier rather than guessing one.
 *
 * `api` is mocked (`vi.mock('@/core/services/api')`, hoisted above imports by
 * Vitest) so no real network call is made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPauseTier, setPauseTier } from './livePauseTierActions'

const postMock = vi.fn()
const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
    get: (...args: unknown[]) => getMock(...args),
  },
}))

const CTX = { actingHumanId: 'human-controller-01', timeZone: 'America/New_York' }

beforeEach(() => {
  postMock.mockReset()
  getMock.mockReset()
})

describe('livePauseTierActions.setPauseTier', () => {
  it('POSTs the tier + acting human + time zone, and NO client exerciseId (COR-001)', async () => {
    postMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: true } })

    await setPauseTier('freeze', CTX)

    expect(postMock).toHaveBeenCalledWith('/steering/pause-tier', {
      tier: 'freeze',
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('exerciseId')
  })

  it('POSTs the Resume transition as tier: running', async () => {
    postMock.mockResolvedValue({ data: { tier: 'running', clockFrozen: false } })

    await setPauseTier('running', CTX)

    expect(postMock).toHaveBeenCalledWith('/steering/pause-tier', {
      tier: 'running',
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
  })

  it('resolves void on a successful POST', async () => {
    postMock.mockResolvedValue({ data: { tier: 'engine', clockFrozen: false } })

    await expect(setPauseTier('engine', CTX)).resolves.toBeUndefined()
  })

  it('rejects when the POST rejects (the caller reverts its optimistic flip)', async () => {
    postMock.mockRejectedValue(new Error('network down'))

    await expect(setPauseTier('freeze', CTX)).rejects.toThrow('network down')
  })
})

describe('livePauseTierActions.fetchPauseTier', () => {
  it('GETs the pause-tier path with no parameters and returns the server tier', async () => {
    getMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: true } })

    await expect(fetchPauseTier()).resolves.toBe('freeze')
    expect(getMock).toHaveBeenCalledWith('/steering/pause-tier')
  })

  it('returns the running baseline when the server reports it', async () => {
    getMock.mockResolvedValue({ data: { tier: 'running', clockFrozen: false } })

    await expect(fetchPauseTier()).resolves.toBe('running')
  })

  it('rejects an unrecognised tier rather than guessing one', async () => {
    getMock.mockResolvedValue({ data: { tier: 'world-frozen' } })

    await expect(fetchPauseTier()).rejects.toThrow(/Unrecognised pause tier/)
  })

  it('rejects a response with no tier at all', async () => {
    getMock.mockResolvedValue({ data: {} })

    await expect(fetchPauseTier()).rejects.toThrow(/Unrecognised pause tier/)
  })
})
