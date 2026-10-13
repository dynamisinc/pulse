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
 *   - a REFUSED refresh (401/403 from `/auth/refresh`) clears both stores and does not loop;
 *   - no refresh is attempted when there is no stored refresh token;
 *   - the refresh/logout/login endpoints themselves never trigger the retry
 *     (SG-001 adds `/auth/logout` to that exclusion, explicit not emergent);
 *   - the refresh call itself never presents the stored (possibly expired)
 *     access token (SG-002 — it's read from the request BODY, not this
 *     header, so attaching it is unnecessary exposure surface);
 *   - concurrent 401s coalesce onto a single in-flight refresh call;
 *   - a per-call mock adapter (the mock-data pattern) is unaffected/harmless.
 *
 * Covers (feature: easy-login, story 07 — participant tokens in `localStorage`):
 *   - the rotated pair is stored in the SAME store the current pair lives in
 *     (participant stays persistent, staff stays session-only) with no option
 *     passed, and a REFUSED refresh (401/403) clears BOTH stores;
 *   - `/auth/join` and `/auth/word` never trigger a refresh;
 *   - the two-tab refresh race. A "tab" here is a separately-loaded copy of
 *     `api.ts` + `tokenStore.ts` (`vi.resetModules()`), which, like a real tab,
 *     has its own in-flight coalescing and in-memory state but SHARES
 *     `localStorage` and `navigator.locks`. With a (fake) Web Lock: exactly one
 *     `POST /auth/refresh`, neither tab signed out. Without the Locks API: a
 *     REFUSED refresh re-reads the stored refresh token and retries once with
 *     the new value instead of clearing;
 *   - a sign-out / sign-in this tab performs mid-refresh is not overwritten;
 *   - only a REFUSAL (401/403 from `/auth/refresh`) clears the stores. A network
 *     error, a timeout, a 5xx/429 or a token-less 2xx keeps the stored pair (the
 *     user stays signed in, the original request fails with its own error, and
 *     the next 401 tries the refresh again); the refresh call alone carries a
 *     20 s timeout, never the shared instance. After a no-answer refresh, a
 *     cool-down (`Retry-After` seconds, else 15 s, capped at 120 s) makes the next
 *     401s fail without calling the refresh;
 *   - CR-001: tab B signs out while tab A's refresh is on the wire. Nothing is
 *     left in `localStorage`, and A revokes the session the server just issued
 *     (`POST /auth/logout` with the NEW token; B's own logout carried the
 *     pre-rotation one and missed), with and without the Locks API;
 *   - M-1: the wait for the Web Lock is bounded (a suspended holder cannot block
 *     another tab), falling back to the unlocked path;
 *   - M-2: a request is never retried with, and never adopts, a pair another tab
 *     signed in as someone else; a same-sign-in rotation by another tab IS
 *     adopted; staff (sessionStorage) is unaffected; the cross-tab reload
 *     listener is installed by importing this module.
 */
import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api } from './api'
import {
  setTokens,
  rotateTokens,
  clearTokens,
  getAccessToken,
  getRefreshToken,
} from '../auth/tokenStore'

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
function rejectStatus(
  config: InternalAxiosRequestConfig,
  status: number,
  headers: Record<string, string> = {},
): Promise<never> {
  const response = { ...respond(config, status, {}), headers: new axios.AxiosHeaders(headers) }
  return Promise.reject(
    new axios.AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? axios.AxiosError.ERR_BAD_RESPONSE : axios.AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    ),
  )
}

function reject401(config: InternalAxiosRequestConfig): Promise<never> {
  return rejectStatus(config, 401)
}

/** What a built-in adapter rejects with when a request never got an answer (offline, reset). */
function rejectNetworkError(config: InternalAxiosRequestConfig): Promise<never> {
  return Promise.reject(
    new axios.AxiosError('Network Error', axios.AxiosError.ERR_NETWORK, config, undefined, undefined),
  )
}

