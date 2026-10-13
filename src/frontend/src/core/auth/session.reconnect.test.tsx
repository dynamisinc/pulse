/**
 * core/auth/session.reconnect.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W-5 (the long-tracked M-4): a failed session resolution at page load
 * must not bounce a participant who still has a valid stored pair to `/login`.
 *
 * `SessionProvider`'s rule, exercised here with `resolveSession()` mocked at the module
 * boundary and the REAL token store behind it (so "is a pair still stored" is the genuine
 * answer the provider reads):
 *   - no stored token                           -> `/login` (a refusal clears the store);
 *   - a pair is stored, and no answer came      -> "Reconnecting...", NOT `/login`;
 *   - a pair is stored, and the server says 403 -> `/login` (a real refusal);
 *   - Try again re-runs the resolution; if it then succeeds the app mounts, if it finds the
 *     pair gone it redirects, if it fails again the screen stays and says so.
 *
 * The end-to-end path through the real axios client (a refresh that gets no answer, a
 * refresh that is refused, the cool-down) is in `session.reconnect.integration.test.tsx`.
 * `session.test.tsx` keeps covering the provider's original contract and stays green.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { SessionProvider, useSession } from './session'
import { resolveSession, type Session } from './sessionResolver'
import { SessionExpiredError } from './sessionExpiredError'
import { clearTokens, setTokens } from './tokenStore'

vi.mock('./sessionResolver', () => ({
  resolveSession: vi.fn(),
}))

const mockResolve = vi.mocked(resolveSession)

const FIXTURE: Session = {
  exerciseId: 'ex-test-0001',
  accountId: 'acct-test',
  role: 'participant',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function Probe() {
  return <div data-testid="probe">{useSession().accountId}</div>
}

/** What `api.ts` rejects `resolveSession()` with when its refresh got no answer: the 401. */
function original401(): AxiosError {
  return new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', undefined, null, {
    status: 401, statusText: 'Unauthorized', headers: {}, config: {} as never, data: {},
  } as never)
}

function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK)
}

function forbidden403(): AxiosError {
  return new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', undefined, null, {
    status: 403, statusText: 'Forbidden', headers: {}, config: {} as never, data: {},
  } as never)
}

function renderProvider() {
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

/** A participant with a valid stored pair. */
function signedInParticipant() {
  setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })
}

let consoleSpy: MockInstance<typeof console.error>

beforeEach(() => {
  mockResolve.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  clearTokens()
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleSpy.mockRestore()
  clearTokens()
})

describe('a pair is stored and the server was not reached: Reconnecting, not /login', () => {
  it.each([
    ['the original 401 a no-answer refresh leaves behind', original401],
    ['a plain network error', networkError],
    ['a generic failure', () => new Error('timeout of 20000ms exceeded')],
  ])('%s', async (_label, makeError) => {
    signedInParticipant()
    mockResolve.mockRejectedValue(makeError())

    renderProvider()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    // Fail-closed for content: nothing below the provider mounted.
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
    // And the pair is untouched: the person is still signed in.
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-1')
    expect(localStorage.getItem('pulse.auth.refreshToken')).toBe('refresh-1')
  })

  it('says what is happening in words, and that the person is still signed in', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/couldn't be reached/i)
    expect(status).toHaveTextContent(/still signed in/i)
    // Icon plus text, never colour alone.
    expect(status.querySelector('svg')).not.toBeNull()
  })

  it('offers a way out: "Sign in again" is a real link to /login', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    const link = await screen.findByRole('link', { name: 'Sign in again' })
    expect(link).toHaveAttribute('href', '/login')
  })

  it('is accessible: one h1, one main, the status region takes focus when it appears', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    await screen.findByRole('heading', { name: 'Reconnecting…' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveFocus()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders nothing while the first attempt is still in flight', () => {
    signedInParticipant()
    mockResolve.mockReturnValue(new Promise<Session>(() => {}))

    const { container } = renderProvider()

    expect(container).toBeEmptyDOMElement()
  })
})

