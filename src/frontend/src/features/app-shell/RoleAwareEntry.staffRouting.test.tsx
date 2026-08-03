/**
 * features/app-shell/RoleAwareEntry.staffRouting.test.tsx
 * ---------------------------------------------------------------------------
 * The routing behaviour of the role-aware entry ONCE STAFF SURFACES BECAME REAL
 * URLs — and, above all, the COR-004 regression guard that says participants
 * did not.
 *
 * ## The one test that matters most
 * `COR-004 — a participant is completely location-blind`: a participant session
 * at `/staff/console`, `/staff/plan`, `/staff/evaluate`, a bare `/staff`, a
 * nonsense path, or `/` renders the PARTICIPANT surface, renders no staff
 * surface, does not redirect, and does not even canonicalise the URL. If a
 * future refactor flattens the catch-all into a route table, or teaches the
 * participant branch to read the URL "just for a redirect", this fails.
 *
 * The companion `participantLocationBlindness.test.ts` enforces the same
 * property STRUCTURALLY (the participant render path imports no location API),
 * so the guarantee survives even a behavioural test that gets weakened.
 *
 * Identity seams are mocked at the hook boundary exactly as in
 * `RoleAwareEntry.test.tsx`; the pure role/expiry predicates stay REAL.
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { faClipboardCheck, faGear, faSliders } from '@fortawesome/free-solid-svg-icons'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { ExerciseRole, Session } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { RoleAwareEntry, type RoleAwareEntryProps } from './RoleAwareEntry'
import type { StaffRouteRegistry } from './staffRouting'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, useSession: vi.fn(), useRole: vi.fn() }
})
vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: vi.fn() }
})

const StubGuard: ComponentType<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="participant-guard">{children}</div>
)

/** Mirrors the shipped registry's ids/paths/roles with inert elements. */
const STAFF_ROUTES: StaffRouteRegistry = [
  {
    id: 'planner-workspace',
    path: '/staff/plan',
    label: 'Exercise Settings',
    icon: faGear,
    element: <div data-testid="staff-surface-planner" />,
    allowedRoles: ['planner'],
    isDefaultFor: ['planner'],
    group: 'plan',
  },
  {
    id: 'controller-console',
    path: '/staff/console',
    label: 'Controller Console',
    icon: faSliders,
    element: <div data-testid="staff-surface-controller" />,
    allowedRoles: ['controller'],
    isDefaultFor: ['controller'],
    group: 'conduct',
  },
  {
    id: 'evaluator-dashboard',
    path: '/staff/evaluate',
    label: 'Evaluator Dashboard',
    icon: faClipboardCheck,
    element: <div data-testid="staff-surface-evaluator" />,
    allowedRoles: ['evaluator'],
    isDefaultFor: ['evaluator'],
    group: 'evaluate',
  },
]

/** Every staff surface testid — asserted absent on every participant case. */
const ALL_STAFF_SURFACE_TESTIDS = [
  'staff-surface-planner',
  'staff-surface-controller',
  'staff-surface-evaluator',
]

const BASE_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-test',
  role: 'participant',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-mock-0001',
  exerciseName: 'Mock Exercise',
  timeZone: 'UTC',
  status: 'active',
}

function primeSession(role: ExerciseRole, overrides: Partial<Session> = {}) {
  const session: Session = { ...BASE_SESSION, role, ...overrides }
  vi.mocked(useSession).mockReturnValue(session)
  vi.mocked(useRole).mockReturnValue(session.role)
  vi.mocked(useExerciseContext).mockReturnValue(SCOPE)
}

/** Reports the router's live pathname so a redirect (or its absence) is visible. */
function LocationProbe() {
  return <div data-testid="pathname">{useLocation().pathname}</div>
}

