/**
 * core/auth/session.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the SessionProvider + useSession seam (COR-012), mirroring
 * exerciseContext.test.tsx:
 *   - useSession() outside a provider throws (fail-closed);
 *   - inside a provider it exposes exactly one bound session;
 *   - a pending/failed resolution renders nothing (no default session leaks);
 *   - useRole() reads the role off that same bound session.
 *
 * `resolveSession()` is mocked at the module boundary so these exercise the
 * provider's state machine, not the resolver's validation (that lives in
 * sessionResolver.test.ts).
 */
import { render, screen, waitFor } from '@testing-library/react'
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

  it('fails closed — renders nothing — when resolution rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolve.mockRejectedValue(new Error('mock resolution failed'))

    const { container } = render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})