describe('no pair, or a real refusal: /login', () => {
  it('no stored token and the original 401 -> /login (a refused refresh clears the store first)', async () => {
    mockResolve.mockRejectedValue(original401())

    renderProvider()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
  })

  it('no stored token and any other failure -> /login', async () => {
    mockResolve.mockRejectedValue(new Error('mock resolution failed'))

    renderProvider()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
  })

  it('a pair is stored but the server answers 403 -> /login (a refusal retrying cannot fix)', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(forbidden403())

    renderProvider()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
  })

  it('a staff tab whose refresh was refused is a /login, even with a participant pair next door (W-6)', async () => {
    // Staff pair in sessionStorage, a participant's in localStorage; the refresh was refused,
    // so the page's store was cleared. Without the sticky store this page would still "have
    // a token" (the participant's) and sit on Reconnecting for ever.
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    localStorage.setItem('pulse.auth.token', 'p-access')
    localStorage.setItem('pulse.auth.refreshToken', 'p-refresh')
    localStorage.setItem('pulse.auth.session', 'participant-marker')
    const { clearActiveTokens } = await import('./tokenStore')
    clearActiveTokens() // what a refused refresh does
    mockResolve.mockRejectedValue(original401())

    renderProvider()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
  })
})

describe('an expired session is a refusal; a malformed body is not (W2-2)', () => {
  it('a pair is stored and the server confirms the session is EXPIRED -> /login, not Reconnecting', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(new SessionExpiredError())

    renderProvider()

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })

  it('a pair is stored and the body is MALFORMED (a captive portal\'s HTML) -> Reconnecting', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(
      new Error('resolveSession: resolution returned an empty or malformed session'),
    )

    renderProvider()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-1')
  })

  it('a retry that learns the session is expired ends at /login', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    mockResolve.mockRejectedValueOnce(new SessionExpiredError())

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
  })
})

describe('"Sign in again" leads to the sign-in for THIS kind of session (S2-1)', () => {
  it('a staff tab (sessionStorage) goes to the STAFF sign-in', async () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' })
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    expect(await screen.findByRole('link', { name: 'Sign in again' }))
      .toHaveAttribute('href', '/staff/login')
  })

  it('a participant (localStorage) goes to the participant sign-in', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    expect(await screen.findByRole('link', { name: 'Sign in again' }))
      .toHaveAttribute('href', '/login')
  })
})

describe('Try again', () => {
  it('re-runs the resolution and, on success, mounts the app', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    mockResolve.mockResolvedValueOnce(FIXTURE)

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('probe')).toHaveTextContent(FIXTURE.accountId)
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })

  it('shows "Trying to reach Pulse…" while in flight, keeps focus on the button, ignores a second press', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    let finish: (value: Session) => void = () => undefined
    mockResolve.mockReturnValueOnce(new Promise<Session>(resolve => { finish = resolve }))

    renderProvider()
    const button = await screen.findByRole('button', { name: 'Try again' })
    await user.click(button)

    expect(screen.getByRole('status')).toHaveTextContent('Trying to reach Pulse…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // `aria-disabled`, not `disabled`: the focus stays where the person put it.
    expect(button).toBeEnabled()
    expect(button).toHaveFocus()
    await user.click(button)
    expect(mockResolve).toHaveBeenCalledTimes(2) // the second press sent nothing

    finish(FIXTURE)
    expect(await screen.findByTestId('probe')).toBeInTheDocument()
  })

  it('a retry that fails again stays on the screen and says so, ready for another try', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()
    const button = await screen.findByRole('button', { name: 'Try again' })
    await user.click(button)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/still can't reach pulse/i))
    expect(screen.getByRole('status')).toHaveTextContent(/still signed in/i)
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(button).toHaveFocus()
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    expect(mockResolve).toHaveBeenCalledTimes(2)

    await user.click(button)
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(3))
  })

  it('a retry that finds the pair REFUSED (cleared) ends at /login', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    mockResolve.mockImplementationOnce(() => {
      // What the axios client does when the retried refresh is refused: clear, then reject 401.
      clearTokens()
      return Promise.reject(original401())
    })

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
  })

  it('does not apply a result that arrives after the provider unmounted', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    let finish: (value: Session) => void = () => undefined
    mockResolve.mockReturnValueOnce(new Promise<Session>(resolve => { finish = resolve }))

    const { unmount } = renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    unmount()

    expect(() => finish(FIXTURE)).not.toThrow()
  })
})

describe('the console signal never leaks a token on the new path either (AC6)', () => {
  it('logs only a redacted message when staying connected', async () => {
    signedInParticipant()
    const secret = 'super-secret-bearer-token-xyz'
    class FakeAxiosLikeError extends Error {
      readonly isAxiosError = true
      readonly config = { headers: { Authorization: `Bearer ${secret}` } }
      toJSON() {
        return { message: this.message, config: this.config }
      }
    }
    mockResolve.mockRejectedValue(new FakeAxiosLikeError('Request failed with status code 401'))

    renderProvider()
    await screen.findByRole('heading', { name: 'Reconnecting…' })

    const logged = consoleSpy.mock.calls
      .flat()
      .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ')
    expect(consoleSpy).toHaveBeenCalled()
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain('Bearer')
  })
})
