/**
 * core/services/api.test.ts
 * ---------------------------------------------------------------------------
 * Exercises the REAL `api.ts` module — its actual axios instance with its
 * actual interceptors attached — rather than mocking it at the module
 * boundary (that's exactly what's under test here; other modules' tests mock
 * `api` precisely to avoid re-testing this file).
 *
 * Network is short-circuited per-call via a custom `adapter` (the same
 * pattern already used by `sessionResolver.ts` / `feedService.ts`'s mock
 * adapters). NOTE: axios's `validateStatus`/`settle()` machinery is invoked by
 * each BUILT-IN adapter itself (xhr/http/fetch), NOT by a central dispatch
 * step — a custom adapter is responsible for its own status handling. So a
 * non-2xx case here REJECTS with a hand-built `AxiosError` via `reject401()`
 * below, which mirrors axios's own `lib/core/settle.js` exactly (same
 * message/code/shape a real backend 401 would produce through a built-in
 * adapter) — this is not a simplification, it is the same rejection a live
 * 401 response produces.
 *
 * Covers (feature: login, story 01 ACs, plus the code-review follow-ups
 * SG-001/SG-002 on #304):
 *   - the request interceptor attaches `Authorization: Bearer <token>` when a
 *     token is stored, and omits it entirely when none is stored;
 *   - the response interceptor's one-shot silent refresh: a 401 with a stored
 *     refresh token triggers exactly one `POST /auth/refresh`, retries the
 *     original request once on success, storing the rotated tokens;
 *   - a failed refresh clears both tokens and does not loop;
 *   - no refresh is attempted when there is no stored refresh token;
 *   - the refresh/logout/login endpoints themselves never trigger the retry
 *     (SG-001 adds `/auth/logout` to that exclusion, explicit not emergent);
 *   - the refresh call itself never presents the stored (possibly expired)
 *     access token (SG-002 — it's read from the request BODY, not this
 *     header, so attaching it is unnecessary exposure surface);
 *   - concurrent 401s coalesce onto a single in-flight refresh call;
 *   - a per-call mock adapter (the mock-data pattern) is unaffected/harmless.
 */
import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { api } from './api'
import { setTokens, getAccessToken, getRefreshToken } from '../auth/tokenStore'

function respond(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown = {},
): AxiosResponse {
  return {
    data,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: {},
    config,
  }
}

/**
 * Mirrors axios's own `lib/core/settle.js`: what a BUILT-IN adapter does when
 * `validateStatus` rejects a status. A custom test adapter must do this
 * itself (see the module header) to reproduce a REAL 401 rejection.
 */
function reject401(config: InternalAxiosRequestConfig): Promise<never> {
  const response = respond(config, 401, {})
  return Promise.reject(
    new axios.AxiosError(
      'Request failed with status code 401',
      axios.AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    ),
  )
}

/**
 * `performSilentRefresh()` (api.ts) issues its own `POST /auth/refresh` call
 * with NO per-call `adapter` override — it must hit the SAME transport the
 * outer call used. A per-call `{ adapter }` on only the outer request would
 * miss that inner call entirely (it would fall through to the REAL default
 * adapter). So the "one-shot silent refresh" tests below install the test's
 * adapter onto `api.defaults.adapter` instead, restored after every test.
 */
const originalAdapter = api.defaults.adapter

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
})

describe('request interceptor — Authorization header', () => {
  it('attaches Authorization: Bearer <token> when a token is stored', async () => {
    setTokens({ token: 'abc123' })
    let seenAuth: unknown
    const adapter: AxiosAdapter = config => {
      seenAuth = config.headers.get('Authorization')
      return Promise.resolve(respond(config, 200, { ok: true }))
    }

    await api.get('/whatever', { adapter })

    expect(seenAuth).toBe('Bearer abc123')
  })

  it('omits the Authorization header entirely when no token is stored (never stale/empty)', async () => {
    let sawHeader = false
    const adapter: AxiosAdapter = config => {
      sawHeader = config.headers.has('Authorization')
      return Promise.resolve(respond(config, 200, { ok: true }))
    }

    await api.get('/whatever', { adapter })

    expect(sawHeader).toBe(false)
  })

  it('does not clobber an explicit Authorization header a caller already supplied', async () => {
    setTokens({ token: 'stored-token' })
    let seenAuth: unknown
    const adapter: AxiosAdapter = config => {
      seenAuth = config.headers.get('Authorization')
      return Promise.resolve(respond(config, 200, { ok: true }))
    }

    await api.get('/whatever', { adapter, headers: { Authorization: 'Bearer explicit-token' } })

    expect(seenAuth).toBe('Bearer explicit-token')
  })
})

