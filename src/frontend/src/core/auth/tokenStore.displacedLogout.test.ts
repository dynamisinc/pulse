/**
 * core/auth/tokenStore.displacedLogout.test.ts
 * ---------------------------------------------------------------------------
 * W-1: a staff sign-in (sessionStorage) that displaces a participant's persistent pair makes the
 * SIGNING-IN tab POST /auth/logout with the OUTGOING participant access token (participant tabs
 * cannot: the pair is gone before they hear the world signal). Fire and forget; errors swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('../services/api', () => ({ api: { post: (...args: unknown[]) => post(...args) } }))

import { clearTokens, getAccessToken, setTokens } from './tokenStore'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  post.mockReset()
  post.mockResolvedValue({})
  clearTokens()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  clearTokens()
  localStorage.clear()
  sessionStorage.clear()
})

describe('setTokens: displaced participant session', () => {
  it('POSTs /auth/logout with the outgoing participant token on a staff sign-in', async () => {
    setTokens({ token: 'p-tok', refreshToken: 'p-ref' }, { persist: true })
    await flush()
    expect(post).not.toHaveBeenCalled()

    setTokens({ token: 'staff-tok', refreshToken: 'staff-ref' })
    await flush()

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      '/auth/logout',
      undefined,
      { headers: { Authorization: 'Bearer p-tok' } },
    )
    // The new staff pair is untouched.
    expect(getAccessToken()).toBe('staff-tok')
  })

  it('does not POST when nothing was displaced, or for a participant sign-in', async () => {
    setTokens({ token: 'staff-tok' })
    setTokens({ token: 'p-tok' }, { persist: true })
    await flush()
    expect(post).not.toHaveBeenCalled()
  })

  it('swallows a failing logout request', async () => {
    setTokens({ token: 'p-tok' }, { persist: true })
    post.mockRejectedValue(new Error('offline'))
    expect(() => setTokens({ token: 'staff-tok' })).not.toThrow()
    await flush()
    expect(getAccessToken()).toBe('staff-tok')
  })
})
