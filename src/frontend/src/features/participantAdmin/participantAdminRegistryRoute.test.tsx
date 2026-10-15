/**
 * features/participantAdmin/participantAdminRegistryRoute.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W-3: `/staff/participant-admin` is REACHABLE, composed, and
 * gated exactly like every other registry route.
 *
 * Stories 10, 11 and 12 built the roster screen, "Today's word" and the printable
 * card sheet; nothing mounted them. This drives the REAL `RoleAwareEntry` over the
 * REAL `STAFF_ROUTE_REGISTRY` (injected as `App.tsx` injects it), so the registry
 * entry, `StaffRouteTree`'s gating, the surface's slot composition and the launcher
 * are all proven together rather than each in isolation.
 *
 * REAL: the registry table, the routing glue, `ParticipantAdminSurface` and
 * everything it composes (staff frame, header, roster page, day-word panel, print
 * button), each over its own mock adapter. STUBBED: `@/features/controller` and
 * `@/features/evaluator` (heavy module graphs, only ever needed here as "some other
 * surface" for a refused role to land on) and session resolution, which cannot be
 * driven from outside in a unit test. Same seams as
 * `exerciseLifecycleAdmin/orgAdminSurfaceFamily.test.tsx`.
 *
 * Proves:
 *  1. a controller (and a planner) at the path sees the roster, the day-word panel
 *     and the Print cards button;
 *  2. an evaluator and an org admin are refused (redirected to their own default,
 *     the roster never renders), and a participant or PIO typing the path still
 *     lands on the participant surface (COR-004);
 *  3. the surface launcher lists the entry under Administer, beside the surface the
 *     staff member came from.
 */
import type { ComponentType, ReactNode } from 'react'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { ExerciseRole, Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { RoleAwareEntry } from '@/features/app-shell'
import { STAFF_ROUTE_REGISTRY } from '@/features/staff'

vi.mock('@/features/controller', () => ({
  ControllerConsoleRoute: () => <div data-testid="stub-controller-console" />,
}))
vi.mock('@/features/evaluator', () => ({
  EvaluatorDashboardRoute: () => <div data-testid="stub-evaluator-dashboard" />,
}))
vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, useSession: vi.fn(), useRole: vi.fn() }
})

// The full COBRA page mounts through three mock backends; give a loaded CI box
// headroom over the 10 s test default and the 5 s `findBy`/`waitFor` default.
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 10_000 })

const PATH = '/staff/participant-admin'

const BASE_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-test',
  role: 'controller',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function primeSession(role: ExerciseRole) {
  vi.mocked(useSession).mockReturnValue({ ...BASE_SESSION, role })
  vi.mocked(useRole).mockReturnValue(role)
}

/** Reports the router's live pathname, so a redirect (or its absence) is visible. */
function LocationProbe() {
  return <div data-testid="pathname">{useLocation().pathname}</div>
}

const StubParticipantGuard: ComponentType<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="participant-guard">{children}</div>
)

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
})

describe('/staff/participant-admin — a controller or planner reaches the composed surface', () => {
  it.each(['controller', 'planner'] as const)(
    'a %s sees the roster, the day-word panel and the Print cards button',
    async role => {
      primeSession(role)
      renderAt(PATH)

      const frame = await screen.findByTestId('staff-shell-frame')
      expect(within(frame).getByTestId('staff-shell-header')).toHaveTextContent('Participants')

      // Story 10: the roster.
      expect(await screen.findByTestId('roster-table')).toBeInTheDocument()
      // Story 11: the day-word panel, in the roster's dayWordSlot.
      expect(await screen.findByTestId('day-word-panel')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: "Today's word" })).toBeInTheDocument()
      // Story 12: the print action, in the roster toolbar. Nothing is selected, so
      // it reads "Print all cards".
      const toolbar = screen.getByTestId('roster-toolbar')
      expect(within(toolbar).getByRole('button', { name: 'Print all cards' })).toBeEnabled()
      // Story 13: the email action is mounted but dark: the mock roster reports
      // capabilities.emailLinks false (no mailer configured), so no button renders.
      expect(within(toolbar).queryByRole('button', { name: /^Email/ })).not.toBeInTheDocument()

      // Deep link kept, no redirect, and exactly one main landmark (the frame's).
      expect(screen.getByTestId('pathname')).toHaveTextContent(PATH)
      expect(screen.getAllByRole('main')).toHaveLength(1)
    },
  )

  it('is not anyone\'s default: a bare /staff still lands on the role\'s own home', async () => {
    primeSession('controller')
    renderAt('/staff')

    expect(await screen.findByTestId('stub-controller-console')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
    })
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
  })
})

describe('/staff/participant-admin — refused exactly as the registry gates other routes', () => {
  it('an EVALUATOR is bounced to their own default; the roster never renders', async () => {
    primeSession('evaluator')
    renderAt(PATH)

    expect(await screen.findByTestId('stub-evaluator-dashboard')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/evaluate')
    })
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-word-panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()
  })

  it('an ORG ADMIN is bounced to their own default; the roster never renders', async () => {
    primeSession('orgAdmin')
    renderAt(PATH)

    expect(await screen.findByTestId('exercise-management-page')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/exercises')
    })
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-word-panel')).not.toBeInTheDocument()
  })

  it.each(['participant', 'pio'] as const)(
    'a %s typing the path still lands on the participant surface (COR-004)',
    async role => {
      primeSession(role)
      renderAt(PATH)

      expect(await screen.findByTestId('participant-surface')).toBeInTheDocument()
      expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
      expect(screen.queryByTestId('day-word-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
      expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
      // The participant branch never reads the URL, so not even a redirect.
      expect(screen.getByTestId('pathname')).toHaveTextContent(PATH)
    },
  )
})

describe('/staff/participant-admin — the staff navigation offers it under Administer', () => {
  it('lists Participants in the Administer group of the controller\'s surface launcher', async () => {
    const user = userEvent.setup()
    primeSession('controller')
    renderAt(PATH)

    await screen.findByTestId('roster-table')
    await user.click(screen.getByRole('button', { name: /Staff surfaces/ }))

    const menu = await screen.findByRole('menu', { name: 'Staff surfaces' })
    const administer = within(menu).getByRole('group', { name: 'Administer' })
    const entry = within(administer).getByTestId('surface-launcher-item-participant-admin')
    expect(entry).toHaveTextContent('Participants')
    // The page the staff member is on is marked as current, not offered as a destination.
    expect(entry).toHaveAttribute('aria-current', 'page')

    // And their own console is one click away, under Conduct.
    const conduct = within(menu).getByRole('group', { name: 'Conduct' })
    expect(within(conduct).getByTestId('surface-launcher-item-controller-console')).toBeEnabled()
  })

  it('navigates away through the launcher (client-side) and the entry is no longer current', async () => {
    const user = userEvent.setup()
    primeSession('controller')
    renderAt(PATH)

    await screen.findByTestId('roster-table')
    await user.click(screen.getByRole('button', { name: /Staff surfaces/ }))
    await user.click(await screen.findByTestId('surface-launcher-item-controller-console'))

    expect(await screen.findByTestId('stub-controller-console')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
  })
})
