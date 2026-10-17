/**
 * features/exerciseLifecycleAdmin/orgAdminSurfaceFamily.test.tsx
 * ---------------------------------------------------------------------------
 * COR-074/075/076 — the ROUTING half of the exercise-management surface, driven
 * through the REAL `RoleAwareEntry` over the REAL `STAFF_ROUTE_REGISTRY`.
 *
 * ## What is real here, and what is not (and why)
 * REAL: the registry table (ids, paths, `allowedRoles`, `isDefaultFor`), the
 * routing glue, `ExerciseManagementRoute` and everything it composes — the staff
 * shell frame, the real `StaffHeader`, the real page, the real hooks, the real
 * service seam short-circuited by its own mock adapter. Nothing about the
 * surface under test is stubbed, and the registry is INJECTED exactly the way
 * `App.tsx` injects it.
 *
 * STUBBED: `@/features/controller` and `@/features/evaluator`, whose route
 * compositions this file only ever needs as "some other surface rendered". They
 * drag in the engine cockpit, SignalR and the review queue; rendering them here
 * would test those features' module graphs, not this one's routing, and a
 * failure in either would land in this file looking like a routing bug. The
 * stubs keep the registry's own SHAPE untouched — same ids, same paths, same
 * roles — because the shape is what these cases are about.
 *
 * ## The three things this file exists to prove
 *  1. An `orgAdmin` session reaches a REAL surface. Until COR-076 it did not:
 *     `RoleAwareEntry`'s fallback arm matched every org-admin and redirected
 *     them to `/login`, so the role existed in the type system, in the session
 *     and in the API and had nowhere to land.
 *  2. A `controller` CAN reach `/staff/exercises` (DF-20, seam S-4) and an
 *     `evaluator` cannot — mirroring the server's gate rather than trusting it
 *     alone. The evaluator is told why on the not-allowed page (story 15)
 *     instead of being bounced silently.
 *  3. A PARTICIPANT typing `/staff/exercises` still lands on their participant
 *     surface. COR-004 is structural (`participantLocationBlindness.test.ts`),
 *     but every new staff path deserves the behavioural case too: the whole
 *     point is that adding staff URLs never adds a participant one.
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { ExerciseSession, SessionRole } from '@/core/auth'
import { withRole } from '@/core/auth/withRole.testUtils'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { RoleAwareEntry } from '@/features/app-shell'
import { STAFF_ROUTE_REGISTRY } from '@/features/staff'
import { resetOrgExerciseMocks } from './services/orgExercisesService'

vi.mock('@/features/controller', () => ({
  ControllerConsoleRoute: () => <div data-testid="stub-controller-console" />,
}))
vi.mock('@/features/evaluator', () => ({
  EvaluatorDashboardRoute: () => <div data-testid="stub-evaluator-dashboard" />,
}))

// Session resolution is the ONE thing that cannot be driven from the outside in
// a unit test — there is no login to perform. Everything downstream of the
// resolved role stays real. Same seam as `RoleAwareEntry.staffRouting.test.tsx`.
vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, useSession: vi.fn(), useRole: vi.fn() }
})

const BASE_SESSION: ExerciseSession = {
  exerciseId: 'ex-mock-0001',
  scope: 'exercise',
  personId: null,
  world: 'staff',
  isLead: false,
  accountId: 'acct-test',
  role: 'planner',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function primeSession(role: SessionRole) {
  const session = withRole(BASE_SESSION, role)
  vi.mocked(useSession).mockReturnValue(session)
  vi.mocked(useRole).mockReturnValue(role)
}

/** Reports the router's live pathname, so a redirect (or its absence) is visible. */
function LocationProbe() {
  return <div data-testid="pathname">{useLocation().pathname}</div>
}

const StubParticipantGuard: ComponentType<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="participant-guard">{children}</div>
)

/**
 * Mounts the app's real staff/participant decision at `path`. The registry is
 * the SHIPPED one, injected exactly as `App.tsx` injects it; the participant
 * surface, guard and switcher are the composition-root leaves `RoleAwareEntry`
 * takes as props in production too.
 */
function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<div data-testid="login-sentinel" />} />
          <Route
            path="*"
            element={(
              <ExerciseContextProvider>
                <RoleAwareEntry
                  participantSurface={<div data-testid="participant-surface" />}
                  staffRoutes={STAFF_ROUTE_REGISTRY}
                  participantGuard={StubParticipantGuard}
                />
              </ExerciseContextProvider>
            )}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(useSession).mockReset()
  vi.mocked(useRole).mockReset()
  resetOrgExerciseMocks()
})

