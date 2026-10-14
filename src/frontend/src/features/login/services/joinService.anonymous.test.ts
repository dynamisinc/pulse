/**
 * features/login/services/joinService.anonymous.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08 — the join exchange is ANONYMOUS: it must not present the
 * session the browser already holds.
 *
 * WHY THIS NEEDS ITS OWN FILE. The other service tests mock `@/core/services/api`,
 * so they can only see the config `signInWithLink` HANDS the client. Whether the
 * shared client's request interceptor then still attaches the stored
 * `Authorization: Bearer …` depends on the REAL interceptor and on axios'
 * header serialisation, so this file uses the real client and only replaces its
 * default adapter with a recorder (no request ever leaves the process).
 *
 * The case it guards: a browser holding an old participant session (yesterday's,
 * or another participant's) opens a join link. The server refuses a live session
 * bound to a different exercise than the host resolves to with a 403, before the
 * join handler runs, so presenting the old token would make the join fail on a
 * credential it does not need. A control request through the same client proves the
 * recorder WOULD have seen the header, so the assertion cannot pass vacuously.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { signInWithLink } from './joinService'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

const TOKEN = 'tok_7f3a9c1e-SECRET-join-link'

let seen: InternalAxiosRequestConfig[]
let originalAdapter: typeof api.defaults.adapter

beforeEach(() => {
  seen = []
  originalAdapter = api.defaults.adapter
  const recorder: AxiosAdapter = async config => {
    seen.push(config)
    return {
      data: { token: 'access-B', refreshToken: 'refresh-B' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  api.defaults.adapter = recorder
  setTokens({ token: 'old-access-A', refreshToken: 'old-refresh-A' }, { persist: true })
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  clearTokens()
  localStorage.clear()
  sessionStorage.clear()
})

/** The headers that would actually go on the wire for a recorded request. */
function wireHeaders(config: InternalAxiosRequestConfig | undefined): Record<string, unknown> {
  return { ...(config?.headers.toJSON() ?? {}) }
}

describe('signInWithLink — anonymous exchange', () => {
  it('control: an ordinary request through the same client DOES carry the stored token', async () => {
    await api.get('/session')

    expect(wireHeaders(seen[0])).toMatchObject({ Authorization: 'Bearer old-access-A' })
  })

  it('sends no Authorization header even though a session is stored', async () => {
    await signInWithLink(TOKEN)

    expect(seen).toHaveLength(1)
    expect(wireHeaders(seen[0])).not.toHaveProperty('Authorization')
    expect(JSON.stringify(wireHeaders(seen[0]))).not.toContain('old-access-A')
  })

  it('still sends the token only in the JSON body, to /auth/join', async () => {
    await signInWithLink(TOKEN)

    expect(seen[0]?.url).toBe('/auth/join')
    expect(seen[0]?.method).toBe('post')
    expect(JSON.parse(String(seen[0]?.data))).toEqual({ token: TOKEN })
    expect(String(seen[0]?.url)).not.toContain(TOKEN)
    expect(seen[0]?.params).toBeUndefined()
    expect(JSON.stringify(wireHeaders(seen[0]))).not.toContain(TOKEN)
  })

  it('leaves the stored session untouched (it is replaced only by the caller, on success)', async () => {
    await signInWithLink(TOKEN)

    expect(localStorage.getItem('pulse.auth.token')).toBe('old-access-A')
  })
})
