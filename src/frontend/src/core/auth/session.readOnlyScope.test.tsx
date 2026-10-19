/**
 * core/auth/session.readOnlyScope.test.tsx
 * ---------------------------------------------------------------------------
 * `ReadOnlySessionScope` (demo-polish C6): the surrounding session, narrowed to a
 * read-only observer (COR-015) for its subtree -- and nothing else. It fails closed
 * outside a `SessionProvider`, never touches the session outside its subtree, keeps
 * every identity field, and hands consumers a stable object across re-renders.
 *
 * `resolveSession()` is mocked at the module boundary, as in `session.test.tsx`.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadOnlySessionScope, SessionProvider, useOptionalSession, useSession } from './session'
import { resolveSession, type Session } from './sessionResolver'

vi.mock('./sessionResolver', () => ({
  resolveSession: vi.fn(),
}))

const FIXTURE: Session = {
  exerciseId: 'ex-test-0001',
  scope: 'exercise',
  personId: null,
  world: 'staff',
  isLead: false,
  accountId: 'acct-test',
  role: 'controller',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function Probe({ id }: { id: string }) {
  const session = useSession()
  return (
    <dl data-testid={id}>
      <dd data-testid={`${id}-readonly`}>{String(session.isReadOnly)}</dd>
      <dd data-testid={`${id}-persona`}>{session.personaId ?? 'none'}</dd>
      <dd data-testid={`${id}-account`}>{session.accountId}</dd>
      <dd data-testid={`${id}-exercise`}>{session.exerciseId}</dd>
      <dd data-testid={`${id}-role`}>{session.role}</dd>
      <dd data-testid={`${id}-human`}>{session.actingHumanId}</dd>
      <dd data-testid={`${id}-expires`}>{session.expiresAt}</dd>
    </dl>
  )
}

beforeEach(() => {
  vi.mocked(resolveSession).mockReset()
  vi.mocked(resolveSession).mockResolvedValue(FIXTURE)
})

describe('ReadOnlySessionScope', () => {
  it('fails closed outside a SessionProvider (there is no default session to narrow)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(
      <ReadOnlySessionScope>
        <Probe id="inside" />
      </ReadOnlySessionScope>,
    )).toThrow(/SessionProvider/)
    consoleSpy.mockRestore()
  })

  it('narrows the subtree to a read-only observer with no persona', async () => {
    render(
      <SessionProvider>
        <ReadOnlySessionScope>
          <Probe id="inside" />
        </ReadOnlySessionScope>
      </SessionProvider>,
    )

    expect(await screen.findByTestId('inside-readonly')).toHaveTextContent('true')
    expect(screen.getByTestId('inside-persona')).toHaveTextContent('none')
  })

  it('keeps every identity field of the surrounding session -- narrowed, not replaced', async () => {
    render(
      <SessionProvider>
        <ReadOnlySessionScope>
          <Probe id="inside" />
        </ReadOnlySessionScope>
      </SessionProvider>,
    )

    expect(await screen.findByTestId('inside-account')).toHaveTextContent(FIXTURE.accountId)
    expect(screen.getByTestId('inside-exercise')).toHaveTextContent(FIXTURE.exerciseId)
    expect(screen.getByTestId('inside-role')).toHaveTextContent(FIXTURE.role)
    expect(screen.getByTestId('inside-human')).toHaveTextContent(FIXTURE.actingHumanId)
    expect(screen.getByTestId('inside-expires')).toHaveTextContent(FIXTURE.expiresAt)
  })

  it('leaves the session OUTSIDE its subtree untouched', async () => {
    render(
      <SessionProvider>
        <Probe id="outside" />
        <ReadOnlySessionScope>
          <Probe id="inside" />
        </ReadOnlySessionScope>
      </SessionProvider>,
    )

    expect(await screen.findByTestId('outside-readonly')).toHaveTextContent('false')
    expect(screen.getByTestId('outside-persona')).toHaveTextContent('persona-test')
    expect(screen.getByTestId('inside-readonly')).toHaveTextContent('true')
  })

  it('hands consumers the SAME object across re-renders of the scope', async () => {
    const seen: Session[] = []
    function Capture() {
      seen.push(useSession())
      return null
    }
    // A fresh element tree each time, so React really re-renders the scope and the consumer.
    const make = () => (
      <SessionProvider>
        <ReadOnlySessionScope>
          <Capture />
        </ReadOnlySessionScope>
      </SessionProvider>
    )
    const view = render(make())
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const afterFirst = seen.length
    view.rerender(make())
    view.rerender(make())

    expect(seen.length).toBeGreaterThan(afterFirst)
    expect(new Set(seen).size).toBe(1)
  })
})

describe('useOptionalSession (the non-throwing twin of useSession)', () => {
  function OptionalProbe() {
    const session = useOptionalSession()
    return <output data-testid="optional">{session === undefined ? 'no session' : session.role}</output>
  }

  it('returns undefined, and does NOT throw, outside a SessionProvider', () => {
    render(<OptionalProbe />)

    expect(screen.getByTestId('optional')).toHaveTextContent('no session')
  })

  it('returns the bound session inside a SessionProvider', async () => {
    render(
      <SessionProvider>
        <OptionalProbe />
      </SessionProvider>,
    )

    expect(await screen.findByTestId('optional')).toHaveTextContent(FIXTURE.role)
  })

  it('sees the read-only narrowing inside a ReadOnlySessionScope, like useSession does', async () => {
    function NarrowedProbe() {
      return <output data-testid="narrowed">{String(useOptionalSession()?.isReadOnly)}</output>
    }
    render(
      <SessionProvider>
        <ReadOnlySessionScope>
          <NarrowedProbe />
        </ReadOnlySessionScope>
      </SessionProvider>,
    )

    expect(await screen.findByTestId('narrowed')).toHaveTextContent('true')
  })
})
