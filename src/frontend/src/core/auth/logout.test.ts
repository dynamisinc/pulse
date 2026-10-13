/**
 * core/auth/logout.test.ts
 * ---------------------------------------------------------------------------
 * Covers the shared `logout()` helper (COR-012; feature: login, story 01):
 * tokens are cleared regardless of the network call's outcome, and the
 * captured (pre-clear) access token is attached explicitly to the logout
 * request. `core/services/api` is mocked at the module boundary so this
 * exercises `logout()`'s own contract, not the shared axios client's
 * interceptors (covered in `core/services/api.test.ts`).
 *
 * easy-login story 07 (EL-10): participant tokens now live in `localStorage`, so
 * this also proves a signed-out browser has NOTHING in `localStorage` (or
 * `sessionStorage`) whichever store the session was in.
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
  localStorage.clear()
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

describe('logout - persistent (localStorage) participant tokens (easy-login 07)', () => {
  it('leaves nothing in localStorage or sessionStorage after a persistent sign-in', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    mockPost.mockResolvedValue({ status: 204, data: undefined })

    await logout()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('captures and presents the access token held in localStorage, then clears it before the call', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    let localStorageDuringCall: number | undefined
    mockPost.mockImplementation(() => {
      localStorageDuringCall = localStorage.length
      return Promise.resolve({ status: 204, data: undefined })
    })

    await logout()

    expect(mockPost).toHaveBeenCalledWith(
      '/auth/logout',
      undefined,
      { headers: { Authorization: 'Bearer access-1' } },
    )
    expect(localStorageDuringCall).toBe(0)
  })

  it('still leaves nothing in localStorage when the network call fails', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    mockPost.mockRejectedValue(new Error('network down'))

    await expect(logout()).resolves.toBeUndefined()

    expect(localStorage.length).toBe(0)
  })

  it('clears a pair left in BOTH stores', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    sessionStorage.setItem('pulse.auth.token', 'stray')
    mockPost.mockResolvedValue({ status: 204, data: undefined })

    await logout()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
