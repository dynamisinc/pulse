/**
 * core/auth/session.reconnect.integration.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W-5, END TO END through the real pieces: the real `SessionProvider`,
 * the real `resolveSession()`, the real shared axios client with its real silent-refresh
 * interceptor, and the real token store. Only the network is faked: a custom adapter on
 * `api.defaults.adapter` answers `GET /session` and `POST /auth/refresh` the way a server
 * (or a dead connection) would. `core/config/mockData` is forced off so `resolveSession`
 * goes through that adapter instead of its canned mock one.
 *
 * What a unit test with a mocked resolver cannot see, and this does:
 *   - the page-load request really does 401, then the refresh really gets no answer, and
 *     the PAIR IS REALLY STILL STORED when the provider decides (so the order "api.ts
 *     decides what to clear, the provider reads the store" holds);
 *   - a refresh the server REFUSES really clears the store, so the provider redirects;
 *   - "Try again" really reaches the refresh again even though the failed refresh started a
 *     cool-down (the retry ends it), and a recovered server lets the participant straight in;
 *   - the staff-tab case: a refused staff refresh must redirect even though a participant's
 *     pair sits in `localStorage` (the sticky store, W-6).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { SessionProvider, useSession } from './session'
import { clearTokens, getAccessToken, setTokens } from './tokenStore'

vi.mock('../config/mockData', () => ({ USE_MOCK_DATA: false }))

const SESSION_BODY = {
  exerciseId: 'ex-0001',
  accountId: 'acct-1',
  role: 'participant',
  personaId: 'persona-1',
  actingHumanId: 'human-1',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function ok(config: InternalAxiosRequestConfig, data: unknown): Promise<AxiosResponse> {
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

function reject(config: InternalAxiosRequestConfig, status: number): Promise<never> {
  const response = { data: {}, status, statusText: 'Error', headers: new axios.AxiosHeaders(), config }
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

function noAnswer(config: InternalAxiosRequestConfig): Promise<never> {
  return Promise.reject(
    new axios.AxiosError('Network Error', axios.AxiosError.ERR_NETWORK, config, undefined, undefined),
  )
}

function Probe() {
  return <div data-testid="probe">{useSession().accountId}</div>
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={(
            <SessionProvider>
              <Probe />
            </SessionProvider>
          )}
        />
        <Route path="/login" element={<div data-testid="login-sentinel" />} />
      </Routes>
    </MemoryRouter>,
  )
}

const originalAdapter = api.defaults.adapter

// The cool-down is timed on `performance.now()`; drive it by hand so "inside the cool-down"
// is a fact of the test, not of the machine.
let now = 5_000_000

beforeEach(() => {
  now = 5_000_000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStorage.clear()
  localStorage.clear()
  clearTokens()
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  clearTokens()
})

describe('page load with a valid stored pair whose access token has expired', () => {
  it('a refresh that gets NO ANSWER shows Reconnecting, keeps the pair, and does not go to /login', async () => {
    setTokens({ token: 'expired-access', refreshToken: 'refresh-1' }, { persist: true })
    const calls: string[] = []
    api.defaults.adapter = config => {
      calls.push(`${config.method ?? 'get'} ${config.url ?? ''}`)
      return config.url === '/auth/refresh' ? noAnswer(config) : reject(config, 401)
    }

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    expect(calls).toEqual(['get /session', 'post /auth/refresh'])
    expect(getAccessToken()).toBe('expired-access')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })

  it('a refresh the server REFUSES clears the store and goes to /login', async () => {
    setTokens({ token: 'expired-access', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config => reject(config, 401) // /session and /auth/refresh alike

    renderApp()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it.each([503, 429])('a %i from the refresh is no answer either: Reconnecting, pair kept', async status => {
    setTokens({ token: 'expired-access', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      config.url === '/auth/refresh' ? reject(config, status) : reject(config, 401)

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('expired-access')
  })

  it('Try again reaches the refresh even INSIDE the cool-down, and a recovered server lets them in', async () => {
    const user = userEvent.setup()
    setTokens({ token: 'expired-access', refreshToken: 'refresh-1' }, { persist: true })
    let serverUp = false
    const refreshes: string[] = []
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') {
        refreshes.push(String(config.data))
        return serverUp
          ? ok(config, { token: 'access-2', refreshToken: 'refresh-2' })
          : noAnswer(config)
      }
      return config.headers.get('Authorization') === 'Bearer access-2'
        ? ok(config, SESSION_BODY)
        : reject(config, 401)
    }

    renderApp()
    await screen.findByRole('heading', { name: 'Reconnecting…' })
    expect(refreshes).toHaveLength(1)

    // Two seconds later - well inside the 15 s cool-down - the connection is back.
    now += 2_000
    serverUp = true
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    // Without ending the cool-down this 401 would fail with NO refresh call and the screen
    // would simply say "still can't reach" again.
    expect(await screen.findByTestId('probe')).toHaveTextContent('acct-1')
    expect(refreshes).toHaveLength(2)
    expect(getAccessToken()).toBe('access-2')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-2')
  })

  it('Try again while the server is STILL down stays on the screen, with the pair intact', async () => {
    const user = userEvent.setup()
    setTokens({ token: 'expired-access', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      config.url === '/auth/refresh' ? noAnswer(config) : reject(config, 401)

    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/still can't reach pulse/i)).toBeInTheDocument()
    expect(getAccessToken()).toBe('expired-access')
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
  })

  it('Try again that finds the pair REFUSED this time ends at /login', async () => {
    const user = userEvent.setup()
    setTokens({ token: 'expired-access', refreshToken: 'refresh-1' }, { persist: true })
    let refusing = false
    api.defaults.adapter = config => {
      if (config.url === '/auth/refresh') return refusing ? reject(config, 401) : noAnswer(config)
      return reject(config, 401)
    }

    renderApp()
    await screen.findByRole('heading', { name: 'Reconnecting…' })
    refusing = true
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })
})

describe('what the server says at /session decides retry versus sign-in (W2-2)', () => {
  it('a well-formed but EXPIRED session goes to /login', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      ok(config, { ...SESSION_BODY, expiresAt: new Date(Date.now() - 1000).toISOString() })

    renderApp()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
  })

  it('a captive portal answering 200 with an HTML page stays on Reconnecting, pair kept', async () => {
    setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
    api.defaults.adapter = config =>
      ok(config, '<html><body>Welcome to the venue Wi-Fi. Please accept the terms.</body></html>')

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    expect(getAccessToken()).toBe('access-1')
  })
})

describe('no pair at all', () => {
  it('a signed-out page goes straight to /login, with no refresh attempted', async () => {
    const calls: string[] = []
    api.defaults.adapter = config => {
      calls.push(config.url ?? '')
      return reject(config, 401)
    }

    renderApp()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(calls).toEqual(['/session'])
  })
})

describe('W-6 + W-5: a refused staff tab beside a participant pair', () => {
  it('goes to /login (not Reconnecting), and never presents the participant bearer', async () => {
    setTokens({ token: 'expired-staff', refreshToken: 'staff-refresh' }) // sessionStorage
    localStorage.setItem('pulse.auth.token', 'p-access')
    localStorage.setItem('pulse.auth.refreshToken', 'p-refresh')
    localStorage.setItem('pulse.auth.session', 'participant-marker')
    const bearers: Array<string | null> = []
    api.defaults.adapter = config => {
      const header: unknown = config.headers.get('Authorization')
      bearers.push(typeof header === 'string' ? header : null)
      return reject(config, 401)
    }

    renderApp()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(bearers).not.toContain('Bearer p-access')
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('pulse.auth.token')).toBe('p-access')
  })
})