describe('COR-076 — an orgAdmin session reaches a real surface, not /login', () => {
  it('lands on the exercise-management surface from the app root', async () => {
    primeSession('orgAdmin')
    renderAt('/')

    // The regression this closes: `RoleAwareEntry`'s fallback arm used to match
    // every orgAdmin and send them straight back to sign-in.
    expect(await screen.findByTestId('exercise-management-page')).toBeInTheDocument()
    expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')
    })
  })

  it('lands there from an unknown staff path too (it is their DEFAULT surface)', async () => {
    primeSession('orgAdmin')
    renderAt('/staff/no-such-surface')

    expect(await screen.findByTestId('exercise-management-page')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')
    })
  })

  it('renders in the STAFF world (COBRA shell chrome), not a third visual world', async () => {
    primeSession('orgAdmin')
    renderAt('/staff/exercises')

    await screen.findByTestId('exercise-management-page')
    // The same shell every other staff surface mounts — story 03 is explicit
    // that org administration is a third AUTHORIZATION family, not a third
    // design language.
    expect(screen.getByTestId('staff-header-lockup')).toBeInTheDocument()
  })

  it('still fails closed for an EXPIRED orgAdmin session', async () => {
    const expired = {
      ...withRole(BASE_SESSION, 'orgAdmin'),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }
    vi.mocked(useSession).mockReturnValue(expired)
    vi.mocked(useRole).mockReturnValue('orgAdmin')
    renderAt('/staff/exercises')

    expect(await screen.findByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
  })
})

describe('the surface mirrors the server gate: planner yes, controller/evaluator no', () => {
  it('a PLANNER can open /staff/exercises', async () => {
    primeSession('planner')
    renderAt('/staff/exercises')

    expect(await screen.findByTestId('exercise-management-page')).toBeInTheDocument()
  })

  it('a planner’s DEFAULT surface is still the planner workspace, not this one', async () => {
    primeSession('planner')
    renderAt('/staff')

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/plan')
    })
    expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
  })

  it('a CONTROLLER at /staff/exercises reaches exercise management (DF-20, seam S-4)', async () => {
    primeSession('controller')
    renderAt('/staff/exercises')

    expect(await screen.findByTestId('exercise-management-page')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-controller-console')).not.toBeInTheDocument()
    // Story 22 positive control for the evaluator case: an admitted role DOES get row actions.
    expect((await screen.findAllByRole('button', { name: /^Rename / })).length).toBeGreaterThan(0)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')
  })

  it('an EVALUATOR at /staff/exercises sees the not-allowed page naming the three roles', async () => {
    const user = userEvent.setup()
    primeSession('evaluator')
    renderAt('/staff/exercises')

    expect(await screen.findByTestId('staff-not-allowed-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Not allowed' })).toBeInTheDocument()
    expect(screen.getByText(
      'You need the planner, org admin or controller role to open Exercise Management.',
    )).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stub-evaluator-dashboard')).not.toBeInTheDocument()
    // Story 22: a read-only evaluator sees no row actions at all: no table, so no
    // Rename, Archive or Duplicate control anywhere on the page.
    expect(screen.queryByTestId('org-exercise-table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Rename|Archive|Duplicate) / })).not.toBeInTheDocument()
    // No silent bounce: the URL stays where the evaluator asked to go.
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')

    // The one button goes to the evaluator's OWN default page.
    await user.click(screen.getByRole('button', { name: 'Go to Evaluator Dashboard' }))
    expect(await screen.findByTestId('stub-evaluator-dashboard')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/evaluate')
    })
    expect(screen.queryByTestId('staff-not-allowed-page')).not.toBeInTheDocument()
  })

  it('an UNKNOWN /staff/nope still redirects to the default — the page is for registered paths only', async () => {
    primeSession('evaluator')
    renderAt('/staff/nope')

    expect(await screen.findByTestId('stub-evaluator-dashboard')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/evaluate')
    })
    expect(screen.queryByTestId('staff-not-allowed-page')).not.toBeInTheDocument()
  })
})

describe('COR-004 — the new staff path adds no participant one', () => {
  it.each(['participant', 'pio'] as const)(
    'a %s typing /staff/exercises still lands on the participant surface',
    async role => {
      primeSession(role)
      renderAt('/staff/exercises')

      expect(await screen.findByTestId('participant-surface')).toBeInTheDocument()
      expect(screen.getByTestId('participant-guard')).toBeInTheDocument()
      expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
      // Nor the staff-only not-allowed page (story 15): a participant is never
      // told which staff role a path needs.
      expect(screen.queryByTestId('staff-not-allowed-page')).not.toBeInTheDocument()
      expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
      expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
      // Not even a canonicalising redirect — the participant branch never reads
      // the URL at all.
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')
    },
  )
})
