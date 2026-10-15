/**
 * core/auth/endSession.tokens.test.ts
 * ---------------------------------------------------------------------------
 * easy-login story 07 (EL-10): a participant's tokens now live in
 * `localStorage`, so signing out must leave NOTHING in either store. This runs
 * the REAL `endSession()` -> REAL `logout()` -> REAL token store chain, with only
 * the network (`core/services/api`'s `post`) mocked, and asserts a signed-out
 * browser has no token in `localStorage` or `sessionStorage`.
 *
 * It sits beside `endSession.test.ts` rather than inside it because that file
 * mocks `./logout` at the boundary (its own subject is the cache/store reset);
 * this one needs the real `logout` underneath.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { endSession } from './endSession'
import { setTokens, getAccessToken, getRefreshToken } from './tokenStore'
import { api } from '../services/api'
import { queryClient } from '../services/queryClient'

vi.mock('../services/api', () => ({
  api: { post: vi.fn() },
}))

const mockPost = vi.mocked(api.post)

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  queryClient.clear()
  mockPost.mockReset()
  mockPost.mockResolvedValue({ status: 204, data: undefined })
})

describe('endSession leaves no token in either store', () => {
  it('after a persistent (participant) sign-in, localStorage and sessionStorage are empty', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

    await endSession()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('after a session-only (staff) sign-in, both stores are empty too', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })

    await endSession()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('clears a stray copy in the other store as well', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    sessionStorage.setItem('pulse.auth.token', 'stray-access')
    sessionStorage.setItem('pulse.auth.refreshToken', 'stray-refresh')

    await endSession()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('still leaves nothing when the logout request fails', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    mockPost.mockRejectedValue(new Error('network down'))

    await expect(endSession()).resolves.toBeUndefined()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('clears localStorage SYNCHRONOUSLY, before the logout request settles', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    let finishLogout: () => void = () => undefined
    mockPost.mockReturnValue(new Promise(resolve => {
      finishLogout = () => resolve({ status: 204, data: undefined })
    }))

    const ending = endSession()

    expect(localStorage.length).toBe(0)
    finishLogout()
    await ending
  })

  it('presents the captured token to the server so the session can be revoked there too', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

    await endSession()

    expect(mockPost).toHaveBeenCalledWith(
      '/auth/logout',
      undefined,
      { headers: { Authorization: 'Bearer access-1' } },
    )
  })
})
