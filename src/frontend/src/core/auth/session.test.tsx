/**
 * core/auth/session.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the SessionProvider + useSession seam (COR-012), mirroring
 * exerciseContext.test.tsx:
 *   - useSession() outside a provider throws (fail-closed);
 *   - inside a provider it exposes exactly one bound session;
 *   - a pending resolution renders nothing (no default session leaks);
 *   - a FAILED resolution redirects to the login entry (feature: login, story
 *     01) — still fail-closed for content (no descendant mounts), now visible
 *     instead of a blank render;
 *   - a FAILED resolution's console signal never leaks a raw bearer token,
 *     even when the rejection itself carries one (AC6 / WR-001 — a failed
 *     silent refresh propagates an AxiosError whose `config.headers` carries
 *     `Authorization: Bearer <token>`, and `AxiosError` is
 *     console/`toJSON()`-inspectable);
 *   - useRole() reads the role off that same bound session.
 *
 * `resolveSession()` is mocked at the module boundary so these exercise the
 * provider's state machine, not the resolver's validation (that lives in
 * sessionResolver.test.ts). The redirect case wraps the provider in a
 * `MemoryRouter` (mirroring `RoleAwareEntry.test.tsx`'s own pattern) since
 * `<Navigate>` needs a router ancestor to render.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionProvider, useSession } from './session'
import { useRole } from './roles'
import { resolveSession, type Session } from './sessionResolver'

vi.mock('./sessionResolver', () => ({
  resolveSession: vi.fn(),
}))

const mockResolve = vi.mocked(resolveSession)

const FIXTURE: Session = {
  exerciseId: 'ex-test-0001',
  accountId: 'acct-test',
  role: 'pio',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function Probe() {
  const session = useSession()
  const role = useRole()
  return (
    <div data-testid="probe">
      <span data-testid="exerciseId">{session.exerciseId}</span>
      <span data-testid="accountId">{session.accountId}</span>
      <span data-testid="role">{role}</span>
    </div>
  )
}

describe('useSession outside a provider', () => {
  it('throws rather than returning a default session', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/SessionProvider/)
    consoleSpy.mockRestore()
  })
})

describe('SessionProvider', () => {
  beforeEach(() => {
    mockResolve.mockReset()
  })

  it('exposes exactly one bound session, and useRole reads its role', async () => {
    mockResolve.mockResolvedValue(FIXTURE)

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    expect(screen.getByTestId('exerciseId')).toHaveTextContent(FIXTURE.exerciseId)
    expect(screen.getByTestId('accountId')).toHaveTextContent(FIXTURE.accountId)
    expect(screen.getByTestId('role')).toHaveTextContent('pio')
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while resolution is pending (no default session in the interim)', () => {
    mockResolve.mockReturnValue(new Promise<Session>(() => {}))

    const { container } = render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })

  it('fails closed — redirects to the login entry — when resolution rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolve.mockRejectedValue(new Error('mock resolution failed'))

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <SessionProvider>
                <Probe />
              </SessionProvider>
            }
          />
          <Route path="/login" element={<div data-testid="login-sentinel" />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())

    // The failure is VISIBLE (a redirect), not a blank render. Awaited with
    // `findBy`, NOT a one-shot `getBy`: `consoleSpy` being called and the
    // `<Navigate>` having COMMITTED are two different moments, and the
    // `waitFor` above only gates the first. Under full-suite load React had not
    // yet flushed the redirect render, so the one-shot query saw an empty body
    // and this test failed while passing in isolation.
    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    // Fail-closed for CONTENT: no descendant of SessionProvider ever mounts —
    // asserted at the SETTLED post-redirect state, where it is a real claim
    // rather than a query against a DOM that has not rendered anything yet.
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('never logs a raw bearer token, even when the rejection carries one (AC6 / WR-001)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secretToken = 'super-secret-bearer-token-xyz'

    // An AxiosError-shaped rejection: exactly what a failed silent refresh
    // (core/services/api.ts) propagates once the request interceptor has
    // attached a stored token — `config.headers.Authorization` carries it,
    // and it's reachable both by direct property access AND via `toJSON()`
    // (some console-capturing reporters call it).
    class FakeAxiosLikeError extends Error {
      readonly isAxiosError = true
      readonly config: { headers: { Authorization: string } }
      constructor(message: string, token: string) {
        super(message)
        this.config = { headers: { Authorization: `Bearer ${token}` } }
      }
      toJSON() {
        return { message: this.message, config: this.config }
      }
    }
    const rejection = new FakeAxiosLikeError('Request failed with status code 401', secretToken)
    mockResolve.mockRejectedValue(rejection)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <SessionProvider>
                <Probe />
              </SessionProvider>
            }
          />
          <Route path="/login" element={<div data-testid="login-sentinel" />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    // `findBy`, not `getBy` — same race as the test above: the spy fires before
    // the redirect commits.
    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()

    // Inspect EVERYTHING console.error was actually called with — never the
    // raw token, and never the string "Bearer " (the header prefix).
    const loggedText = consoleSpy.mock.calls
      .flat()
      .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ')

    expect(loggedText).not.toContain(secretToken)
    expect(loggedText).not.toContain('Bearer')

    consoleSpy.mockRestore()
  })
})
