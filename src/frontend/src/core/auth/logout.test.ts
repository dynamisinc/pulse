/**
 * core/auth/logout.test.ts
 * ---------------------------------------------------------------------------
 * Covers the shared `logout()` helper (COR-012; feature: login, story 01):
 * tokens are cleared regardless of the network call's outcome, and the
 * captured (pre-clear) access token is attached explicitly to the logout
 * request. `core/services/api` is mocked at the module boundary so this
 * exercises `logout()`'s own contract, not the shared axios client's
 * interceptors (covered in `core/services/api.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logout } from './logout'
import { setTokens, getAccessToken, getRefreshToken } from './tokenStore'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { post: vi.fn() },
}))

const mockPost = vi.mocked(api.post)

beforeEach(() => {
  sessionStorage.clear()
  mockPost.mockReset()
})

describe('logout', () => {
  it('clears both stored tokens before the network call resolves', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    let sawTokenDuringCall: string | null = null
    mockPost.mockImplementation(() => {
      // Captured at call time — proves the store is already cleared by the
      // time the network call is issued/observed.
      sawTokenDuringCall = getAccessToken()
      return Promise.resolve({ status: 204, data: undefined })
    })

    await logout()

    expect(sawTokenDuringCall).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('attaches the captured (pre-clear) access token explicitly to the logout call', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    mockPost.mockResolvedValue({ status: 204, data: undefined })

    await logout()

    expect(mockPost).toHaveBeenCalledWith(
      '/auth/logout',
      undefined,
      { headers: { Authorization: 'Bearer access-1' } },
    )
  })

  it('omits the header override when there was no access token to capture', async () => {
    mockPost.mockResolvedValue({ status: 204, data: undefined })

    await logout()

    expect(mockPost).toHaveBeenCalledWith('/auth/logout', undefined, undefined)
  })

  it('never throws and still clears tokens when the network call fails', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    mockPost.mockRejectedValue(new Error('network down'))

    await expect(logout()).resolves.toBeUndefined()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})
