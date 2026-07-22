/**
 * features/participant-shell/ParticipantLandingGuard.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (exercise-isolation, Phase B2 make-real) — coverage for the
 * participant landing route guard's fail-closed contract:
 *
 *  - a resolved participant/PIO session (matching session/scope exerciseId,
 *    not expired) renders `children` — the landing surface — with no
 *    exercise-picker/admin/status element reachable;
 *  - a staff role (controller/evaluator/planner) or `orgAdmin` fails closed —
 *    the participant fiction never renders, no staff surface renders either;
 *  - an "unresolved scope" (a session bound to one exercise, a host-resolved
 *    scope for a DIFFERENT one) fails closed — the precedence-model mismatch
 *    invariant (`identity-auth-roles/implementation.md`);
 *  - an already-expired session fails closed even when role/scope look fine;
 *  - a read-only session is admitted AND selects the `'all-posts'` landing
 *    (COR-015), never `'following'`.
 *
 * `useSession()`/`useRole()`/`useExerciseContext()` are mocked at the module
 * boundary (mirrors `controllerIdentity.test.tsx` / `usePauseState.test.tsx`)
 * so each test controls role/session/scope directly and deterministically.
 * `@/core/auth`'s pure helpers (`isParticipantRole`, `isSessionExpired`) are
 * the REAL implementations (via `importOriginal`) — only the two hooks are
 * mocked — so this exercises the guard's actual fail-closed logic, not a
 * stand-in for it. The guard renders `<Navigate>` on denial, so denial tests
 * wrap in a `MemoryRouter`.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseRole, Session } from '@/core/auth'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useRole, useSession } from '@/core/auth'
import { ParticipantLandingGuard } from './ParticipantLandingGuard'
import { useLandingSelection } from './landingSelection'

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return {
    ...actual,
    useSession: vi.fn(),
    useRole: vi.fn(),
  }
})

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockedUseSession = vi.mocked(useSession)
const mockedUseRole = vi.mocked(useRole)
const mockedUseExerciseContext = vi.mocked(useExerciseContext)

const EXERCISE_ID = 'ex-mock-0001'

function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    exerciseId: EXERCISE_ID,
    accountId: 'acct-dreyes',
    role: 'participant',
    personaId: 'persona-dreyes_fh',
    actingHumanId: 'human-dreyes',
    isReadOnly: false,
    // A fixed far-future instant (never expired at test-run time) rather than
    // a `Date.now()`-derived one — this file lives under
    // `features/participant-shell/**`, where COR-053's lint ban forbids bare
    // `new Date()`/`Date.now()` regardless of intent (see
    // `ParticipantLandingGuard.tsx`'s own comment on this).
    expiresAt: '2999-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function scopeFixture(overrides: Partial<ExerciseScope> = {}): ExerciseScope {
  return {
    exerciseId: EXERCISE_ID,
    exerciseName: 'Coastal Surge (Mock Exercise)',
    timeZone: 'America/New_York',
    status: 'active',
    ...overrides,
  }
}

/** The forbidden-content probe: renders exactly the surfaces XC-002 forbids on
 * a participant path, so a passing test proves the guard actually swaps this
 * content out — not merely that it doesn't ADD anything. */
function ForbiddenLandingSurface() {
  return (
    <div data-testid="landing-surface">
      <span data-testid="exercise-picker">exercise picker</span>
      <span data-testid="admin-surface">platform administration</span>
      <span data-testid="simulation-status">simulation status</span>
    </div>
  )
}

function setup(role: ExerciseRole, session: Session, scope: ExerciseScope) {
  mockedUseRole.mockReturnValue(role)
  mockedUseSession.mockReturnValue(session)
  mockedUseExerciseContext.mockReturnValue(scope)
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/shell']}>
      <ParticipantLandingGuard>
        <ForbiddenLandingSurface />
      </ParticipantLandingGuard>
    </MemoryRouter>,
  )
}

describe('ParticipantLandingGuard — admits a resolved participant/PIO session', () => {
  it('renders children (the landing surface) for a resolved participant session', () => {
    setup('participant', sessionFixture(), scopeFixture())

    renderGuard()

    expect(screen.getByTestId('landing-surface')).toBeInTheDocument()
  })

  it('renders children for a resolved PIO session too', () => {
    setup('pio', sessionFixture({ role: 'pio' }), scopeFixture())

    renderGuard()

    expect(screen.getByTestId('landing-surface')).toBeInTheDocument()
  })
})

describe('ParticipantLandingGuard — fail-closed', () => {
  it.each<ExerciseRole>(['controller', 'evaluator', 'planner'])(
    'denies a staff role (%s) — no participant content reaches the DOM',
    role => {
      setup(role, sessionFixture({ role }), scopeFixture())

      renderGuard()

      expect(screen.queryByTestId('landing-surface')).not.toBeInTheDocument()
      expect(screen.queryByTestId('exercise-picker')).not.toBeInTheDocument()
      expect(screen.queryByTestId('admin-surface')).not.toBeInTheDocument()
      expect(screen.queryByTestId('simulation-status')).not.toBeInTheDocument()
    },
  )

  it('denies orgAdmin — not a participant surface either', () => {
    setup('orgAdmin', sessionFixture({ role: 'orgAdmin' }), scopeFixture())

    renderGuard()

    expect(screen.queryByTestId('landing-surface')).not.toBeInTheDocument()
  })

  it('denies an unresolved scope — session bound to one exercise, host resolved a different one', () => {
    setup(
      'participant',
      sessionFixture({ exerciseId: 'ex-alpha' }),
      scopeFixture({ exerciseId: 'ex-bravo' }),
    )

    renderGuard()

    expect(screen.queryByTestId('landing-surface')).not.toBeInTheDocument()
  })

  it('denies an already-expired session, even with an otherwise-valid role and matching scope', () => {
    setup(
      'participant',
      sessionFixture({ expiresAt: '2000-01-01T00:00:00.000Z' }),
      scopeFixture(),
    )

    renderGuard()

    expect(screen.queryByTestId('landing-surface')).not.toBeInTheDocument()
  })
})

describe('ParticipantLandingGuard — read-only landing selection (COR-015)', () => {
  function SelectionProbe() {
    const selection = useLandingSelection()
    return <span data-testid="selection">{selection}</span>
  }

  it('a read-only session is admitted and selects all-posts, never following', () => {
    setup('participant', sessionFixture({ isReadOnly: true }), scopeFixture())

    render(
      <MemoryRouter>
        <ParticipantLandingGuard>
          <SelectionProbe />
        </ParticipantLandingGuard>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('selection')).toHaveTextContent('all-posts')
  })

  it('an ordinary (non-read-only) session selects following', () => {
    setup('participant', sessionFixture({ isReadOnly: false }), scopeFixture())

    render(
      <MemoryRouter>
        <ParticipantLandingGuard>
          <SelectionProbe />
        </ParticipantLandingGuard>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('selection')).toHaveTextContent('following')
  })
})