/** What the built-in xhr/fetch adapters reject with when `config.timeout` elapses. */
function rejectTimeout(config: InternalAxiosRequestConfig): Promise<never> {
  return Promise.reject(
    new axios.AxiosError(
      `timeout of ${String(config.timeout)}ms exceeded`,
      axios.AxiosError.ECONNABORTED,
      config,
      undefined,
      undefined,
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
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  api.defaults.adapter = originalAdapter
  // Tests below install a fake Web Lock manager; jsdom has none by default.
  Reflect.deleteProperty(navigator, 'locks')
  localStorage.clear()
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

  it('clears both tokens and propagates the original 401 when refresh is REFUSED, without looping', async () => {
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

// ---------------------------------------------------------------------------
// easy-login story 07 — token stores, excluded paths, the cross-tab race
// ---------------------------------------------------------------------------

/** Adapter that 401s `/protected` until it sees `Bearer <goodToken>`, and rotates on refresh. */
function rotatingAdapter(
  goodToken: string,
  refreshCalls: string[],
  rotated = { token: goodToken, refreshToken: 'refresh-2' },
): AxiosAdapter {
  return config => {
    if (config.url === '/auth/refresh') {
      refreshCalls.push((JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken)
      return Promise.resolve(respond(config, 200, rotated))
    }
    if (config.headers.get('Authorization') === `Bearer ${goodToken}`) {
      return Promise.resolve(respond(config, 200, { ok: true }))
    }
    return reject401(config)
  }
}

describe('silent refresh keeps the token store the current pair lives in (EL-10)', () => {
  it('a PERSISTENT (localStorage) pair is rotated into localStorage, not sessionStorage', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const refreshCalls: string[] = []
    api.defaults.adapter = rotatingAdapter('new-token', refreshCalls)

    await api.get('/protected')

    expect(refreshCalls).toEqual(['refresh-1'])
    expect(localStorage.getItem('pulse.auth.token')).toBe('new-token')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-2')
    expect(sessionStorage.length).toBe(0)
  })

  it('a SESSION (sessionStorage) pair is rotated into sessionStorage, never localStorage', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' })
    api.defaults.adapter = rotatingAdapter('new-token', [])

    await api.get('/protected')

    expect(sessionStorage.getItem('pulse.auth.token')).toBe('new-token')
    expect(sessionStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-2')
    expect(localStorage.length).toBe(0)
  })

  it('a REFUSED refresh clears the persistent pair and the original 401 propagates', async () => {
    setTokens({ token: 'expired', refreshToken: 'stale' }, { persist: true })
    api.defaults.adapter = config => reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(getAccessToken()).toBeNull()
  })

  it('a 2xx refresh response with no tokens in it is not a refusal: the pair is kept', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      config.url === '/auth/refresh'
        ? Promise.resolve(respond(config, 200, { token: 'only-an-access-token' }))
        : reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.getItem('pulse.auth.token')).toBe('expired')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })
})

describe('only a REFUSED refresh ends the session; no answer keeps the pair', () => {
  /** An adapter whose refresh call fails with `refreshFailure` `failures` times, then rotates. */
  function flakyRefreshAdapter(
    refreshFailure: (config: InternalAxiosRequestConfig) => Promise<never>,
    refreshCalls: string[],
    failures = 1,
  ): AxiosAdapter {
    return config => {
      if (config.url === '/auth/refresh') {
        const sent = (JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken
        refreshCalls.push(sent)
        if (refreshCalls.length <= failures) return refreshFailure(config)
        return Promise.resolve(respond(config, 200, { token: 'new', refreshToken: 'refresh-2' }))
      }
      return config.headers.get('Authorization') === 'Bearer new'
        ? Promise.resolve(respond(config, 200, { ok: true }))
        : reject401(config)
    }
  }

  // The cool-down after a no-answer refresh is timed on `performance.now()`; drive it by hand.
  let now = 1_000_000
  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  describe.each([
    ['persistent (participant)', { persist: true }, () => localStorage],
    ['session-only (staff)', {}, () => sessionStorage],
  ])('%s pair', (_label, options, storeOf) => {
    it('a network error during refresh keeps both stores and the user stays signed in', async () => {
      setTokens({ token: 'expired', refreshToken: 'refresh-1' }, options)
      const refreshCalls: string[] = []
      api.defaults.adapter = flakyRefreshAdapter(rejectNetworkError, refreshCalls)

      // The caller sees an ordinary failure: the original request's own error.
      await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

      expect(refreshCalls).toEqual(['refresh-1']) // no re-read retry for a non-refusal
      expect(storeOf().getItem('pulse.auth.token')).toBe('expired')
      expect(storeOf().getItem('pulse.auth.refreshToken')).toBe('refresh-1')
      expect(getAccessToken()).toBe('expired')
      expect(getRefreshToken()).toBe('refresh-1')

      // Once the cool-down has passed, the next 401 simply tries the refresh again.
      now += 16_000
      const response = await api.get('/protected')
      expect(response.status).toBe(200)
      expect(refreshCalls).toEqual(['refresh-1', 'refresh-1'])
      expect(storeOf().getItem('pulse.auth.token')).toBe('new')
      expect(storeOf().getItem('pulse.auth.refreshToken')).toBe('refresh-2')
    })

    it('a 503 from the refresh endpoint does the same', async () => {
      setTokens({ token: 'expired', refreshToken: 'refresh-1' }, options)
      const refreshCalls: string[] = []
      api.defaults.adapter = flakyRefreshAdapter(config => rejectStatus(config, 503), refreshCalls)

      await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

      expect(storeOf().getItem('pulse.auth.token')).toBe('expired')
      expect(storeOf().getItem('pulse.auth.refreshToken')).toBe('refresh-1')

      now += 16_000
      await expect(api.get('/protected')).resolves.toMatchObject({ status: 200 })
      expect(refreshCalls).toHaveLength(2)
    })
  })

  it.each([500, 502, 429])('a %i from the refresh endpoint keeps the pair', async status => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      config.url === '/auth/refresh' ? rejectStatus(config, status) : reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.getItem('pulse.auth.token')).toBe('expired')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })

  it('a refresh that times out is "no answer": nothing is cleared', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      config.url === '/auth/refresh' ? rejectTimeout(config) : reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.getItem('pulse.auth.token')).toBe('expired')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })

  it.each([401, 403])('a %i from the refresh endpoint is a refusal: the session is cleared', async status => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      config.url === '/auth/refresh' ? rejectStatus(config, status) : reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('the re-read retry also keeps the pair when its own call gets no answer', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const refreshSent: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        refreshSent.push((JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken)
        if (refreshSent.length === 1) {
          // Refused, but another tab has meanwhile stored a rotated pair...
          localStorage.setItem('pulse.auth.token', 'other-tab-access')
          localStorage.setItem('pulse.auth.refreshToken', 'other-tab-refresh')
          return reject401(config)
        }
        return rejectNetworkError(config) // ...and the retry then drops.
      }
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(refreshSent).toEqual(['refresh-1', 'other-tab-refresh'])
    expect(localStorage.getItem('pulse.auth.token')).toBe('other-tab-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('other-tab-refresh')
  })
})

describe('the refresh call carries a ~20 s timeout (that call only)', () => {
  it('sets timeout: 20000 on POST /auth/refresh and on nothing else', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const timeouts = new Map<string, unknown>()
    api.defaults.adapter = config => {
      timeouts.set(String(config.url), config.timeout)
      if (config.url === '/auth/refresh') {
        return Promise.resolve(respond(config, 200, { token: 'new', refreshToken: 'refresh-2' }))
      }
      return config.headers.get('Authorization') === 'Bearer new'
        ? Promise.resolve(respond(config, 200, { ok: true }))
        : reject401(config)
    }

    await api.get('/protected')

    expect(timeouts.get('/auth/refresh')).toBe(20_000)
    // Not on the original request, and not a shared default.
    expect(timeouts.get('/protected')).toBeFalsy()
    expect(api.defaults.timeout).toBeFalsy()
  })
})

