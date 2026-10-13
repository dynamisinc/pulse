/**
 * core/exerciseContext/exerciseContext.reconnect.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W2-3: the FIRST request at page load (`GET /exercise-context`) gets the
 * same treatment `SessionProvider` got in W-5. When a pair is stored and the mount resolution
 * gets no definite answer, the provider shows the neutral "Reconnecting..." screen with Try
 * again, not the dead-end "Session unavailable" notice. A real refusal (403), "not found"
 * (404) and a missing token keep today's behaviour, and a failed REFRESH after a staff switch
 * still fails closed to the notice.
 *
 * `resolveExerciseContext()` is mocked at the module boundary (as `exerciseContext.test.tsx`
 * does) with the REAL token store behind it. The same screen end to end through the real route
 * stack is in `features/app-shell/reconnectComposition.test.tsx`.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError } from 'axios'
import { act, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { clearTokens, setTokens } from '../auth/tokenStore'
import {
  ExerciseContextProvider,
  useExerciseContext,
  useExerciseScopeRefresh,
} from './exerciseContext'
import { resolveExerciseContext, type ExerciseScope } from './exerciseContextResolver'

vi.mock('./exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockResolve = vi.mocked(resolveExerciseContext)

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-test-0001',
  exerciseName: 'Test Exercise',
  timeZone: 'America/Chicago',
  status: 'live',
}

function Probe() {
  return <div data-testid="probe">{useExerciseContext().exerciseId}</div>
}

const refreshHolder: { current: () => Promise<ExerciseScope> } = {
  current: () => Promise.reject(new Error('unset')),
}
function RefreshProbe() {
  const refresh = useExerciseScopeRefresh()
  useEffect(() => {
    refreshHolder.current = refresh
  }, [refresh])
  return null
}

function statusError(status: number): AxiosError {
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', undefined, null, {
    status, statusText: '', headers: {}, config: {} as never, data: {},
  } as never)
}

const networkError = () => new AxiosError('Network Error', AxiosError.ERR_NETWORK)

function renderProvider() {
  return render(
    <MemoryRouter>
      <ExerciseContextProvider>
        <Probe />
        <RefreshProbe />
      </ExerciseContextProvider>
    </MemoryRouter>,
  )
}

const signedInParticipant = () =>
  setTokens({ token: 'access-1', refreshToken: 'refresh-1' }, { persist: true })

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

describe('a pair is stored and the first request got no definite answer: Reconnecting', () => {
  it.each([
    ['no response at all (offline, timeout)', networkError],
    ['a 502 from a gateway', () => statusError(502)],
    ['a 503', () => statusError(503)],
    ['a 429', () => statusError(429)],
    ['the original 401 a no-answer refresh leaves behind', () => statusError(401)],
    ['a malformed body (a captive portal\'s HTML page)', () => new Error('empty or malformed scope')],
  ])('%s', async (_label, makeError) => {
    signedInParticipant()
    mockResolve.mockRejectedValue(makeError())

    renderProvider()

    expect(await screen.findByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-scope-unavailable')).not.toBeInTheDocument()
    // Fail-closed for content: no child mounted, no scope exposed.
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
    // The pair is untouched.
    expect(localStorage.getItem('pulse.auth.token')).toBe('access-1')
  })

  it('carries no exercise identity on the screen', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    const screenText = (await screen.findByRole('main')).textContent ?? ''
    expect(screenText).not.toMatch(/ex-|exercise name/i)
  })

  it('Try again re-runs the resolution and, on success, mounts the app', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    mockResolve.mockResolvedValueOnce(SCOPE)

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('probe')).toHaveTextContent(SCOPE.exerciseId)
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })

  it('a retry that fails again stays on the screen and says so', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/still can't reach pulse/i))
    expect(screen.queryByTestId('exercise-scope-unavailable')).not.toBeInTheDocument()
  })

  it('a retry that meets a definite refusal lands on the notice', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    mockResolve.mockRejectedValueOnce(statusError(403))

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
  })

  it('a retry that finds the pair gone (a refused refresh cleared it) lands on the notice', async () => {
    const user = userEvent.setup()
    signedInParticipant()
    mockResolve.mockRejectedValueOnce(networkError())
    mockResolve.mockImplementationOnce(() => {
      clearTokens()
      return Promise.reject(statusError(401))
    })

    renderProvider()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
  })
})

describe('definite answers and signed-out pages keep today\'s behaviour', () => {
  it.each([
    ['a 403: the server refuses this account', () => statusError(403)],
    ['a 404: no such exercise for this host', () => statusError(404)],
  ])('with a pair stored, %s -> the notice', async (_label, makeError) => {
    signedInParticipant()
    mockResolve.mockRejectedValue(makeError())

    renderProvider()

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })

  it.each([
    ['no response', networkError],
    ['a 401', () => statusError(401)],
    ['a 404', () => statusError(404)],
  ])('with NO stored token, %s -> the notice (nothing to be reconnecting as)', async (_label, make) => {
    mockResolve.mockRejectedValue(make())

    renderProvider()

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
  })

  it('a failed REFRESH after a switch still fails closed to the notice, even with a pair', async () => {
    signedInParticipant()
    mockResolve.mockResolvedValueOnce(SCOPE)
    renderProvider()
    expect(await screen.findByTestId('probe')).toBeInTheDocument()

    mockResolve.mockRejectedValueOnce(networkError())
    await act(async () => {
      await refreshHolder.current().catch(() => {})
    })

    expect(await screen.findByTestId('exercise-scope-unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })
})

describe('the sign-in link follows the kind of session (S2-1)', () => {
  it('a staff tab signs in again at the STAFF sign-in', async () => {
    setTokens({ token: 'staff-access', refreshToken: 'staff-refresh' }) // sessionStorage
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    expect(await screen.findByRole('link', { name: 'Sign in again' }))
      .toHaveAttribute('href', '/staff/login')
  })

  it('a participant signs in again at the participant sign-in', async () => {
    signedInParticipant()
    mockResolve.mockRejectedValue(networkError())

    renderProvider()

    expect(await screen.findByRole('link', { name: 'Sign in again' }))
      .toHaveAttribute('href', '/login')
  })
})

describe('the console signal never leaks a token (AC6, as SessionProvider)', () => {
  it('logs only a redacted message, not the AxiosError that holds the bearer', async () => {
    signedInParticipant()
    const secret = 'super-secret-bearer-token-xyz'
    const error = new AxiosError('Network Error', AxiosError.ERR_NETWORK, {
      headers: { Authorization: `Bearer ${secret}` },
    } as never)
    mockResolve.mockRejectedValue(error)

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
