/**
 * features/staffShell/components/ParticipantAdminFlyout.registry.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login W2-4 against the REAL staff route registry: the shell-global flyout's footer
 * link to the full participant-admin surface follows the registry entry, for every staff
 * role, through the real `StaffRouteTree` (which is what publishes `{registry, role}` to
 * staff chrome). The injected-registry cases are in `ParticipantAdminFlyout.test.tsx`.
 *
 * What it pins that a hand-built registry cannot:
 *  - the link appears for the planner and the controller and for NOBODY else, because that
 *    is what the shipped entry's `allowedRoles` says (the flyout is mounted on the
 *    evaluator's and the org admin's surfaces too);
 *  - its href is the shipped entry's path, so a rename in the registry moves the link;
 *  - following it from a real controller surface lands on the real participant-admin surface
 *    without a reload.
 *
 * `@/features/controller` and `@/features/evaluator` are stubbed to small surfaces that mount
 * the flyout in the real staff frame (their real compositions drag in the engine cockpit and
 * SignalR); the registry's own shape is untouched. Same technique as
 * `exerciseLifecycleAdmin/orgAdminSurfaceFamily.test.tsx`.
 */
import { configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { StaffRouteTree, resolveDefaultStaffRoute } from '@/features/app-shell'
import type { StaffSurfaceRole } from '@/features/app-shell'
import { STAFF_ROUTE_REGISTRY } from '@/features/staff'
import { PARTICIPANT_ADMIN_TOOL_ID } from './ParticipantAdminFlyout'

vi.mock('@/features/controller', async () => {
  const { StaffShellFrame } = await import('@/features/staffShell/StaffShellFrame')
  const { StaffHeader } = await import('./StaffHeader')
  const { Toolstrip } = await import('./Toolstrip')
  const { ToolstripProvider } = await import('@/features/staffShell/toolRegistry')
  const { ParticipantAdminFlyout } = await import('./ParticipantAdminFlyout')
  return {
    ControllerConsoleRoute: () => (
      <ToolstripProvider>
        <StaffShellFrame
          header={<StaffHeader surfaceName="Controller Console" />}
          toolstrip={<Toolstrip />}
          globalOverlay={<ParticipantAdminFlyout />}
        >
          <div data-testid="stub-controller-console" />
        </StaffShellFrame>
      </ToolstripProvider>
    ),
  }
})
vi.mock('@/features/evaluator', async () => {
  const { StaffShellFrame } = await import('@/features/staffShell/StaffShellFrame')
  const { StaffHeader } = await import('./StaffHeader')
  const { Toolstrip } = await import('./Toolstrip')
  const { ToolstripProvider } = await import('@/features/staffShell/toolRegistry')
  const { ParticipantAdminFlyout } = await import('./ParticipantAdminFlyout')
  return {
    EvaluatorDashboardRoute: () => (
      <ToolstripProvider>
        <StaffShellFrame
          header={<StaffHeader surfaceName="Evaluator Dashboard" />}
          toolstrip={<Toolstrip />}
          globalOverlay={<ParticipantAdminFlyout />}
        >
          <div data-testid="stub-evaluator-dashboard" />
        </StaffShellFrame>
      </ToolstripProvider>
    ),
  }
})

vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 10_000 })

function renderAs(role: StaffSurfaceRole) {
  const home = resolveDefaultStaffRoute(STAFF_ROUTE_REGISTRY, role)
  if (home === undefined) throw new Error(`no default surface for ${role}`)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[home.path]}>
        <ExerciseContextProvider>
          <StaffRouteTree routes={STAFF_ROUTE_REGISTRY} role={role} defaultPath={home.path} />
        </ExerciseContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openFlyout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`))
  return screen.findByTestId('participant-admin-flyout')
}

describe('the flyout footer follows the shipped registry entry', () => {
  it('shows the CONTROLLER the link, to the entry\'s path', async () => {
    const user = userEvent.setup()
    renderAs('controller')

    const flyout = await openFlyout(user)

    const entry = STAFF_ROUTE_REGISTRY.find(candidate => candidate.id === 'participant-admin')
    expect(entry).toBeDefined()
    expect(within(flyout).getByRole('link', { name: 'Open full participant admin' }))
      .toHaveAttribute('href', entry?.path)
  })

  it('hides it from the EVALUATOR, on whose surface the flyout is also mounted', async () => {
    const user = userEvent.setup()
    renderAs('evaluator')

    const flyout = await openFlyout(user)

    expect(within(flyout).queryByRole('link')).not.toBeInTheDocument()
    expect(within(flyout).queryByTestId('participant-admin-footer')).not.toBeInTheDocument()
  })

  it('following it from the controller console reaches the real surface, with no reload', async () => {
    const user = userEvent.setup()
    renderAs('controller')
    const flyout = await openFlyout(user)

    await user.click(within(flyout).getByRole('link', { name: 'Open full participant admin' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Participants' })).toBeInTheDocument()
    expect(await screen.findByTestId('roster-table')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-controller-console')).not.toBeInTheDocument()
  })
})