describe('excluded paths never trigger a refresh', () => {
  it.each(['/auth/join', '/auth/word'])(
    'a 401 from %s is a rejected link/word, not an expired session',
    async path => {
      setTokens({ token: 'x', refreshToken: 'y' }, { persist: true })
      let refreshCalls = 0
      const adapter: AxiosAdapter = config => {
        if (config.url === '/auth/refresh') refreshCalls++
        return reject401(config)
      }

      await expect(api.post(path, {}, { adapter })).rejects.toMatchObject({
        response: { status: 401 },
      })

      expect(refreshCalls).toBe(0)
      // And the existing session is untouched by the failed sign-in attempt.
      expect(getAccessToken()).toBe('x')
      expect(getRefreshToken()).toBe('y')
    },
  )
})

describe('a late 401 adopts a pair that was already rotated', () => {
  it('does not spend the refresh token again when the request was rejected with an older access token', async () => {
    // The request went out with 'old-token'; by the time its 401 lands the
    // pair has already been rotated (an earlier refresh in this page, or
    // another tab). Retry with the stored token; make no refresh call.
    setTokens({ token: 'old-token', refreshToken: 'refresh-1' }, { persist: true })
    const refreshCalls: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        refreshCalls.push('called')
        return reject401(config)
      }
      if (config.headers.get('Authorization') === 'Bearer rotated-token') {
        return Promise.resolve(respond(config, 200, { ok: true }))
      }
      // The first call is sent with 'old-token'; while it is "in flight" the
      // pair is rotated underneath it by the SAME sign-in (as another tab's
      // refresh would: new tokens, identity marker kept).
      rotateTokens('refresh-1', { token: 'rotated-token', refreshToken: 'refresh-2' })
      return reject401(config)
    }

    const response = await api.get('/protected')

    expect(response.status).toBe(200)
    expect(refreshCalls).toEqual([])
    expect(getAccessToken()).toBe('rotated-token')
    expect(getRefreshToken()).toBe('refresh-2')
  })
})

describe('a sign-out / sign-in in THIS tab while a refresh is in flight', () => {
  it('does not write the rotated pair back over a sign-out, and revokes the session it was issued', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const logoutBearers: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        clearTokens() // the user signed out while the call was in flight
        return Promise.resolve(respond(config, 200, { token: 'new', refreshToken: 'refresh-2' }))
      }
      if (config.url === '/auth/logout') {
        logoutBearers.push(String(config.headers.get('Authorization')))
        return Promise.resolve(respond(config, 204, undefined))
      }
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    // The server rotated; the sign-out's own logout could not have known the new token.
    await vi.waitFor(() => expect(logoutBearers).toEqual(['Bearer new']))
  })

  it('does not clear a fresh sign-in when the in-flight refresh then fails', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        // Someone signed in again (a different session) while the call was out.
        setTokens({ token: 'fresh-login', refreshToken: 'fresh-refresh' }, { persist: true })
        return reject401(config)
      }
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(getAccessToken()).toBe('fresh-login')
    expect(getRefreshToken()).toBe('fresh-refresh')
  })
})

describe('refresh without the Web Locks API: re-read before clearing', () => {
  it('jsdom has no navigator.locks, so these cases exercise the fallback path', () => {
    expect('locks' in navigator).toBe(false)
  })

  it('retries ONCE with the new refresh token when another tab rotated it mid-flight, and does not clear', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const refreshSent: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        const sent = (JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken
        refreshSent.push(sent)
        if (sent === 'refresh-1') {
          // The "second tab": it won the race, rotated the pair and stored the
          // result in the shared localStorage; our call is refused.
          localStorage.setItem('pulse.auth.token', 'other-tab-access')
          localStorage.setItem('pulse.auth.refreshToken', 'other-tab-refresh')
          return reject401(config)
        }
        return Promise.resolve(respond(config, 200, { token: 'mine', refreshToken: 'refresh-3' }))
      }
      return config.headers.get('Authorization') === 'Bearer mine'
        ? Promise.resolve(respond(config, 200, { ok: true }))
        : reject401(config)
    }

    const response = await api.get('/protected')

    expect(response.status).toBe(200)
    expect(refreshSent).toEqual(['refresh-1', 'other-tab-refresh'])
    expect(localStorage.getItem('pulse.auth.token')).toBe('mine')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-3')
  })

  it('makes only that one retry: a second refusal clears both stores', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const refreshSent: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        refreshSent.push((JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken)
        if (refreshSent.length === 1) {
          localStorage.setItem('pulse.auth.refreshToken', 'other-tab-refresh')
        }
      }
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(refreshSent).toEqual(['refresh-1', 'other-tab-refresh'])
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('does NOT retry when the stored refresh token is unchanged: one call, then clear', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const refreshSent: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        refreshSent.push((JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken)
      }
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(refreshSent).toEqual(['refresh-1'])
    expect(localStorage.length).toBe(0)
  })
})

// --- Two real "tabs": separately-loaded copies of api.ts + tokenStore.ts that share storage ---

/**
 * A minimal in-process Web Locks manager: exclusive, FIFO, shared by every tab
 * through `navigator.locks` (which, like the real one, is origin-wide). Supports
 * both call shapes (`request(name, callback)` and `request(name, options,
 * callback)`) and `options.signal`: a request still WAITING when its signal aborts
 * rejects with the signal's reason and never runs its callback, as the real one does.
 */
function installFakeWebLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  const request = vi.fn(
    (
      _name: string,
      optionsOrCallback: LockOptions | (() => unknown),
      maybeCallback?: () => unknown,
    ) => {
      const options: LockOptions = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      if (!callback) throw new TypeError('fake navigator.locks.request: no callback')

      return new Promise((resolve, reject) => {
        let waiting = true
        options.signal?.addEventListener('abort', () => {
          if (!waiting) return
          waiting = false
          reject(options.signal?.reason)
        }, { once: true })
        const granted = tail.then(() => {
          if (!waiting) return undefined // aborted while queued: never runs
          waiting = false
          return callback()
        })
        tail = granted.catch(() => undefined)
        granted.then(resolve, reject)
      })
    },
  )
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return request
}

interface FakeServer {
  /** Refresh tokens presented to `POST /auth/refresh`, in arrival order. */
  readonly refreshArrivals: string[]
  /** Access tokens presented to `POST /auth/logout`, in arrival order. */
  readonly logoutBearers: string[]
  /** `true` once a logout carried the CURRENT access token (the live session was ended). */
  readonly state: { sessionRevoked: boolean }
  /** Runs after the server has rotated, before its refresh response reaches the caller. */
  onRefreshOnTheWire: (() => Promise<void> | void) | undefined
  /** Hold the Nth (0-based) refresh RESPONSE until the returned function is called. */
  holdRefreshResponse(index: number): () => void
  readonly adapter: AxiosAdapter
}

/**
 * A tiny auth server: `/protected` accepts only the current access token;
 * `/auth/refresh` accepts only the current refresh token and ROTATES both (a
 * spent refresh token is refused, which is what signed a second tab out);
 * `/auth/logout` ends the session only when it carries the CURRENT access token
 * (a pre-rotation token misses, as on the real server).
 */
function createFakeServer(initialRefresh: string): FakeServer {
  let version = 1
  let currentRefresh = initialRefresh
  let currentAccess = 'access-v1'
  const refreshArrivals: string[] = []
  const logoutBearers: string[] = []
  const holds = new Map<number, Promise<void>>()

  const server: FakeServer = {
    refreshArrivals,
    logoutBearers,
    state: { sessionRevoked: false },
    onRefreshOnTheWire: undefined,
    adapter: async config => {
      await Promise.resolve()
      if (config.url === '/auth/refresh') {
        const index = refreshArrivals.length
        const presented = (JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken
        refreshArrivals.push(presented)
        let body: { token: string; refreshToken: string } | undefined
        if (presented === currentRefresh) {
          version++
          currentRefresh = `refresh-v${version}`
          currentAccess = `access-v${version}`
          body = { token: currentAccess, refreshToken: currentRefresh }
        }
        await server.onRefreshOnTheWire?.()
        await holds.get(index)
        return body ? respond(config, 200, body) : reject401(config)
      }
      if (config.url === '/auth/logout') {
        const bearer = String(config.headers.get('Authorization') ?? '').replace('Bearer ', '')
        logoutBearers.push(bearer)
        if (bearer === currentAccess) server.state.sessionRevoked = true
        return respond(config, 204, undefined)
      }
      if (config.headers.get('Authorization') === `Bearer ${currentAccess}`) {
        return respond(config, 200, { ok: true })
      }
      return reject401(config)
    },
    holdRefreshResponse(index) {
      let release: () => void = () => undefined
      holds.set(index, new Promise<void>(resolve => { release = resolve }))
      return release
    },
  }
  return server
}

/** Loads a fresh copy of the api + token store + logout, as a newly opened tab would. */
async function openTab(server: FakeServer) {
  vi.resetModules()
  const tabApi = (await import('./api')).api
  const tabStore = await import('../auth/tokenStore')
  const { logout } = await import('../auth/logout')
  tabApi.defaults.adapter = server.adapter
  return { api: tabApi, store: tabStore, logout }
}

describe('two tabs 401 at the same moment (the shared-localStorage refresh race)', () => {
  beforeEach(() => {
    // Both tabs wake on the same stale access token and the same refresh token.
    localStorage.setItem('pulse.auth.token', 'stale-access')
    localStorage.setItem('pulse.auth.refreshToken', 'refresh-v1')
  })

  it('with a Web Lock: exactly ONE POST /auth/refresh, and neither tab is signed out', async () => {
    const locks = installFakeWebLocks()
    const server = createFakeServer('refresh-v1')
    const tabA = await openTab(server)
    const tabB = await openTab(server)

    const [a, b] = await Promise.all([tabA.api.get('/protected'), tabB.api.get('/protected')])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(server.refreshArrivals).toEqual(['refresh-v1'])
    expect(locks).toHaveBeenCalledTimes(2)
    // Both tabs see the one rotated pair, in localStorage, and nothing was cleared.
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-v2')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-v2')
    expect(tabA.store.getAccessToken()).toBe('access-v2')
    expect(tabB.store.getAccessToken()).toBe('access-v2')
    expect(sessionStorage.length).toBe(0)
  })

  it('with a Web Lock, the refresh request is made under the lock name the tabs share', async () => {
    const locks = installFakeWebLocks()
    const server = createFakeServer('refresh-v1')
    const tab = await openTab(server)

    await tab.api.get('/protected')

    expect(locks).toHaveBeenCalledTimes(1)
    expect(locks.mock.calls[0]?.[0]).toBe('pulse.auth.refresh')
  })

  it('without the Locks API: the loser re-reads, retries once with the new token, and nobody is signed out', async () => {
    const server = createFakeServer('refresh-v1')
    const tabA = await openTab(server)
    const tabB = await openTab(server)
    // Hold the SECOND arrival's refusal until the winner has stored its pair, so
    // the loser's re-read deterministically sees the rotated refresh token.
    const releaseLoser = server.holdRefreshResponse(1)

    const a = tabA.api.get('/protected')
    const b = tabB.api.get('/protected')
    await vi.waitFor(() => expect(server.refreshArrivals).toHaveLength(2))
    await vi.waitFor(() =>
      expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-v2'),
    )
    releaseLoser()
    const [ra, rb] = await Promise.all([a, b])

    expect(ra.status).toBe(200)
    expect(rb.status).toBe(200)
    // Both tabs presented the same spent token; the refused one then retried with
    // the pair the winner stored. Two rotations, nobody cleared.
    expect(server.refreshArrivals).toEqual(['refresh-v1', 'refresh-v1', 'refresh-v2'])
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-v3')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-v3')
  })
})

