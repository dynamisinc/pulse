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
 *  2. A `controller` / `evaluator` cannot reach `/staff/exercises` — mirroring
 *     the server's 403 rather than trusting it alone.
 *  3. A PARTICIPANT typing `/staff/exercises` still lands on their participant
 *     surface. COR-004 is structural (`participantLocationBlindness.test.ts`),
 *     but every new staff path deserves the behavioural case too: the whole
 *     point is that adding staff URLs never adds a participant one.
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { ExerciseRole, Session } from '@/core/auth'
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

const BASE_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-test',
  role: 'planner',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function primeSession(role: ExerciseRole) {
  const session: Session = { ...BASE_SESSION, role }
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
                  staffSwitcher={<div data-testid="exercise-switcher" />}
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
    const expired: Session = {
      ...BASE_SESSION,
      role: 'orgAdmin',
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

  it('a CONTROLLER at /staff/exercises is bounced to their own default surface', async () => {
    primeSession('controller')
    renderAt('/staff/exercises')

    // `allowedRoles` is the only gate: the route is never even registered for
    // this role, so it cannot render — it can only redirect.
    expect(await screen.findByTestId('stub-controller-console')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
    })
  })

  it('an EVALUATOR at /staff/exercises is bounced to their own default surface', async () => {
    primeSession('evaluator')
    renderAt('/staff/exercises')

    expect(await screen.findByTestId('stub-evaluator-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/evaluate')
    })
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
      expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
      expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
      // Not even a canonicalising redirect — the participant branch never reads
      // the URL at all.
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')
    },
  )
})
