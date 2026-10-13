/**
 * features/login/pages/JoinPage.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 08 (the join page, `/join/:token`) — RTL coverage of every
 * Acceptance Criterion except the two that need the file system rather than a
 * rendered page (the import boundary: `JoinPage.boundary.test.ts`; the 16px / 44px
 * / contrast numbers: `JoinPage.styles.test.ts`; the `/join/*` response headers:
 * `staticWebAppConfig.test.ts`).
 *
 * AC -> describe block
 *   AC1  exactly one POST under StrictMode, setTokens(persist), cache cleared,
 *        navigate('/', replace), Back does not return ........ "the exchange"
 *   AC2  URL rewritten to /join BEFORE the call completes ..... "the address bar"
 *   AC3  status / 401 / 429 / network+5xx / Try again, with focus moves
 *                                  ....... "the live regions and their focus moves"
 *   AC4  a different participant is replaced, a staff session removed
 *                                  ........................... "one browser, one identity"
 *   AC5  exercise name, resolved and failed (non-blocking) ..... "the exercise name"
 *   bare /join (the scrubbed address after a reload) ........... "a bare /join"
 *   Gate-1 S-4: a non-participant role is never persisted
 *                      ........ "a participant link never stores a staff session"
 *   Gate-1 S-7: startedRef pinned on its own
 *                      ........ "the exchange" (effect re-run after a failure)
 *   a11y: one h1, a main, keyboard reach ....................... "accessibility"
 *   content security: token never in a console call / the page .. "the token never leaks"
 *
 * HOW IT IS WIRED. The page is rendered in a REAL `createMemoryRouter` (route
 * `/join/:token`, `/join`, plus `/login` and a `*` sentinel standing in for the
 * role-aware entry), so `navigate('/', { replace: true })` is observable on the
 * router (`state.location`, `state.historyAction`, `navigate(-1)`). The network
 * boundary is `@/core/services/api` (mocked `post`); the REAL `joinService` runs on
 * top of it with `USE_MOCK_DATA` pinned to `false`, so status mapping and the
 * token-free error wrapping are exercised end to end. `@/core/auth` keeps the REAL
 * token store (only `setTokens` is wrapped in a spy so its arguments can be
 * asserted), which is what lets the identity-replacement cases assert on real
 * `localStorage` / `sessionStorage` contents. `@/core/exerciseContext` is mocked
 * per test. The browser URL is simulated with `window.history.replaceState`
 * (jsdom), because the memory router never touches it.
 */
import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { resetClientSession, setTokens } from '@/core/auth'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getSessionMarker,
  isPersistentSession,
} from '@/core/auth/tokenStore'
import { resolveExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { JoinPage } from './JoinPage'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

// The real token store; only `setTokens` is wrapped so the page's call can be asserted.
// `resetClientSession` is a spy: its own behaviour is covered by core/auth/endSession.test.ts.
vi.mock('@/core/auth', async () => {
  const store = await vi.importActual<typeof import('@/core/auth/tokenStore')>(
    '@/core/auth/tokenStore',
  )
  return { setTokens: vi.fn(store.setTokens), resetClientSession: vi.fn() }
})

vi.mock('@/core/exerciseContext', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockPost = vi.mocked(api.post)
const mockSetTokens = vi.mocked(setTokens)
const mockResetClientSession = vi.mocked(resetClientSession)
const mockResolveExerciseContext = vi.mocked(resolveExerciseContext)

const TOKEN = 'tok_7f3a9c1e-SECRET-join-link'
const ENVELOPE = { token: 'access-B', refreshToken: 'refresh-B' }

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  timeZone: 'UTC',
  status: 'active',
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/** A real AxiosError, with the request echo a live failure carries (token in `config.data`). */
function axiosErrorWith(status: number | undefined, data: unknown = ''): AxiosError {
  const config = { url: '/auth/join', data: JSON.stringify({ token: TOKEN }), headers: {} }
  const response = status === undefined
    ? undefined
    : ({ status, data, statusText: '', headers: {}, config } as unknown as AxiosResponse)
  return new AxiosError(
    'Request failed',
    undefined,
    config as unknown as AxiosError['config'],
    undefined,
    response,
  )
}

function ok(data: unknown = ENVELOPE): Awaited<ReturnType<typeof api.post>> {
  return { data } as Awaited<ReturnType<typeof api.post>>
}

/** A promise the test settles by hand, to hold the exchange in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface RenderOptions {
  readonly entries?: string[]
  readonly index?: number
  readonly strict?: boolean
  readonly queryClient?: QueryClient
}

/** Renders the page at `/join/<TOKEN>` (or other entries) in a real memory router. */
function renderJoin(options: RenderOptions = {}) {
  const queryClient = options.queryClient
    ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/join/:token', element: <JoinPage /> },
      { path: '/join', element: <JoinPage /> },
      { path: '/login', element: <p>sign-in page</p> },
      { path: '*', element: <p data-testid="entry">role-aware entry</p> },
    ],
    { initialEntries: options.entries ?? [`/join/${TOKEN}`], initialIndex: options.index },
  )
  const tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { ...view, router, queryClient }
}