// ---------------------------------------------------------------------------
// Gate-1 fold: CR-001, M-1, M-2, L-1
// ---------------------------------------------------------------------------

describe.each([
  ['with a Web Lock', true],
  ['without the Locks API', false],
])('CR-001: a sign-out in tab B during tab A\'s in-flight refresh sticks (%s)', (_label, withLock) => {
  it('leaves nothing in localStorage and ends the session the server just issued', async () => {
    if (withLock) installFakeWebLocks()
    const server = createFakeServer('refresh-v1')
    const tabA = await openTab(server)
    const tabB = await openTab(server)
    // One participant, signed in (persistently) in both tabs.
    tabA.store.setTokens({ token: 'stale-access', refreshToken: 'refresh-v1' }, { persist: true })
    // While A's refresh is on the wire, the user taps Sign out in B.
    server.onRefreshOnTheWire = async () => {
      server.onRefreshOnTheWire = undefined
      await tabB.logout()
    }

    await expect(tabA.api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    // The sign-out was not undone by A's rotated pair.
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(tabA.store.getAccessToken()).toBeNull()
    expect(tabB.store.getAccessToken()).toBeNull()
    // B's logout carried the PRE-rotation token and missed the live session; A's
    // cleanup carried the NEW one and ended it.
    await vi.waitFor(() => expect(server.logoutBearers).toEqual(['stale-access', 'access-v2']))
    expect(server.state.sessionRevoked).toBe(true)
    expect(server.refreshArrivals).toEqual(['refresh-v1'])
  })
})

describe('M-1: waiting for the Web Lock is bounded', () => {
  it('asks for the lock with a 45 s abort signal', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const locks = installFakeWebLocks()
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = rotatingAdapter('new-token', [])

    await api.get('/protected')

    expect(timeoutSpy).toHaveBeenCalledWith(45_000)
    const options = locks.mock.calls[0]?.[1] as LockOptions | undefined
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a holder that never lets go (a suspended tab) cannot block the refresh for ever', async () => {
    const locks = installFakeWebLocks()
    // The suspended tab: takes the lock and never releases it.
    void locks('pulse.auth.refresh', {}, () => new Promise<void>(() => undefined))
    // Stand in for the 45 s timer: a signal the test aborts.
    const waitLimit = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(waitLimit.signal)

    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const refreshCalls: string[] = []
    api.defaults.adapter = rotatingAdapter('new-token', refreshCalls)

    const request = api.get('/protected')
    await vi.waitFor(() => expect(locks).toHaveBeenCalledTimes(2)) // holder + this refresh
    expect(refreshCalls).toEqual([]) // still waiting for the lock

    waitLimit.abort(new DOMException('timed out', 'TimeoutError'))
    const response = await request

    // It carried on without the lock, on the unlocked path, and still rotated.
    expect(response.status).toBe(200)
    expect(refreshCalls).toEqual(['refresh-1'])
    expect(localStorage.getItem('pulse.auth.token')).toBe('new-token')
  })
})

