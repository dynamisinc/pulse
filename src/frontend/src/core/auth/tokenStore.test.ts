/**
 * core/auth/tokenStore.test.ts
 * ---------------------------------------------------------------------------
 * Set/get/clear round-trips for the sessionStorage-backed token store
 * (COR-012; feature: login, story 01). `sessionStorage` is real (jsdom
 * provides it) — no mocking needed; each test clears it so cases don't leak
 * into one another.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './tokenStore'

beforeEach(() => {
  sessionStorage.clear()
})

describe('tokenStore', () => {
  it('returns null for both tokens when nothing is stored', () => {
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('round-trips a token pair', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })

    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
  })

  it('stores an access token with no refresh token, and clears any previously stored one', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    setTokens({ token: 'access-2' })

    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBeNull()
  })

  it('rotation: a later setTokens call replaces both prior values', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })
    setTokens({ token: 'access-2', refreshToken: 'refresh-2' })

    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBe('refresh-2')
  })

  it('clearTokens removes both, and a cleared store returns no token', () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' })

    clearTokens()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('clearTokens is safe to call when nothing is stored', () => {
    expect(() => clearTokens()).not.toThrow()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})
