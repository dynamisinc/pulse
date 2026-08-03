/**
 * features/exerciseLifecycleAdmin/exerciseManagementLauncher.test.tsx
 * ---------------------------------------------------------------------------
 * THE PAYOFF TEST: the surface launcher is now LIVE in production, for the
 * first time (COR-070/COR-071 + this feature's surface #4).
 *
 * ## Why this needs its own file, and why it renders NOTHING with props
 * `SurfaceLauncher` degrades to a static, non-interactive brand lockup when the
 * caller can reach at most one surface (`entries.length <= 1`). Until this
 * feature landed EVERY staff role mapped to exactly one registry entry, so that
 * degrade is what shipped — and it is pixel-identical to a launcher that was
 * never wired to anything at all. Reviewer WR-002/WR-003 and
 * `staffLauncherWiring.test.tsx` both exist because of that ambiguity.
 *
 * So the assertions below deliberately supply the launcher with NOTHING:
 *   - no `registry` prop — it must arrive from `StaffNavigationProvider`, which
 *     the REAL `StaffRouteTree` mounts;
 *   - no `role` prop — same source;
 *   - no `currentPath` prop — it must come from `useLocation()` (WR-001: as a
 *     prop nothing in production ever passed it, so the entire current-surface
 *     treatment was unreachable outside tests that passed it themselves).
 *
 * The launcher instance under test is the one the REAL `StaffHeader` inside the
 * REAL `ExerciseManagementRoute` mounts. A prop-passing test structurally cannot
 * see the failure this guards: a launcher wired to nothing renders exactly the
 * same lockup as a correctly-degraded one.
 *
 * `@/features/controller` / `@/features/evaluator` are stubbed for the same
 * reason as in `orgAdminSurfaceFamily.test.tsx` — this file needs them as
 * "some other surface", not as their own module graphs — and the stubs mount the
 * REAL `StaffHeader`, so the single-surface DEGRADE control below is still
 * measuring the real component in its real wiring.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { StaffRouteTree } from '@/features/app-shell'
import type { StaffSurfaceRole } from '@/features/app-shell'
import { STAFF_ROUTE_REGISTRY } from '@/features/staff'
import { resetOrgExerciseMocks } from './services/orgExercisesService'

vi.mock('@/features/controller', async () => {
  const { StaffShellFrame } = await import('@/features/staffShell/StaffShellFrame')
  const { StaffHeader } = await import('@/features/staffShell/components/StaffHeader')
  return {
    ControllerConsoleRoute: () => (
      <StaffShellFrame header={<StaffHeader surfaceName="Controller Console" />}>
        <div data-testid="stub-controller-console" />
      </StaffShellFrame>
    ),
  }
})
vi.mock('@/features/evaluator', async () => {
  const { StaffShellFrame } = await import('@/features/staffShell/StaffShellFrame')
  const { StaffHeader } = await import('@/features/staffShell/components/StaffHeader')
  return {
    EvaluatorDashboardRoute: () => (
      <StaffShellFrame header={<StaffHeader surfaceName="Evaluator Dashboard" />}>
        <div data-testid="stub-evaluator-dashboard" />
      </StaffShellFrame>
    ),
  }
})

/**
 * Mounts the REAL staff route tree over the REAL registry at `path`. This is the
 * production wiring: the tree publishes `{registry, role}` through
 * `StaffNavigationProvider`, every surface mounts its own `StaffHeader`, and
 * that header mounts `SurfaceLauncher` with no props at all.
 */
function renderTreeAt(role: StaffSurfaceRole, path: string, defaultPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ExerciseContextProvider>
          <StaffRouteTree
            routes={STAFF_ROUTE_REGISTRY}
            role={role}
            defaultPath={defaultPath}
          />
        </ExerciseContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetOrgExerciseMocks()
})