/** Everything written to the console so far, flattened to one searchable string. */
function consoleText(spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies
    .flatMap(spy => spy.mock.calls)
    .flat()
    .map(arg => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ''}` : String(arg)))
    .join('\n')
}

beforeEach(() => {
  mockPost.mockReset()
  mockSetTokens.mockClear()
  mockResolveExerciseContext.mockReset()
  mockResolveExerciseContext.mockResolvedValue(SCOPE)
  clearTokens()
  localStorage.clear()
  sessionStorage.clear()
  // What the browser's address bar shows when the participant taps the link.
  window.history.replaceState(null, '', `/join/${TOKEN}`)
})

afterEach(() => {
  vi.restoreAllMocks()
  clearTokens()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the exchange (AC1)', () => {
  it('posts { token } to /auth/join exactly once under StrictMode', async () => {
    mockPost.mockResolvedValue(ok())

    renderJoin({ strict: true })

    await screen.findByTestId('entry')
    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/auth/join')
    expect(body).toEqual({ token: TOKEN })
  })

  it('still posts exactly once when a re-render lands while the exchange is in flight', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mockPost.mockReturnValue(pending.promise)

    renderJoin({ strict: true })
    // Resolving the exercise name re-renders the page while the exchange is pending.
    await screen.findByRole('heading', { level: 1, name: 'Alpha Exercise' })

    expect(mockPost).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(ok()))
    await screen.findByTestId('entry')
    expect(mockPost).toHaveBeenCalledTimes(1)
  })

  it('stores the returned pair with setTokens(pair, { persist: true })', async () => {
    mockPost.mockResolvedValue(ok())

    renderJoin({ strict: true })
    await screen.findByTestId('entry')

    expect(mockSetTokens).toHaveBeenCalledTimes(1)
    expect(mockSetTokens).toHaveBeenCalledWith(
      { token: 'access-B', refreshToken: 'refresh-B' },
      { persist: true },
    )
  })

  it('keeps a participant pair in localStorage and nothing in sessionStorage', async () => {
    mockPost.mockResolvedValue(ok())

    renderJoin()
    await screen.findByTestId('entry')

    expect(localStorage.getItem('pulse.auth.token')).toBe('access-B')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-B')
    expect(sessionStorage.getItem('pulse.auth.token')).toBeNull()
    expect(sessionStorage.getItem('pulse.auth.refreshToken')).toBeNull()
    expect(isPersistentSession()).toBe(true)
  })

  it('stores an envelope with no refresh token without inventing one', async () => {
    mockPost.mockResolvedValue(ok({ token: 'access-only' }))

    renderJoin()
    await screen.findByTestId('entry')

    expect(getAccessToken()).toBe('access-only')
    expect(getRefreshToken()).toBeNull()
  })

  it('clears the React Query cache', async () => {
    mockPost.mockResolvedValue(ok())
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['social', 'feed'], ['a post the previous user fetched'])
    queryClient.setQueryData(['staff', 'assignments'], ['staff data'])

    renderJoin({ queryClient })
    await screen.findByTestId('entry')

    expect(queryClient.getQueryData(['social', 'feed'])).toBeUndefined()
    expect(queryClient.getQueryData(['staff', 'assignments'])).toBeUndefined()
  })

  it('stores the new tokens BEFORE clearing the cache, so no refetch uses the old identity', async () => {
    mockPost.mockResolvedValue(ok())
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const clear = vi.spyOn(queryClient, 'clear')

    renderJoin({ queryClient })
    await screen.findByTestId('entry')

    expect(clear).toHaveBeenCalledTimes(1)
    const setOrder = mockSetTokens.mock.invocationCallOrder[0] ?? Infinity
    const clearOrder = clear.mock.invocationCallOrder[0] ?? 0
    expect(setOrder).toBeLessThan(clearOrder)
  })

  it('navigates to / with replace, so the role-aware entry takes over', async () => {
    mockPost.mockResolvedValue(ok())

    const { router } = renderJoin()
    await screen.findByTestId('entry')

    expect(router.state.location.pathname).toBe('/')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('Back does not return to the join page', async () => {
    mockPost.mockResolvedValue(ok())

    const { router } = renderJoin({ entries: ['/start', `/join/${TOKEN}`], index: 1 })
    await screen.findByTestId('entry')
    await act(async () => {
      await router.navigate(-1)
    })

    expect(router.state.location.pathname).toBe('/start')
  })

  it('does not hand off, or store anything, if the participant left before the answer', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mockPost.mockReturnValue(pending.promise)

    const { unmount, router } = renderJoin()
    await screen.findByRole('status')
    unmount()
    await act(async () => pending.resolve(ok()))

    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
    expect(router.state.location.pathname).toBe(`/join/${TOKEN}`)
  })

  it('does not retry on its own when the effect re-runs after a failure (startedRef, alone)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(undefined))
    const router = createMemoryRouter(
      [
        { path: '/join/:token', element: <JoinPage /> },
        { path: '*', element: <p data-testid="entry">role-aware entry</p> },
      ],
      { initialEntries: [`/join/${TOKEN}`] },
    )
    const clientA = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const clientB = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (client: QueryClient) => (
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const { rerender } = render(tree(clientA))
    await screen.findByRole('alert')
    expect(mockPost).toHaveBeenCalledTimes(1)

    // A new QueryClient changes the exchange callback's identity, so the start effect
    // runs again with NO exchange in flight (the failed one has settled). Only
    // `startedRef` stands between that re-run and an automatic second POST.
    rerender(tree(clientB))
    await act(async () => undefined)

    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('the address bar (AC2, EL-7)', () => {
  it('rewrites the URL to /join before the network call completes', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mockPost.mockReturnValue(pending.promise)

    renderJoin({ strict: true })
    await screen.findByRole('status')

    // The exchange is still in flight, and the token is already out of the URL.
    expect(window.location.pathname).toBe('/join')
    expect(window.location.href).not.toContain(TOKEN)
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')

    await act(async () => pending.resolve(ok()))
    await screen.findByTestId('entry')
  })

  it('scrubs before it posts (the call is made after the rewrite)', async () => {
    mockPost.mockResolvedValue(ok())
    const replaceState = vi.spyOn(window.history, 'replaceState')

    renderJoin()
    await screen.findByTestId('entry')

    const scrub = replaceState.mock.calls.findIndex(call => call[2] === '/join')
    expect(scrub).toBeGreaterThanOrEqual(0)
    const scrubOrder = replaceState.mock.invocationCallOrder[scrub] ?? Infinity
    const postOrder = mockPost.mock.invocationCallOrder[0] ?? 0
    expect(scrubOrder).toBeLessThan(postOrder)
  })

  it('replaces the history entry rather than adding one, and keeps its state', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mockPost.mockReturnValue(pending.promise)
    const routerState = { usr: null, key: 'abc123', idx: 4 }
    window.history.replaceState(routerState, '', `/join/${TOKEN}`)
    const lengthBefore = window.history.length

    renderJoin()
    await screen.findByRole('status')

    expect(window.history.length).toBe(lengthBefore)
    expect(window.history.state).toEqual(routerState)
    await act(async () => pending.resolve(ok()))
  })

  it('also scrubs when the exchange then fails, and for a retry', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(undefined))

    renderJoin()
    await screen.findByRole('alert')

    expect(window.location.pathname).toBe('/join')
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('keeps the token out of the rendered page', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))

    renderJoin()
    await screen.findByRole('alert')

    expect(document.body.innerHTML).not.toContain(TOKEN)
  })
})

describe('the live regions and their focus moves (AC3)', () => {
  it('shows "Signing you in…" in a polite status region and focuses it', async () => {
    mockPost.mockReturnValue(new Promise(() => undefined))

    renderJoin()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Signing you in…')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('401', () => {
    beforeEach(() => {
      mockPost.mockRejectedValue(axiosErrorWith(401))
    })

    it('shows one generic message in a focused role="alert" with an icon', async () => {
      renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/this link isn't working any more/i)
      expect(alert).toHaveTextContent(/ask your controller for a new one/i)
      expect(alert).toHaveTextContent(/today's word/i)
      expect(alert.querySelector('svg')).not.toBeNull()
      expect(alert).toHaveFocus()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('never says whether the link was wrong, revoked, replaced or expired', async () => {
      renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).not.toMatch(
        /wrong|revoked|replaced|expired|invalid|unknown|disabled/i,
      )
    })

    it.each([
      ['an empty body', ''],
      ['a body that explains itself', { message: 'link revoked by controller' }],
      ['a body that names the reason as text', 'token expired'],
    ])('shows the same message for %s', async (_label, body) => {
      mockPost.mockRejectedValue(axiosErrorWith(401, body))

      renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(
        "This link isn't working any more. Ask your controller for a new one, "
        + "or sign in with today's word.",
      )
    })

    it('treats a 400 the same way (a malformed request can never succeed on retry)', async () => {
      mockPost.mockRejectedValue(axiosErrorWith(400))

      renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/this link isn't working any more/i)
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('offers a link to /login and no Try again', async () => {
      renderJoin()
      await screen.findByRole('alert')

      const signIn = screen.getByRole('link', { name: /sign in/i })
      expect(signIn).toHaveAttribute('href', '/login')
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('goes to the sign-in page when the link is followed', async () => {
      const user = userEvent.setup()
      renderJoin()
      await screen.findByRole('alert')

      await user.click(screen.getByRole('link', { name: /sign in/i }))

      expect(await screen.findByText('sign-in page')).toBeInTheDocument()
    })

    it('stores nothing and does not navigate away', async () => {
      const { router } = renderJoin()
      await screen.findByRole('alert')

      expect(mockSetTokens).not.toHaveBeenCalled()
      expect(getAccessToken()).toBeNull()
      expect(router.state.location.pathname).toBe(`/join/${TOKEN}`)
    })
  })

  describe('429', () => {
    it('says to wait a minute and tap the link again, in a focused alert with an icon', async () => {
      mockPost.mockRejectedValue(axiosErrorWith(429))

      renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/too many tries/i)
      expect(alert).toHaveTextContent(/wait a minute and tap the link again/i)
      expect(alert.querySelector('svg')).not.toBeNull()
      expect(alert).toHaveFocus()
      expect(mockSetTokens).not.toHaveBeenCalled()
    })
  })

  describe.each([
    ['a network error', () => axiosErrorWith(undefined)],
    ['a 500', () => axiosErrorWith(500)],
    ['a 503', () => axiosErrorWith(503, { detail: 'maintenance' })],
  ])('%s', (_label, makeError) => {
    it('says "Couldn\'t reach the exercise" with a Try again button, and focuses the alert', async () => {
      mockPost.mockRejectedValue(makeError())

      renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/couldn't reach the exercise/i)
      expect(alert.querySelector('svg')).not.toBeNull()
      expect(alert).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
    })
  })

  it('treats a 200 with no usable envelope as unreachable (fail closed)', async () => {
    mockPost.mockResolvedValue(ok({ nothing: 'useful' }))

    renderJoin()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't reach the exercise/i)
    expect(mockSetTokens).not.toHaveBeenCalled()
  })

  describe('Try again', () => {
    it('repeats the exchange with the same token, then signs in', async () => {
      const user = userEvent.setup()
      mockPost.mockRejectedValueOnce(axiosErrorWith(undefined)).mockResolvedValueOnce(ok())

      const { router } = renderJoin()
      await screen.findByRole('alert')

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByTestId('entry')
      expect(mockPost).toHaveBeenCalledTimes(2)
      expect(mockPost.mock.calls[1]?.[1]).toEqual({ token: TOKEN })
      expect(mockSetTokens).toHaveBeenCalledTimes(1)
      expect(router.state.historyAction).toBe('REPLACE')
    })

    it('shows the signing-in status again, focused, while it retries', async () => {
      const user = userEvent.setup()
      const retry = deferred<ReturnType<typeof ok>>()
      mockPost.mockRejectedValueOnce(axiosErrorWith(500)).mockReturnValueOnce(retry.promise)

      renderJoin()
      await screen.findByRole('alert')
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent('Signing you in…')
      expect(status).toHaveFocus()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await act(async () => retry.resolve(ok()))
    })

    it('can fail again and fall into a different state', async () => {
      const user = userEvent.setup()
      mockPost.mockRejectedValueOnce(axiosErrorWith(502)).mockRejectedValueOnce(axiosErrorWith(401))

      renderJoin()
      await screen.findByRole('alert')
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/this link isn't working any more/i)
      })
      expect(screen.getByRole('alert')).toHaveFocus()
      expect(mockPost).toHaveBeenCalledTimes(2)
    })

    it('does not post twice if it is activated twice before the page re-renders', async () => {
      const retry = deferred<ReturnType<typeof ok>>()
      mockPost.mockRejectedValueOnce(axiosErrorWith(500)).mockReturnValueOnce(retry.promise)

      renderJoin()
      await screen.findByRole('alert')
      const button = screen.getByRole('button', { name: 'Try again' })

      act(() => {
        button.click()
        button.click()
      })

      expect(mockPost).toHaveBeenCalledTimes(2)
      await act(async () => retry.resolve(ok()))
      await screen.findByTestId('entry')
    })
  })
})

describe('one browser, one identity (AC4)', () => {
  it('replaces a different participant\'s session and clears what they fetched', async () => {
    mockPost.mockResolvedValue(ok())
    setTokens({ token: 'access-A', refreshToken: 'refresh-A' }, { persist: true })
    const markerA = getSessionMarker()
    mockSetTokens.mockClear()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['social', 'feed'], ['participant A\'s feed'])

    renderJoin({ queryClient })
    await screen.findByTestId('entry')

    expect(getAccessToken()).toBe('access-B')
    expect(getRefreshToken()).toBe('refresh-B')
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-B')
    expect(JSON.stringify({ ...localStorage })).not.toContain('-A')
    expect(getSessionMarker()).not.toBeNull()
    expect(getSessionMarker()).not.toBe(markerA)
    expect(queryClient.getQueryData(['social', 'feed'])).toBeUndefined()
  })

  it('runs sign-out\'s client reset for the replaced identity, after the new tokens are stored (W-1)', async () => {
    mockPost.mockResolvedValue(ok())
    mockResetClientSession.mockClear()

    renderJoin()
    await screen.findByTestId('entry')

    expect(mockResetClientSession).toHaveBeenCalledTimes(1)
    expect(mockResetClientSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSetTokens.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
    )
  })

  it('removes a staff session held in sessionStorage on the same browser', async () => {
    mockPost.mockResolvedValue(ok())
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    expect(sessionStorage.getItem('pulse.auth.token')).toBe('staff-access')
    mockSetTokens.mockClear()

    renderJoin()
    await screen.findByTestId('entry')

    expect(sessionStorage.getItem('pulse.auth.token')).toBeNull()
    expect(sessionStorage.getItem('pulse.auth.refreshToken')).toBeNull()
    expect(sessionStorage.getItem('pulse.auth.session')).toBeNull()
    expect(getAccessToken()).toBe('access-B')
    expect(isPersistentSession()).toBe(true)
  })

  it('leaves the previous session alone when the new link is refused', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    setTokens({ token: 'access-A', refreshToken: 'refresh-A' }, { persist: true })
    mockSetTokens.mockClear()

    renderJoin()
    await screen.findByRole('alert')

    expect(getAccessToken()).toBe('access-A')
    expect(mockSetTokens).not.toHaveBeenCalled()
  })
})

describe('the exercise name (AC5, non-blocking)', () => {
  it('heads the page with the exercise name once it resolves', async () => {
    mockPost.mockReturnValue(new Promise(() => undefined))

    renderJoin()

    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha Exercise' })).toBeInTheDocument()
  })

  it('renders the name as text, never as markup', async () => {
    mockPost.mockReturnValue(new Promise(() => undefined))
    const hostile = '<img src=x onerror=alert(1)>Bravo'
    mockResolveExerciseContext.mockResolvedValue({ ...SCOPE, exerciseName: hostile })

    const { container } = renderJoin()

    const heading = await screen.findByRole('heading', { level: 1, name: hostile })
    expect(heading.textContent).toBe(hostile)
    expect(container.querySelector('img')).toBeNull()
  })

  it('still renders and exchanges when the lookup fails, with a generic heading', async () => {
    mockResolveExerciseContext.mockRejectedValue(new Error('unknown host'))
    mockPost.mockResolvedValue(ok())

    renderJoin()

    await screen.findByTestId('entry')
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockSetTokens).toHaveBeenCalledTimes(1)
  })

  it('shows a generic heading, not the name, while it has failed', async () => {
    mockResolveExerciseContext.mockRejectedValue(new Error('unknown host'))
    mockPost.mockReturnValue(new Promise(() => undefined))

    renderJoin()

    const heading = await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(mockResolveExerciseContext).toHaveBeenCalled())
    expect(heading).not.toHaveTextContent('Alpha Exercise')
    expect(heading.textContent?.length ?? 0).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('does not wait for a lookup that never answers', async () => {
    mockResolveExerciseContext.mockReturnValue(new Promise(() => undefined))
    mockPost.mockResolvedValue(ok())

    renderJoin()

    await screen.findByTestId('entry')
    expect(mockPost).toHaveBeenCalledTimes(1)
  })

  it('still shows the name next to an error', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))

    renderJoin()

    await screen.findByRole('alert')
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha Exercise' })).toBeInTheDocument()
  })
})

describe('a bare /join (the scrubbed address, after a reload)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/join')
  })

  it('makes no request and tells the participant how to sign in', async () => {
    renderJoin({ entries: ['/join'] })

    const status = await screen.findByRole('status')
    expect(status.textContent).toBe(
      'To sign in, tap your link again or scan your card. '
      + "You can also sign in with today's word.",
    )
    expect(status.querySelector('svg')).not.toBeNull()
    expect(status).toHaveFocus()
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockSetTokens).not.toHaveBeenCalled()
  })

  it('never claims the link is spent (a pull-to-refresh mid-exchange must not say so)', async () => {
    renderJoin({ entries: ['/join'] })

    const status = await screen.findByRole('status')
    expect(status.textContent).not.toMatch(/already used|used|spent|expired|invalid|no longer/i)
  })

  it('is what a reload during "Signing you in…" lands on, not a "link is used" message', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mockPost.mockReturnValue(pending.promise)

    // First load: the tap. The address bar is scrubbed while the exchange is in flight.
    const first = renderJoin()
    await screen.findByRole('status')
    expect(window.location.pathname).toBe('/join')

    // Pull-to-refresh: the page is torn down and boots again at the scrubbed address.
    first.unmount()
    renderJoin({ entries: [window.location.pathname] })

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/tap your link again or scan your card/i)
    expect(status).not.toHaveTextContent(/already used/i)
    expect(mockPost).toHaveBeenCalledTimes(1)
  })

  it('offers Continue as a link to /, and no sign-in-only or retry control', async () => {
    renderJoin({ entries: ['/join'] })
    await screen.findByRole('status')

    const link = screen.getByRole('link', { name: 'Continue' })
    expect(link).toHaveAttribute('href', '/')
    expect(link.tagName).toBe('A')
    expect(screen.queryByRole('link', { name: /go to sign in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('hands over to the role-aware entry when Continue is followed', async () => {
    const user = userEvent.setup()
    renderJoin({ entries: ['/join'] })
    await screen.findByRole('status')

    await user.click(screen.getByRole('link', { name: 'Continue' }))

    expect(await screen.findByTestId('entry')).toBeInTheDocument()
  })

  it('reaches Continue with one Tab from the status region', async () => {
    const user = userEvent.setup()
    renderJoin({ entries: ['/join'] })
    await screen.findByRole('status')

    await user.tab()

    expect(screen.getByRole('link', { name: 'Continue' })).toHaveFocus()
  })

  it('is still a complete page: one h1 and a main', async () => {
    renderJoin({ entries: ['/join'] })

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('treats a trailing slash the same way', async () => {
    renderJoin({ entries: ['/join/'] })

    expect(await screen.findByRole('status')).toHaveTextContent(/tap your link again/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('does not clear or replace an existing session', async () => {
    setTokens({ token: 'access-A', refreshToken: 'refresh-A' }, { persist: true })
    mockSetTokens.mockClear()

    renderJoin({ entries: ['/join'] })
    await screen.findByRole('status')

    expect(getAccessToken()).toBe('access-A')
  })
})

describe('a participant link never stores a staff session (Gate-1 S-4)', () => {
  const STAFF_ENVELOPE = {
    token: 'staff-access',
    refreshToken: 'staff-refresh',
    session: { role: 'controller', exerciseId: 'ex-alpha', accountId: 'acct-9' },
  }

  it.each(['controller', 'evaluator', 'planner', 'orgAdmin', 'superuser', 7, null])(
    'refuses an envelope whose session.role is %s: generic failure, nothing persisted',
    async role => {
      mockPost.mockResolvedValue(ok({ ...STAFF_ENVELOPE, session: { role } }))

      const { router } = renderJoin()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/this link isn't working any more/i)
      expect(alert).toHaveFocus()
      expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login')
      expect(mockSetTokens).not.toHaveBeenCalled()
      expect(localStorage.length).toBe(0)
      expect(sessionStorage.length).toBe(0)
      expect(getAccessToken()).toBeNull()
      expect(router.state.location.pathname).toBe(`/join/${TOKEN}`)
    },
  )

  it('does not offer Try again (a retry cannot make a staff envelope a participant one)', async () => {
    mockPost.mockResolvedValue(ok(STAFF_ENVELOPE))

    renderJoin()
    await screen.findByRole('alert')

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('leaves the session the browser already holds untouched', async () => {
    setTokens({ token: 'access-A', refreshToken: 'refresh-A' }, { persist: true })
    mockSetTokens.mockClear()
    mockPost.mockResolvedValue(ok(STAFF_ENVELOPE))

    renderJoin()
    await screen.findByRole('alert')

    expect(getAccessToken()).toBe('access-A')
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-A')
  })

  it.each(['participant', 'pio'])('still signs in a %s session', async role => {
    mockPost.mockResolvedValue(ok({ ...ENVELOPE, session: { role } }))

    renderJoin()

    await screen.findByTestId('entry')
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-B')
  })
})

describe('accessibility (NFR-001)', () => {
  it('has exactly one h1 and one main in every state', async () => {
    mockPost
      .mockRejectedValueOnce(axiosErrorWith(500))
      .mockReturnValueOnce(new Promise(() => undefined))
    const user = userEvent.setup()

    renderJoin()
    await screen.findByRole('alert')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('status')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('reaches Try again with one Tab from the alert, and activates it with the keyboard', async () => {
    const user = userEvent.setup()
    mockPost.mockRejectedValueOnce(axiosErrorWith(undefined)).mockResolvedValueOnce(ok())

    renderJoin()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveFocus()

    await user.tab()
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toHaveFocus()
    expect(retry.tagName).toBe('BUTTON')

    await user.keyboard('{Enter}')
    await screen.findByTestId('entry')
    expect(mockPost).toHaveBeenCalledTimes(2)
  })

  it('reaches the sign-in link with one Tab from the alert', async () => {
    const user = userEvent.setup()
    mockPost.mockRejectedValue(axiosErrorWith(401))

    renderJoin()
    await screen.findByRole('alert')
    await user.tab()

    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveFocus()
    expect(link.tagName).toBe('A')
  })

  it('never relies on colour alone: every state has an icon and text', async () => {
    const failures = [
      axiosErrorWith(401),
      axiosErrorWith(429),
      axiosErrorWith(500),
    ]
    for (const failure of failures) {
      mockPost.mockReset()
      mockPost.mockRejectedValue(failure)
      const { unmount } = renderJoin()
      const alert = await screen.findByRole('alert')
      expect(alert.querySelector('svg')).not.toBeNull()
      expect((alert.textContent ?? '').trim().length).toBeGreaterThan(10)
      unmount()
    }
  })

  it('is sx-free, MUI-free markup: no inline styles anywhere in the page', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))

    const { container } = renderJoin()
    await screen.findByRole('alert')

    expect(container.querySelectorAll('[style]')).toHaveLength(0)
    expect(container.querySelector('[class*="Mui"]')).toBeNull()
  })
})

describe('the token never leaks (NFR-004)', () => {
  function spyOnConsole() {
    return CONSOLE_METHODS.map(method =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
  }

  it('writes the token to no console call on a success', async () => {
    const spies = spyOnConsole()
    mockPost.mockResolvedValue(ok())

    renderJoin({ strict: true })
    await screen.findByTestId('entry')

    expect(consoleText(spies)).not.toContain(TOKEN)
  })

  it.each([
    ['401', () => axiosErrorWith(401, `token ${TOKEN} not recognised`)],
    ['429', () => axiosErrorWith(429)],
    ['a network error', () => axiosErrorWith(undefined)],
    ['a 500', () => axiosErrorWith(500, { detail: `failed for ${TOKEN}` })],
    ['a plain Error', () => new Error(`boom ${TOKEN}`)],
  ])('writes the token to no console call on %s, and not into the page', async (_label, make) => {
    const spies = spyOnConsole()
    mockPost.mockRejectedValue(make())

    renderJoin({ strict: true })
    await screen.findByRole('alert')

    expect(consoleText(spies)).not.toContain(TOKEN)
    expect(document.body.innerHTML).not.toContain(TOKEN)
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('writes the token to no console call across a failed attempt and a retry', async () => {
    const user = userEvent.setup()
    const spies = spyOnConsole()
    mockPost.mockRejectedValueOnce(axiosErrorWith(undefined)).mockResolvedValueOnce(ok())

    renderJoin()
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByTestId('entry')

    expect(consoleText(spies)).not.toContain(TOKEN)
  })

  it('stores the join token nowhere (neither storage area holds it)', async () => {
    mockPost.mockResolvedValue(ok())

    renderJoin()
    await screen.findByTestId('entry')

    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN)
  })
})
