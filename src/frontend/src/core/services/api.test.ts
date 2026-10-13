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
 *
 * Covers (feature: easy-login, story 07 — participant tokens in `localStorage`):
 *   - the rotated pair is stored in the SAME store the current pair lives in
 *     (participant stays persistent, staff stays session-only) with no option
 *     passed, and a refresh failure clears BOTH stores;
 *   - `/auth/join` and `/auth/word` never trigger a refresh;
 *   - the two-tab refresh race. A "tab" here is a separately-loaded copy of
 *     `api.ts` + `tokenStore.ts` (`vi.resetModules()`), which, like a real tab,
 *     has its own in-flight coalescing and in-memory state but SHARES
 *     `localStorage` and `navigator.locks`. With a (fake) Web Lock: exactly one
 *     `POST /auth/refresh`, neither tab signed out. Without the Locks API: a
 *     failed refresh re-reads the stored refresh token and retries once with
 *     the new value instead of clearing;
 *   - a sign-out / sign-in this tab performs mid-refresh is not overwritten;
 *   - only a REFUSAL (401/403 from `/auth/refresh`) clears the stores. A network
 *     error, a timeout, a 5xx/429 or a token-less 2xx keeps the stored pair (the
 *     user stays signed in, the original request fails with its own error, and
 *     the next 401 tries the refresh again); the refresh call alone carries a
 *     20 s timeout, never the shared instance.
 */
import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api } from './api'
import { setTokens, clearTokens, getAccessToken, getRefreshToken } from '../auth/tokenStore'

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
function rejectStatus(config: InternalAxiosRequestConfig, status: number): Promise<never> {
  const response = respond(config, status, {})
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

  it('a refresh failure clears BOTH stores and the original 401 propagates (persistent pair)', async () => {
    setTokens({ token: 'expired', refreshToken: 'stale' }, { persist: true })
    // Belt and braces: a stray copy in the other store must go too.
    sessionStorage.setItem('pulse.auth.token', 'stray')
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

      // The next 401 simply tries the refresh again, and it works.
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

  it.each([401, 403])('a %i from the refresh endpoint is a refusal: both stores are cleared', async status => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    sessionStorage.setItem('pulse.auth.token', 'stray')
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
      // pair is rotated underneath it (as another tab would).
      setTokens({ token: 'rotated-token', refreshToken: 'refresh-2' }, { persist: true })
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
  it('does not write the rotated pair back over a sign-out (nothing is left in localStorage)', async () => {
    setTokens({ token: 'expired', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        clearTokens() // the user signed out while the call was in flight
        return Promise.resolve(respond(config, 200, { token: 'new', refreshToken: 'refresh-2' }))
      }
      return reject401(config)
    }

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
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
 * through `navigator.locks` (which, like the real one, is origin-wide).
 */
function installFakeWebLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  const request = vi.fn((_name: string, callback: () => unknown) => {
    const granted = tail.then(() => callback())
    tail = granted.catch(() => undefined)
    return granted
  })
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return request
}

interface FakeServer {
  /** Refresh tokens presented to `POST /auth/refresh`, in arrival order. */
  readonly refreshArrivals: string[]
  /** Hold the Nth (0-based) refresh RESPONSE until the returned function is called. */
  holdRefreshResponse(index: number): () => void
  readonly adapter: AxiosAdapter
}

/**
 * A tiny auth server: `/protected` accepts only the current access token;
 * `/auth/refresh` accepts only the current refresh token and ROTATES both
 * (a spent refresh token is refused, which is what signed a second tab out).
 */
function createFakeServer(initialRefresh: string): FakeServer {
  let version = 1
  let currentRefresh = initialRefresh
  let currentAccess = 'access-v1'
  const refreshArrivals: string[] = []
  const holds = new Map<number, Promise<void>>()

  const adapter: AxiosAdapter = async config => {
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
      await holds.get(index)
      return body ? respond(config, 200, body) : reject401(config)
    }
    if (config.headers.get('Authorization') === `Bearer ${currentAccess}`) {
      return respond(config, 200, { ok: true })
    }
    return reject401(config)
  }

  return {
    refreshArrivals,
    adapter,
    holdRefreshResponse(index) {
      let release: () => void = () => undefined
      holds.set(index, new Promise<void>(resolve => { release = resolve }))
      return release
    },
  }
}

/** Loads a fresh copy of the api + token store, as a newly opened tab would. */
async function openTab(server: FakeServer) {
  vi.resetModules()
  const tabApi = (await import('./api')).api
  const tabStore = await import('../auth/tokenStore')
  tabApi.defaults.adapter = server.adapter
  return { api: tabApi, store: tabStore }
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
