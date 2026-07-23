/**
 * core/auth/endSession.test.ts
 * ---------------------------------------------------------------------------
 * Covers the shared client-session teardown: `endSession()` clears the shared
 * React Query cache (so no prior-user data survives into the next session on
 * the same tab) AND logs out, with the cache cleared SYNCHRONOUSLY before the
 * best-effort network call is awaited. `./logout` is mocked at the boundary
 * (its own token/network contract is covered by `logout.test.ts`); the real
 * shared `queryClient` singleton is used and reset between tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { endSession } from './endSession'
import { logout } from './logout'
import { queryClient } from '../services/queryClient'

vi.mock('./logout', () => ({ logout: vi.fn().mockResolvedValue(undefined) }))

const mockLogout = vi.mocked(logout)

beforeEach(() => {
  mockLogout.mockReset()
  mockLogout.mockResolvedValue(undefined)
  queryClient.clear()
})

describe('endSession', () => {
  it('clears cached server-state so no prior-session data survives', async () => {
    queryClient.setQueryData(['staff', 'assignments'], [{ exerciseId: 'ex-alpha' }])
    expect(queryClient.getQueryData(['staff', 'assignments'])).toBeDefined()

    await endSession()

    expect(queryClient.getQueryData(['staff', 'assignments'])).toBeUndefined()
  })

  it('logs out (delegates to the shared logout() helper) exactly once', async () => {
    await endSession()
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('clears the cache SYNCHRONOUSLY, before awaiting logout() (never blocks the redirect)', async () => {
    queryClient.setQueryData(['k'], 1)
    let cacheSeenInsideLogout: unknown = 'not-observed'
    mockLogout.mockImplementation(async () => {
      // logout() is awaited only AFTER endSession()'s synchronous clear(), so by
      // the time this runs the cache is already empty.
      cacheSeenInsideLogout = queryClient.getQueryData(['k'])
    })

    await endSession()

    expect(cacheSeenInsideLogout).toBeUndefined()
  })
})