describe('the launcher is LIVE for a planner (no longer permanently degraded)', () => {
  it('renders an interactive disclosure, not the static lockup', async () => {
    renderTreeAt('planner', '/staff/exercises', '/staff/plan')
    await screen.findByTestId('exercise-management-page')

    const lockup = screen.getByTestId('staff-header-lockup')
    // The degrade renders a plain <Stack>; the live launcher renders a real
    // <button> with menu semantics. THIS is the assertion that would have been
    // false for every role before surface #4 existed.
    expect(lockup.tagName).toBe('BUTTON')
    expect(lockup).toHaveAttribute('aria-haspopup', 'menu')
    expect(lockup).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers both of the planner’s surfaces, sectioned by launcher group', async () => {
    const user = userEvent.setup()
    renderTreeAt('planner', '/staff/exercises', '/staff/plan')
    await screen.findByTestId('exercise-management-page')

    await user.click(screen.getByTestId('staff-header-lockup'))

    expect(screen.getByTestId('surface-launcher-item-planner-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('surface-launcher-item-exercise-management')).toBeInTheDocument()
    // Real ARIA groups, not spacing: Plan and Administer.
    expect(screen.getByRole('group', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Administer' })).toBeInTheDocument()
  })

  it('marks the surface actually being rendered as Current — with NOTHING prop-drilled', async () => {
    const user = userEvent.setup()
    renderTreeAt('planner', '/staff/exercises', '/staff/plan')
    await screen.findByTestId('exercise-management-page')

    await user.click(screen.getByTestId('staff-header-lockup'))

    const current = screen.getByTestId('surface-launcher-item-exercise-management')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('aria-disabled', 'true')
    // Never colour-only (NFR-001): a check icon PLUS the word.
    expect(within(current).getByText('Current')).toBeInTheDocument()
    // ...and the other entry is offered as a real destination.
    expect(screen.getByTestId('surface-launcher-item-planner-workspace'))
      .not.toHaveAttribute('aria-current')
  })

  it('navigates to the other surface when it is chosen', async () => {
    const user = userEvent.setup()
    renderTreeAt('planner', '/staff/exercises', '/staff/plan')
    await screen.findByTestId('exercise-management-page')

    await user.click(screen.getByTestId('staff-header-lockup'))
    await user.click(screen.getByTestId('surface-launcher-item-planner-workspace'))

    expect(await screen.findByTestId('exercise-settings-page')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-management-page')).not.toBeInTheDocument()
  })

  it('follows the route: from the planner workspace, THAT entry is the current one', async () => {
    const user = userEvent.setup()
    renderTreeAt('planner', '/staff/plan', '/staff/plan')
    await screen.findByTestId('exercise-settings-page')

    await user.click(screen.getByTestId('staff-header-lockup'))

    expect(screen.getByTestId('surface-launcher-item-planner-workspace'))
      .toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('surface-launcher-item-exercise-management'))
      .not.toHaveAttribute('aria-current')
  })
})

describe('the degrade is intact for a single-surface role (the non-vacuity control)', () => {
  it.each([
    ['controller', '/staff/console', 'stub-controller-console'],
    ['evaluator', '/staff/evaluate', 'stub-evaluator-dashboard'],
  ] as const)('a %s still gets the static lockup', async (role, path, surfaceTestId) => {
    // Without this control the cases above could be passing because the launcher
    // ALWAYS renders a button now — which would mean a one-destination menu that
    // goes nowhere, the thing the degrade rule exists to prevent.
    renderTreeAt(role, path, path)
    await screen.findByTestId(surfaceTestId)

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(lockup.tagName).not.toBe('BUTTON')
    expect(lockup).not.toHaveAttribute('aria-haspopup')
  })
})

describe('the launcher for an orgAdmin', () => {
  it('degrades today, because exercise management is their only surface', async () => {
    // Honest, not aspirational: `GET /api/org/staff-assignments` exists and is
    // gated on orgAdmin alone, but no surface consumes it yet, so an org-admin
    // has exactly one destination. When that second surface lands, this case
    // flips — which is the point of asserting it rather than leaving it
    // undefined.
    renderTreeAt('orgAdmin', '/staff/exercises', '/staff/exercises')
    await screen.findByTestId('exercise-management-page')

    expect(screen.getByTestId('staff-header-lockup').tagName).not.toBe('BUTTON')
  })
})