function renderAt(initialEntry: string, props: Partial<RoleAwareEntryProps> = {}) {
  const merged: RoleAwareEntryProps = {
    participantSurface: <div data-testid="participant-surface" />,
    staffRoutes: STAFF_ROUTES,
    participantGuard: StubGuard,
    staffSwitcher: <div data-testid="exercise-switcher" />,
    ...props,
  }
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/login"
          element={<div data-testid="login-sentinel" />}
        />
        {/* The real shape: ONE splat catch-all, never a flat staff route table. */}
        <Route
          path="*"
          element={<RoleAwareEntry {...merged} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('COR-004 — a participant is completely location-blind', () => {
  const TYPED_PATHS = [
    '/',
    '/staff',
    '/staff/console',
    '/staff/plan',
    '/staff/evaluate',
    '/staff/anything-at-all',
    '/console',
    '/some/deep/participant/path',
  ]

  it.each(TYPED_PATHS)(
    'a participant typing %s still lands on the participant surface',
    path => {
      primeSession('participant')
      renderAt(path)

      expect(screen.getByTestId('participant-guard')).toBeInTheDocument()
      expect(screen.getByTestId('participant-surface')).toBeInTheDocument()

      for (const testId of ALL_STAFF_SURFACE_TESTIDS) {
        expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
      }
      expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
      expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()

      // Not even a canonicalising redirect: the participant branch never
      // consults or rewrites the URL.
      expect(screen.getByTestId('pathname')).toHaveTextContent(path)
    },
  )

  it.each(TYPED_PATHS)('a PIO typing %s still lands on the participant surface', path => {
    primeSession('pio')
    renderAt(path)

    expect(screen.getByTestId('participant-surface')).toBeInTheDocument()
    for (const testId of ALL_STAFF_SURFACE_TESTIDS) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
    }
    expect(screen.getByTestId('pathname')).toHaveTextContent(path)
  })
})

describe('staff deep links', () => {
  it('mounting at /staff/evaluate with an evaluator session renders the dashboard directly', () => {
    primeSession('evaluator')
    renderAt('/staff/evaluate')

    expect(screen.getByTestId('staff-surface-evaluator')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/evaluate')
    // The staff-only switcher rides above the tree, once, outside the routes.
    expect(screen.getByTestId('exercise-switcher')).toBeInTheDocument()
  })

  it('mounting at /staff/plan with a planner session renders the planner workspace directly', () => {
    primeSession('planner')
    renderAt('/staff/plan')

    expect(screen.getByTestId('staff-surface-planner')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/plan')
  })
})

describe('staff role gating — allowedRoles decides, not the URL', () => {
  it('a controller at /staff/plan does NOT get the planner surface', () => {
    primeSession('controller')
    renderAt('/staff/plan')

    expect(screen.queryByTestId('staff-surface-planner')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-surface-controller')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
  })

  it('an evaluator at /staff/console does NOT get the console surface', () => {
    primeSession('evaluator')
    renderAt('/staff/console')

    expect(screen.queryByTestId('staff-surface-controller')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-surface-evaluator')).toBeInTheDocument()
  })
})

describe('staff unknown paths land on the role default, not /login', () => {
  it.each([
    ['controller', 'staff-surface-controller', '/staff/console'],
    ['evaluator', 'staff-surface-evaluator', '/staff/evaluate'],
    ['planner', 'staff-surface-planner', '/staff/plan'],
  ] as const)('a %s at an unknown path lands on their default surface', (role, testId, path) => {
    primeSession(role)
    renderAt('/staff/no-such-surface')

    expect(screen.getByTestId(testId)).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent(path)
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
  })

  it('a bare /staff lands on the role default surface', () => {
    primeSession('controller')
    renderAt('/staff')

    expect(screen.getByTestId('staff-surface-controller')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
  })
})

describe('fail closed — unchanged by staff routing', () => {
  it('an EXPIRED staff session deep-linking to a staff surface still goes to /login', () => {
    primeSession('controller', { expiresAt: new Date(Date.now() - 1000).toISOString() })
    renderAt('/staff/console')

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('staff-surface-controller')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
  })

  it('an EXPIRED participant session at a staff path still goes to /login', () => {
    primeSession('participant', { expiresAt: new Date(Date.now() - 1000).toISOString() })
    renderAt('/staff/console')

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('participant-surface')).not.toBeInTheDocument()
  })

  it('an orgAdmin the REGISTRY has nothing for still goes to /login, not to someone else\'s surface', () => {
    // COR-076 made `orgAdmin` a routed role, so it now takes the staff-tree
    // branch — but this fixture registry declares no entry it may open, and the
    // fail-closed rule is unchanged for that case: no default surface, no
    // switcher, no COBRA, straight to the login entry. The old version of this
    // case asserted the same outcome for a different reason (`orgAdmin` was
    // rejected as an unsupported role one branch earlier); the shipped registry
    // DOES give it a surface, which `orgAdminSurfaceFamily.test.tsx` covers.
    primeSession('orgAdmin')
    renderAt('/staff/console')

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    for (const testId of ALL_STAFF_SURFACE_TESTIDS) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
    }
    expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
  })

  it('a staff role with NO reachable surface goes to /login with no COBRA chrome mounted', () => {
    primeSession('planner')
    renderAt('/staff/plan', { staffRoutes: STAFF_ROUTES.filter(r => r.id !== 'planner-workspace') })

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
  })
})
