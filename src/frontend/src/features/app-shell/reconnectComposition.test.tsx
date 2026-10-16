/**
 * features/app-shell/reconnectComposition.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W2-3, through the REAL route stack: `createRoleAwareRoutes` mounting
 * the real `ExerciseContextProvider > SessionProvider > RoleAwareEntry`, the real axios
 * client with its real silent-refresh interceptor, the real token store and the real
 * resolvers. Only the network is faked (a per-test adapter on `api.defaults.adapter`) and
 * the two composition-root leaves `RoleAwareEntry` takes as props (the participant surface
 * and its guard) are stubs, exactly as in the other app-shell tests.
 *
 * What it proves that the providers' own unit tests cannot: the FIRST request of the app
 * (`GET /exercise-context`, made before any session exists) and the second (`GET /session`)
 * both give a signed-in person the same neutral "Reconnecting..." screen when the server is
 * not reached, and "Try again" gets them into the signed-in surface once it is. Definite
 * answers (404) and a signed-out page keep today's behaviour.
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, getAccessToken, setTokens } from '@/core/auth'
import { api } from '@/core/services/api'
import { createRoleAwareRoutes } from './routes'
import type { RoleAwareEntryProps } from './RoleAwareEntry'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

const SCOPE = {
  exerciseId: 'ex-0001',
  exerciseName: 'Coastal Surge',
  timeZone: 'America/New_York',
  status: 'live',
}

const SESSION = {
  exerciseId: 'ex-0001',
  accountId: 'acct-1',
  role: 'participant',
  personaId: 'persona-1',
  actingHumanId: 'human-1',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

const StubGuard: ComponentType<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="participant-guard">{children}</div>
)

const SURFACES: RoleAwareEntryProps = {
  participantSurface: <div data-testid="participant-surface" />,
  staffRoutes: [],
  participantGuard: StubGuard,
}

type Adapter = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>

function ok(config: InternalAxiosRequestConfig, data: unknown): Promise<AxiosResponse> {
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

function reject(config: InternalAxiosRequestConfig, status: number): Promise<never> {
  return Promise.reject(
    new axios.AxiosError(
      `Request failed with status code ${status}`,
      axios.AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      { data: {}, status, statusText: 'Error', headers: new axios.AxiosHeaders(), config },
    ),
  )
}

function noAnswer(config: InternalAxiosRequestConfig): Promise<never> {
  return Promise.reject(
    new axios.AxiosError('Network Error', axios.AxiosError.ERR_NETWORK, config, undefined, undefined),
  )
}

/** What the fake server does for each endpoint; tests flip these between attempts. */
interface Behaviour {
  exerciseContext: Adapter
  session: Adapter
  refresh: Adapter
}

let behaviour: Behaviour
const requests: string[] = []

function installServer(next: Partial<Behaviour>): void {
  behaviour = {
    exerciseContext: config => ok(config, SCOPE),
    session: config => ok(config, SESSION),
    refresh: config => reject(config, 401),
    ...next,
  }
}

function renderApp(path = '/') {
  const router = createMemoryRouter(createRoleAwareRoutes(SURFACES), { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const originalAdapter = api.defaults.adapter

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  clearTokens()
  requests.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  installServer({})
  api.defaults.adapter = config => {
    requests.push(`${config.method ?? 'get'} ${config.url ?? ''}`)
    switch (config.url) {
      case '/exercise-context': return behaviour.exerciseContext(config)
      case '/session': return behaviour.session(config)
      case '/auth/refresh': return behaviour.refresh(config)
      default: return reject(config, 404)
    }
  }
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  clearTokens()
})

const signInAsParticipant = () =>
  setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

describe('the FIRST request at page load (GET /exercise-context)', () => {
  it('no answer, with a pair stored: Reconnecting, then Try again reaches the signed-in surface', async () => {
    const user = userEvent.setup()
    signInAsParticipant()
    installServer({ exerciseContext: noAnswer })

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    // Not the dead-end notice, not the login page, nothing of the app mounted.
    expect(screen.queryByTestId('exercise-scope-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByTestId('participant-surface')).not.toBeInTheDocument()
    expect(getAccessToken()).toBe('access-1')

    // The connection comes back.
    installServer({})
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('participant-surface')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(requests).toContain('get /session')
  })

  it('a 401 whose silent refresh got NO ANSWER is the same: Reconnecting, then straight in', async () => {
    const user = userEvent.setup()
    signInAsParticipant()
    installServer({
      exerciseContext: config => reject(config, 401),
      refresh: noAnswer,
    })

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-1') // the pair was kept on purpose

    // Server recovered: the refresh rotates the pair, and the retried request carries it.
    installServer({
      exerciseContext: config =>
        config.headers.get('Authorization') === 'Bearer access-2'
          ? ok(config, SCOPE)
          : reject(config, 401),
      refresh: config => ok(config, { token: 'access-2', refreshToken: 'refresh-2' }),
    })
    // Inside the cool-down the refresh would not even be called; the retry ends it.
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('participant-surface')).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-2')
  })

  it('a 404 keeps today\'s behaviour: the closed-door notice, not Reconnecting', async () => {
    signInAsParticipant()
    installServer({ exerciseContext: config => reject(config, 404) })

    renderApp()

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(requests).not.toContain('get /session')
  })

  it('a signed-out page with no answer keeps today\'s behaviour too', async () => {
    installServer({ exerciseContext: noAnswer })

    renderApp()

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
  })
})

describe('the SECOND request (GET /session) gives the same screen', () => {
  it('no answer, with a pair stored: Reconnecting, then Try again reaches the surface', async () => {
    const user = userEvent.setup()
    signInAsParticipant()
    installServer({ session: noAnswer })

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.queryByTestId('participant-surface')).not.toBeInTheDocument()

    installServer({})
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('participant-surface')).toBeInTheDocument()
  })
})

describe('"Sign in again" goes to the right sign-in', () => {
  it('a staff tab with no answer on the first request signs in again at /staff/login', async () => {
    const user = userEvent.setup()
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' }) // sessionStorage
    installServer({ exerciseContext: noAnswer })

    const router = renderApp('/staff/console')
    await user.click(await screen.findByRole('link', { name: 'Sign in again' }))

    expect(router.state.location.pathname).toBe('/staff/login')
    expect(await screen.findByTestId('staff-sign-in-form')).toBeInTheDocument()
  })

  it('a participant signs in again at /login', async () => {
    signInAsParticipant()
    installServer({ exerciseContext: noAnswer })

    renderApp()

    expect(await screen.findByRole('link', { name: 'Sign in again' }))
      .toHaveAttribute('href', '/login')
  })
})