describe('M-2: a different sign-in in another tab is never silently adopted', () => {
  /** Two tabs on one shared storage, each a separately-loaded copy of the modules. */
  type Tab = Awaited<ReturnType<typeof openTab>>
  async function twoTabs(adapterFor: (tabs: { b: Tab }) => AxiosAdapter) {
    const server = createFakeServer('unused')
    const a = await openTab(server)
    const b = await openTab(server)
    a.api.defaults.adapter = adapterFor({ b })
    return { a, b }
  }

  it('rejects the request with its own 401 instead of retrying it as the new user', async () => {
    const seen: string[] = []
    const { a } = await twoTabs(({ b }) => config => {
      if (config.url === '/auth/refresh') throw new Error('must not refresh another user\'s pair')
      seen.push(String(config.headers.get('Authorization')))
      // While X's request is out, tab B signs in as Y (new tokens, new identity marker).
      if (seen.length === 1) b.store.setTokens({ token: 'y-access', refreshToken: 'y-refresh' }, { persist: true })
      return reject401(config)
    })
    a.store.setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })

    await expect(a.api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(seen).toEqual(['Bearer x-access']) // never retried, least of all with y-access
    // Y's pair is untouched: not adopted, not refreshed, not cleared.
    expect(localStorage.getItem('pulse.auth.token')).toBe('y-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('y-refresh')
  })

  it('DOES adopt a pair another tab rotated for the SAME sign-in (marker unchanged)', async () => {
    const seen: string[] = []
    const { a, b } = await twoTabs(({ b }) => config => {
      if (config.url === '/auth/refresh') throw new Error('adopting must not call refresh')
      seen.push(String(config.headers.get('Authorization')))
      if (seen.length === 1) b.store.rotateTokens('x-refresh', { token: 'x-access-2', refreshToken: 'x-refresh-2' })
      return config.headers.get('Authorization') === 'Bearer x-access-2'
        ? Promise.resolve(respond(config, 200, { ok: true }))
        : reject401(config)
    })
    a.store.setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })

    const response = await a.api.get('/protected')

    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer x-access', 'Bearer x-access-2'])
    expect(b.store.getSessionMarker()).toBe(a.store.getSessionMarker())
  })

  it('a refused refresh does not retry with, or clear, a pair another sign-in stored meanwhile', async () => {
    const refreshSent: string[] = []
    const { a } = await twoTabs(({ b }) => config => {
      if (config.url === '/auth/refresh') {
        refreshSent.push((JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken)
        b.store.setTokens({ token: 'y-access', refreshToken: 'y-refresh' }, { persist: true })
      }
      return reject401(config)
    })
    a.store.setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })

    await expect(a.api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(refreshSent).toEqual(['x-refresh']) // never presents y-refresh
    expect(localStorage.getItem('pulse.auth.token')).toBe('y-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('y-refresh')
  })

  it('a refresh that SUCCEEDS after another sign-in is not stored, and its session is ended', async () => {
    const logoutBearers: string[] = []
    const { a } = await twoTabs(({ b }) => config => {
      if (config.url === '/auth/refresh') {
        b.store.setTokens({ token: 'y-access', refreshToken: 'y-refresh' }, { persist: true })
        return Promise.resolve(respond(config, 200, { token: 'x-access-2', refreshToken: 'x-refresh-2' }))
      }
      if (config.url === '/auth/logout') {
        logoutBearers.push(String(config.headers.get('Authorization')))
        return Promise.resolve(respond(config, 204, undefined))
      }
      return reject401(config)
    })
    a.store.setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })

    await expect(a.api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.getItem('pulse.auth.token')).toBe('y-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('y-refresh')
    await vi.waitFor(() => expect(logoutBearers).toEqual(['Bearer x-access-2']))
  })

  it('a staff session (sessionStorage) is unaffected by a participant signing in in another tab', async () => {
    const server = createFakeServer('staff-refresh-1')
    const staff = await openTab(server)
    staff.store.setTokens({ token: 'stale-staff', refreshToken: 'staff-refresh-1' }) // session-only
    const staffMarker = staff.store.getSessionMarker()

    // What a participant's sign-in in ANOTHER tab does to the shared localStorage
    // (sessionStorage is per tab, so it never reaches the staff tab's).
    localStorage.setItem('pulse.auth.token', 'p-access')
    localStorage.setItem('pulse.auth.refreshToken', 'p-refresh')
    localStorage.setItem('pulse.auth.session', 'participant-marker')

    // The staff tab still sees its own session, from its own store, same identity.
    expect(staff.store.getAccessToken()).toBe('stale-staff')
    expect(staff.store.getRefreshToken()).toBe('staff-refresh-1')
    expect(staff.store.getSessionMarker()).toBe(staffMarker)
    // And its 401 refresh rotates within sessionStorage, leaving the participant's pair alone.
    await expect(staff.api.get('/protected')).resolves.toMatchObject({ status: 200 })
    expect(sessionStorage.getItem('pulse.auth.token')).toBe('access-v2')
    expect(sessionStorage.getItem('pulse.auth.session')).toBe(staffMarker)
    expect(localStorage.getItem('pulse.auth.token')).toBe('p-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('p-refresh')
  })

  it('a request sent under one sign-in never borrows a refresh another sign-in started', async () => {
    // R1 is sent as X. Before its 401 lands, X is replaced by Y in this tab; Y's own
    // request then 401s and starts a refresh. R1's late 401 arrives WHILE that refresh
    // is still in flight and must not join it (and so be retried as Y).
    const r1Gates: Array<() => void> = []
    let finishRefresh: () => void = () => undefined
    const refreshSent: string[] = []
    const seen: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        refreshSent.push((JSON.parse(String(config.data)) as { refreshToken: string }).refreshToken)
        return new Promise(resolve => {
          finishRefresh = () => resolve(
            respond(config, 200, { token: 'y-access-2', refreshToken: 'y-refresh-2' }),
          )
        })
      }
      const auth = String(config.headers.get('Authorization'))
      seen.push(`${String(config.url)}:${auth}`)
      if (auth === 'Bearer y-access-2') return Promise.resolve(respond(config, 200, { ok: true }))
      if (config.url === '/r1') {
        return new Promise((_resolve, reject) => {
          r1Gates.push(() => { void reject401(config).catch(reject) })
        })
      }
      return reject401(config)
    }
    setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })
    const r1 = api.get('/r1').catch((error: unknown) => error)
    await vi.waitFor(() => expect(r1Gates).toHaveLength(1))
    setTokens({ token: 'y-access', refreshToken: 'y-refresh' }, { persist: true })
    const r2 = api.get('/r2')
    await vi.waitFor(() => expect(refreshSent).toEqual(['y-refresh'])) // Y's refresh is on the wire

    r1Gates[0]?.() // R1's 401 arrives now
    expect(await r1).toMatchObject({ response: { status: 401 } })

    finishRefresh()
    expect((await r2).status).toBe(200)
    expect(seen.filter(entry => entry.startsWith('/r1'))).toEqual(['/r1:Bearer x-access'])
    expect(refreshSent).toEqual(['y-refresh'])
  })

  it('importing the api module installs the cross-tab reload listener', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    vi.resetModules()

    await import('./api')

    expect(add).toHaveBeenCalledWith('storage', expect.any(Function))
  })
})

