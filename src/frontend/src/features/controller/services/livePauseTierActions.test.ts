/**
 * features/controller/services/livePauseTierActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE tiered-pause actions (world-steering/07; CTL-023, COR-001,
 * COR-018):
 *  - `setPauseTier` POSTs `/steering/pause-tier` with the tier + acting human +
 *    time zone + the selected participant-overlay register (story 08), and NO
 *    client `exerciseId` (COR-001 — the scope is resolved server-side, exactly
 *    like `liveEngineControlActions`);
 *  - it resolves with the SERVER's `{ tier, clockFrozen }` — never discarding it
 *    (CR-001: `clockFrozen` is how the console learns a Freeze did not actually
 *    reach the clock) — and rejects on failure so `usePauseState` can revert its
 *    optimistic flip;
 *  - `fetchPauseTier` GETs the same path and returns the same state, rejecting
 *    an unrecognised/missing tier rather than guessing one, and treating an
 *    absent `clockFrozen` as NOT frozen (fail closed).
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

const CTX = {
  actingHumanId: 'human-controller-01',
  timeZone: 'America/New_York',
  overlayRegister: 'out-of-fiction',
} as const

beforeEach(() => {
  postMock.mockReset()
  getMock.mockReset()
})

describe('livePauseTierActions.setPauseTier', () => {
  it('POSTs the tier + acting human + time zone + overlay register, and NO client exerciseId (COR-001)', async () => {
    postMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: true } })

    await setPauseTier('freeze', CTX)

    expect(postMock).toHaveBeenCalledWith('/steering/pause-tier', {
      tier: 'freeze',
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      overlayRegister: 'out-of-fiction',
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
      overlayRegister: 'out-of-fiction',
    })
  })

  it('POSTs the in-fiction register when that is the console selection (world-steering/08)', async () => {
    postMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: true } })

    await setPauseTier('freeze', { ...CTX, overlayRegister: 'in-fiction' })

    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.overlayRegister).toBe('in-fiction')
  })

  it("resolves with the SERVER's resulting state, never discarding it (the caller verifies it)", async () => {
    postMock.mockResolvedValue({ data: { tier: 'engine', clockFrozen: false } })

    await expect(setPauseTier('engine', CTX)).resolves.toEqual({
      tier: 'engine',
      clockFrozen: false,
    })
  })

  it('surfaces a Freeze the server did NOT apply as clockFrozen: false', async () => {
    // CR-001: this is the truth signal that stops the console rendering WORLD
    // FROZEN over a world that is still moving.
    postMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: false } })

    await expect(setPauseTier('freeze', CTX)).resolves.toEqual({
      tier: 'freeze',
      clockFrozen: false,
    })
  })

  it('treats a missing clockFrozen as NOT frozen (fail closed, never assumed)', async () => {
    postMock.mockResolvedValue({ data: { tier: 'freeze' } })

    await expect(setPauseTier('freeze', CTX)).resolves.toEqual({
      tier: 'freeze',
      clockFrozen: false,
    })
  })

  it('rejects an unrecognised tier in the POST response rather than guessing one', async () => {
    postMock.mockResolvedValue({ data: { tier: 'world-frozen', clockFrozen: true } })

    await expect(setPauseTier('freeze', CTX)).rejects.toThrow(/Unrecognised pause tier/)
  })

  it('rejects when the POST rejects (the caller reverts its optimistic flip)', async () => {
    postMock.mockRejectedValue(new Error('network down'))

    await expect(setPauseTier('freeze', CTX)).rejects.toThrow('network down')
  })
})

describe('livePauseTierActions.fetchPauseTier', () => {
  it('GETs the pause-tier path with no parameters and returns the server state', async () => {
    getMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: true } })

    await expect(fetchPauseTier()).resolves.toEqual({ tier: 'freeze', clockFrozen: true })
    expect(getMock).toHaveBeenCalledWith('/steering/pause-tier')
  })

  it('returns the running baseline when the server reports it', async () => {
    getMock.mockResolvedValue({ data: { tier: 'running', clockFrozen: false } })

    await expect(fetchPauseTier()).resolves.toEqual({ tier: 'running', clockFrozen: false })
  })

  it('carries an unapplied freeze through as clockFrozen: false, so the caller can refuse to adopt it', async () => {
    getMock.mockResolvedValue({ data: { tier: 'freeze', clockFrozen: false } })

    await expect(fetchPauseTier()).resolves.toEqual({ tier: 'freeze', clockFrozen: false })
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