describe('response interceptor — one-shot silent refresh', () => {
  it('refreshes once on a 401, retries the original request, and stores rotated tokens', async () => {
    setTokens({ token: 'expired-token', refreshToken: 'refresh-1' })

    let refreshCalls = 0
    let protectedCalls = 0

    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') {
        refreshCalls++
        return Promise.resolve(
          respond(config, 200, { token: 'new-token', refreshToken: 'refresh-2', session: {} }),
        )
      }
      if (config.url === '/protected') {
        protectedCalls++
        if (config.headers.get('Authorization') === 'Bearer new-token') {
          return Promise.resolve(respond(config, 200, { data: 'secret' }))
        }
        return reject401(config)
      }
      throw new Error(`unexpected request url: ${String(config.url)}`)
    }
    api.defaults.adapter = adapter

    const response = await api.get('/protected')

    expect(response.status).toBe(200)
    expect(response.data).toEqual({ data: 'secret' })
    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(2)
    expect(getAccessToken()).toBe('new-token')
    expect(getRefreshToken()).toBe('refresh-2')
  })

  it('clears both tokens and propagates the original 401 when refresh itself fails, without looping', async () => {
    setTokens({ token: 'expired-token', refreshToken: 'stale-refresh' })

    let refreshCalls = 0
    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') {
        refreshCalls++
        return reject401(config)
      }
      return reject401(config)
    }
    api.defaults.adapter = adapter

    await expect(api.get('/protected')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(refreshCalls).toBe(1)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('does not attempt a refresh (or loop) when no refresh token is stored', async () => {
    setTokens({ token: 'expired-token' }) // no refresh token

    let refreshCalls = 0
    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') refreshCalls++
      return reject401(config)
    }

    await expect(api.get('/protected', { adapter })).rejects.toBeTruthy()

    expect(refreshCalls).toBe(0)
  })

  it('never retries the refresh endpoint itself on a 401 (no recursive retrigger)', async () => {
    setTokens({ token: 'x', refreshToken: 'y' })
    let refreshCalls = 0
    const adapter: AxiosAdapter = config => {
      refreshCalls++
      return reject401(config)
    }

    await expect(api.post('/auth/refresh', { refreshToken: 'y' }, { adapter })).rejects.toBeTruthy()

    // Exactly the one direct call this test made — no secondary refresh attempt.
    expect(refreshCalls).toBe(1)
  })

  it('never triggers a refresh for a 401 from a login endpoint', async () => {
    setTokens({ token: 'x', refreshToken: 'y' })
    let refreshCalls = 0
    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') refreshCalls++
      return reject401(config)
    }

    await expect(api.post('/auth/login', {}, { adapter })).rejects.toBeTruthy()

    expect(refreshCalls).toBe(0)
  })

  it('never triggers a refresh for a 401 from the logout endpoint (SG-001)', async () => {
    setTokens({ token: 'x', refreshToken: 'y' })
    let refreshCalls = 0
    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') refreshCalls++
      return reject401(config)
    }

    await expect(api.post('/auth/logout', {}, { adapter })).rejects.toBeTruthy()

    expect(refreshCalls).toBe(0)
  })

  it('never presents the stored (possibly expired) access token on the refresh call itself (SG-002)', async () => {
    setTokens({ token: 'expired-token', refreshToken: 'refresh-1' })

    let refreshSawAuthHeader: boolean | undefined
    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') {
        refreshSawAuthHeader = config.headers.has('Authorization')
        return Promise.resolve(
          respond(config, 200, { token: 'new-token', refreshToken: 'refresh-2' }),
        )
      }
      if (config.headers.get('Authorization') === 'Bearer new-token') {
        return Promise.resolve(respond(config, 200, { ok: true }))
      }
      return reject401(config)
    }
    api.defaults.adapter = adapter

    await api.get('/protected')

    expect(refreshSawAuthHeader).toBe(false)
  })

  it('coalesces concurrent 401s onto a single in-flight refresh call', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' })
    let refreshCalls = 0

    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') {
        refreshCalls++
        return Promise.resolve(respond(config, 200, { token: 'new', refreshToken: 'refresh-2' }))
      }
      if (config.headers.get('Authorization') === 'Bearer new') {
        return Promise.resolve(respond(config, 200, { ok: true }))
      }
      return reject401(config)
    }
    api.defaults.adapter = adapter

    const [a, b] = await Promise.all([
      api.get('/one'),
      api.get('/two'),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(refreshCalls).toBe(1)
  })
})

describe('mock-mode no-op', () => {
  it('a per-call mock adapter (the app-wide mock-data pattern) is unaffected by the token seam', async () => {
    // Mirrors sessionResolver/exerciseContextResolver/feedService: a canned
    // adapter that always resolves 200 never rejects, so the response
    // interceptor's 401 branch never engages — the token seam is a no-op.
    const adapter: AxiosAdapter = config => Promise.resolve(respond(config, 200, { canned: true }))

    const response = await api.get('/mocked', { adapter })

    expect(response.data).toEqual({ canned: true })
    expect(getAccessToken()).toBeNull()
  })
})