describe('L-1: a cool-down after a no-answer refresh', () => {
  let now = 5_000_000
  beforeEach(() => {
    now = 5_000_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  /** Counts refresh calls; every refresh answers with `failure`, every other call 401s. */
  function failingRefresh(failure: (config: InternalAxiosRequestConfig) => Promise<never>) {
    const calls = { refresh: 0 }
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        calls.refresh++
        return failure(config)
      }
      return reject401(config)
    }
    return calls
  }

  it('a 401 inside the default 15 s cool-down fails with its own error and calls no refresh', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(rejectNetworkError)

    await expect(api.get('/a')).rejects.toMatchObject({ response: { status: 401 } })
    expect(calls.refresh).toBe(1)

    now += 14_000
    await expect(api.get('/b')).rejects.toMatchObject({ response: { status: 401 } })
    expect(calls.refresh).toBe(1) // cooling down: no call

    now += 2_000 // 16 s after the failure
    await expect(api.get('/c')).rejects.toMatchObject({ response: { status: 401 } })
    expect(calls.refresh).toBe(2) // tried again

    // And throughout, the pair was kept.
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })

  it('honours Retry-After seconds from a 503 / 429', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(config => rejectStatus(config, 503, { 'Retry-After': '42' }))

    await expect(api.get('/a')).rejects.toBeTruthy()
    now += 41_000
    await expect(api.get('/b')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(1)

    now += 2_000 // 43 s
    await expect(api.get('/c')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(2)
  })

  it('caps an absurd Retry-After at 120 s', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(config => rejectStatus(config, 429, { 'Retry-After': '86400' }))

    await expect(api.get('/a')).rejects.toBeTruthy()
    now += 119_000
    await expect(api.get('/b')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(1)

    now += 2_000 // 121 s
    await expect(api.get('/c')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(2)
  })

  it.each([400, 404])('an unexpected %i from refresh is "no answer": pair kept, cool-down applies', async status => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(config => rejectStatus(config, status))

    await expect(api.get('/a')).rejects.toMatchObject({ response: { status: 401 } })
    await expect(api.get('/b')).rejects.toMatchObject({ response: { status: 401 } })

    expect(calls.refresh).toBe(1)
    expect(localStorage.getItem('pulse.auth.token')).toBe('expired')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })

  it('a refusal (401) is NOT a no-answer: it clears, with no cool-down involved', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(reject401)

    await expect(api.get('/a')).rejects.toBeTruthy()

    expect(calls.refresh).toBe(1)
    expect(localStorage.length).toBe(0)
  })

  it('a new sign-in ends the cool-down', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(rejectNetworkError)
    await expect(api.get('/a')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(1)

    setTokens({ token: 'fresh-login', refreshToken: 'refresh-9' }, { persist: true }) // no time passes
    await expect(api.get('/b')).rejects.toBeTruthy()

    expect(calls.refresh).toBe(2)
  })

  it('a Retry-After the server sends as a plain-object header is read too', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    let calls = 0
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        calls++
        const response = { ...respond(config, 503, {}), headers: { 'retry-after': '30' } }
        return Promise.reject(new axios.AxiosError(
          'Service Unavailable',
          axios.AxiosError.ERR_BAD_RESPONSE,
          config,
          undefined,
          response,
        ))
      }
      return reject401(config)
    }

    await expect(api.get('/a')).rejects.toBeTruthy()
    now += 29_000
    await expect(api.get('/b')).rejects.toBeTruthy()
    expect(calls).toBe(1)
    now += 2_000
    await expect(api.get('/c')).rejects.toBeTruthy()
    expect(calls).toBe(2)
  })

  it('is timed on a monotonic clock: moving the wall clock neither extends nor ends it', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    const calls = failingRefresh(rejectNetworkError)
    await expect(api.get('/a')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(1)

    // The user (or an NTP step) moves the wall clock an hour forward: still cooling down.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000)
    await expect(api.get('/b')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(1)

    now += 16_000 // real (monotonic) time passes
    await expect(api.get('/c')).rejects.toBeTruthy()
    expect(calls.refresh).toBe(2)
  })

  it('falls back to Date.now() only where performance is unavailable', async () => {
    vi.stubGlobal('performance', undefined)
    try {
      let wall = 9_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => wall)
      setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
      const calls = failingRefresh(rejectNetworkError)

      await expect(api.get('/a')).rejects.toBeTruthy()
      wall += 14_000
      await expect(api.get('/b')).rejects.toBeTruthy()
      expect(calls.refresh).toBe(1)

      wall += 2_000
      await expect(api.get('/c')).rejects.toBeTruthy()
      expect(calls.refresh).toBe(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ---------------------------------------------------------------------------
// Final fold: N-1, N-2, S-3
// ---------------------------------------------------------------------------

describe('N-1: a refusal only ever applies to OUR session', () => {
  it('a refused refresh does not wipe a pair another tab just signed in with, refresh token or not', async () => {
    let signInInTabB: () => void = () => undefined
    const adapter: AxiosAdapter = config => {
      if (config.url === '/auth/refresh') {
        signInInTabB() // tab B: a shared read-only sign-in (persisted, NO refresh token)
        return reject401(config) // X's refresh is refused (say, end of day)
      }
      return reject401(config)
    }
    const server = createFakeServer('unused')
    const a = await openTab(server)
    const b = await openTab(server)
    a.api.defaults.adapter = adapter
    a.store.setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })
    signInInTabB = () => b.store.setTokens({ token: 'shared-access' }, { persist: true })

    await expect(a.api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.getItem('pulse.auth.token')).toBe('shared-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBeNull()
    expect(localStorage.getItem('pulse.auth.session')).toBe(b.store.getSessionMarker())
  })

  it('a refusal that is still about our own session does clear it', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config => reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.length).toBe(0)
  })
})

describe('N-2: a sign-in is not half-adopted while another tab is mid-write', () => {
  it('a request sent under the old identity is rejected, not retried, in the in-between state', async () => {
    const seen: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') throw new Error('no refresh expected')
      seen.push(String(config.headers.get('Authorization')))
      if (seen.length === 1) {
        // Another tab's setTokens(Y), caught between its writes: the old marker is
        // already out (it goes FIRST), Y's pair is in, Y's new marker is not written yet.
        localStorage.removeItem('pulse.auth.session')
        localStorage.setItem('pulse.auth.token', 'y-access')
        localStorage.setItem('pulse.auth.refreshToken', 'y-refresh')
      }
      return reject401(config)
    }
    setTokens({ token: 'x-access', refreshToken: 'x-refresh' }, { persist: true })

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(seen).toEqual(['Bearer x-access']) // never retried as Y
    expect(localStorage.getItem('pulse.auth.token')).toBe('y-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('y-refresh')
  })
})

describe('S-3: an automatic clear touches only the store the session lives in', () => {
  /** What a participant's sign-in in another tab leaves in the shared localStorage. */
  function participantPairInOtherTab(): void {
    localStorage.setItem('pulse.auth.token', 'p-access')
    localStorage.setItem('pulse.auth.refreshToken', 'p-refresh')
    localStorage.setItem('pulse.auth.session', 'participant-marker')
  }

  it('a staff tab whose refresh is refused clears sessionStorage and leaves the participant pair', async () => {
    setTokens({ token: 'expired-staff', refreshToken: 'staff-refresh' }) // session-only
    participantPairInOtherTab()
    api.defaults.adapter = config => reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(sessionStorage.length).toBe(0)
    expect(localStorage.getItem('pulse.auth.token')).toBe('p-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('p-refresh')
    expect(localStorage.getItem('pulse.auth.session')).toBe('participant-marker')
  })

  it('a staff tab with no refresh token to present also clears only its own store', async () => {
    setTokens({ token: 'shared-readonly-access' }) // session-only, no refresh token
    participantPairInOtherTab()
    api.defaults.adapter = config => reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(sessionStorage.length).toBe(0)
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('p-refresh')
  })

  it('a participant tab whose refresh is refused clears its localStorage pair', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config => reject401(config)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('W-6: a refused staff tab never falls through to a participant pair', () => {
  /** What a participant's sign-in in another tab leaves in the shared localStorage. */
  function participantPairInOtherTab(): void {
    localStorage.setItem('pulse.auth.token', 'p-access')
    localStorage.setItem('pulse.auth.refreshToken', 'p-refresh')
    localStorage.setItem('pulse.auth.session', 'participant-marker')
  }

  /** An adapter that refuses everything with a 401 and records each request's bearer. */
  function refusingAdapter(bearers: Array<string | null>): AxiosAdapter {
    return config => {
      const header: unknown = config.headers.get('Authorization')
      bearers.push(typeof header === 'string' ? header : null)
      return reject401(config)
    }
  }

  it('after the refusal getAccessToken() is null in this page, and the participant pair is untouched', async () => {
    setTokens({ token: 'expired-staff', refreshToken: 'staff-refresh' }) // sessionStorage
    participantPairInOtherTab()
    const bearers: Array<string | null> = []
    api.defaults.adapter = refusingAdapter(bearers)

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.getItem('pulse.auth.token')).toBe('p-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('p-refresh')
  })

  it('NO request goes out with the participant bearer, before, during or after the refusal', async () => {
    setTokens({ token: 'expired-staff', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    const bearers: Array<string | null> = []
    api.defaults.adapter = refusingAdapter(bearers)

    await expect(api.get('/protected')).rejects.toBeDefined()
    // The page keeps working (polling, a retry button, a navigation): every later request
    // must go out anonymous, never as the participant.
    await expect(api.get('/later')).rejects.toBeDefined()
    await expect(api.get('/session')).rejects.toBeDefined()

    expect(bearers).not.toContain('Bearer p-access')
    expect(bearers).not.toContain('Bearer p-refresh')
    // The first call carried the staff token; the refresh call carries none; the rest none.
    expect(bearers[0]).toBe('Bearer expired-staff')
    expect(bearers.slice(1).every(bearer => bearer === null)).toBe(true)
    // And the refresh call presented the STAFF refresh token in its body, not the participant's.
    expect(getRefreshToken()).toBeNull()
  })

  it('a refresh call never presents the participant refresh token', async () => {
    setTokens({ token: 'expired-staff', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    const refreshBodies: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') refreshBodies.push(String(config.data))
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toBeDefined()
    await expect(api.get('/later')).rejects.toBeDefined()

    // One refresh, with the staff token. The second 401 had nothing to present, so no call.
    expect(refreshBodies).toEqual([JSON.stringify({ refreshToken: 'staff-refresh' })])
  })

  it('a staff tab with no refresh token to present is sticky too', async () => {
    setTokens({ token: 'shared-readonly-access' }) // session-only, no refresh token
    participantPairInOtherTab()
    const bearers: Array<string | null> = []
    api.defaults.adapter = refusingAdapter(bearers)

    await expect(api.get('/protected')).rejects.toBeDefined()
    await expect(api.get('/later')).rejects.toBeDefined()

    expect(getAccessToken()).toBeNull()
    expect(bearers).not.toContain('Bearer p-access')
  })

  it('a new sign-in in this tab ends it', async () => {
    setTokens({ token: 'expired-staff', refreshToken: 'staff-refresh' })
    participantPairInOtherTab()
    api.defaults.adapter = config => reject401(config)
    await expect(api.get('/protected')).rejects.toBeDefined()
    expect(getAccessToken()).toBeNull()

    setTokens({ token: 'staff-2', refreshToken: 'staff-refresh-2' })

    expect(getAccessToken()).toBe('staff-2')
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
