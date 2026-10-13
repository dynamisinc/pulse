/**
 * features/login/completeSignIn.session.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W-2, REAL STATE. `completeSignIn.test.ts` spies the auth module to pin
 * the order; this file runs the real token store and the real `resetClientSession` and asserts
 * what a person would see: after someone else's session on the same tab, signing in as a new
 * identity leaves the new pair in the right store and NONE of the previous identity's cached
 * server state or pending composer intent.
 *
 * Nothing is mocked except the network edge, which is never reached (no request is made).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { getAccessToken, getRefreshToken } from '@/core/auth'
import { queryClient as sharedQueryClient } from '@/core/services/queryClient'
import { consumeReplyFocus, requestReplyFocus } from '@/features/social/services/replyIntent'
import { completeSignIn } from './completeSignIn'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const PREVIOUS_USER_FEED = ['feed', 'previous-user'] as const

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  sharedQueryClient.clear()
})

describe('completeSignIn - real state', () => {
  it('a participant sign-in persists the pair and drops the previous identity\'s client state', () => {
    // The previous identity's leftovers: cached server state and a pending reply intent.
    sharedQueryClient.setQueryData(PREVIOUS_USER_FEED, [{ id: 'post-of-previous-user' }])
    requestReplyFocus('post-of-previous-user')
    const navigate = vi.fn()

    completeSignIn({ token: 'new-access', refreshToken: 'new-refresh' }, { persist: true, navigate })

    expect(localStorage.getItem('pulse.auth.token')).toBe('new-access')
    expect(sessionStorage.getItem('pulse.auth.token')).toBeNull()
    expect(getAccessToken()).toBe('new-access')
    expect(getRefreshToken()).toBe('new-refresh')
    expect(sharedQueryClient.getQueryData(PREVIOUS_USER_FEED)).toBeUndefined()
    expect(consumeReplyFocus('post-of-previous-user')).toBe(false)
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('a staff sign-in keeps the pair in sessionStorage only, and also drops the old state', () => {
    sharedQueryClient.setQueryData(PREVIOUS_USER_FEED, [{ id: 'post-of-previous-user' }])
    completeSignIn({ token: 'staff-access', refreshToken: 'staff-refresh' }, {
      persist: false,
      navigate: vi.fn(),
    })

    expect(sessionStorage.getItem('pulse.auth.token')).toBe('staff-access')
    expect(localStorage.getItem('pulse.auth.token')).toBeNull()
    expect(sharedQueryClient.getQueryData(PREVIOUS_USER_FEED)).toBeUndefined()
  })

  it('the new tokens are in place BEFORE the reset, so nothing refetches under the old token', () => {
    let tokenWhenCacheWasCleared: string | null = 'unset'
    const callerClient = {
      clear: () => { tokenWhenCacheWasCleared = getAccessToken() },
    }

    completeSignIn({ token: 'new-access', refreshToken: 'new-refresh' }, {
      persist: true,
      navigate: vi.fn(),
      queryClient: callerClient,
    })

    expect(tokenWhenCacheWasCleared).toBe('new-access')
  })

  it('also clears a provider client that is not the shared singleton', () => {
    const providerClient = new QueryClient()
    providerClient.setQueryData(PREVIOUS_USER_FEED, ['stale'])

    completeSignIn({ token: 'a', refreshToken: 'b' }, {
      persist: true,
      navigate: vi.fn(),
      queryClient: providerClient,
    })

    expect(providerClient.getQueryData(PREVIOUS_USER_FEED)).toBeUndefined()
  })
})
