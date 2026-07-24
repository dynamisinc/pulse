/**
 * features/controller/engine/services/liveEngineControlActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE engine kill-switch actions (UAT engine-pause fix; ADP-042,
 * COR-001, COR-018):
 *  - `'stop'` POSTs `/engine/autonomy/kill-switch` with `mode: 'full-stop'`;
 *  - `'suggest-only'` POSTs the same endpoint with `mode: 'drop-to-suggest'`;
 *  - `'live'` POSTs `/engine/autonomy/restore` instead (no `mode` field — the
 *    ONLY way to lift the clamp);
 *  - every request body carries `actingHumanId` + `timeZone` and NO client
 *    `exerciseId` (COR-001 — scope is resolved server-side).
 *
 * `api.post` is mocked (`vi.mock('@/core/services/api')`, hoisted above
 * imports by Vitest) so no real network call is made.
 */
import { describe, expect, it, vi } from 'vitest'
import { setMode } from './liveEngineControlActions'

const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

const CTX = { actingHumanId: 'human-controller-01', timeZone: 'America/New_York' }

describe('liveEngineControlActions.setMode', () => {
  it("'stop' POSTs the kill-switch endpoint with mode: 'full-stop'", async () => {
    postMock.mockResolvedValue({ data: {} })

    await setMode('stop', CTX)

    expect(postMock).toHaveBeenCalledWith('/engine/autonomy/kill-switch', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      mode: 'full-stop',
    })
  })

  it("'suggest-only' POSTs the kill-switch endpoint with mode: 'drop-to-suggest'", async () => {
    postMock.mockResolvedValue({ data: {} })

    await setMode('suggest-only', CTX)

    expect(postMock).toHaveBeenCalledWith('/engine/autonomy/kill-switch', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      mode: 'drop-to-suggest',
    })
  })

  it("'live' POSTs the restore endpoint instead, with no mode field", async () => {
    postMock.mockResolvedValue({ data: {} })

    await setMode('live', CTX)

    expect(postMock).toHaveBeenCalledWith('/engine/autonomy/restore', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })
  })

  it('resolves void on a successful POST', async () => {
    postMock.mockResolvedValue({ data: { ok: true } })

    await expect(setMode('stop', CTX)).resolves.toBeUndefined()
  })

  it('rejects when the POST rejects (caller decides how to handle it)', async () => {
    postMock.mockRejectedValue(new Error('network down'))

    await expect(setMode('stop', CTX)).rejects.toThrow('network down')
  })
})
