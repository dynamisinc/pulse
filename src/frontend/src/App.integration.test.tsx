/**
 * App.integration.test.tsx
 * ---------------------------------------------------------------------------
 * Integration-B wiring tests for the staff route compositions `App.tsx` owns —
 * the Evaluator Dashboard (`EvaluatorDashboardRoute`) and the planner's
 * Exercise Settings workspace (`PlannerWorkspaceRoute`) — plus the ROUTE TABLE
 * those surfaces are handed to. The individual pieces are unit-tested in their
 * own stories; this file proves they are WIRED together, in the composition
 * root, exactly as they ship.
 *
 * WHY THE ROUTE-TABLE CASE EXISTS (WR-003 on the exercise-configuration
 * umbrella, #41). `RoleAwareEntry` fails a staff role with no built surface
 * closed — a planner whose `staffSurfaces.planner` slot is missing is redirected
 * to `/login`, forever, with no error anywhere. `RoleAwareEntry.test.tsx` covers
 * that MECHANISM with its own injected surface map, so it is blind to the real
 * table in `App.tsx`: deleting `planner:` from `staffSurfaces` used to leave the
 * whole suite green while planners silently lost their surface. The last
 * describe below closes that hole by asserting on the arguments `App.tsx`
 * actually hands `createRoleAwareRoutes` at module load — see the spy note on
 * the `vi.mock` factory.
 *
 * Evaluator Dashboard — proves:
 *
 *  - the evaluator surface renders inside the real `StaffShellFrame` (navy
 *    header + the shared toolstrip), not the old stub;
 *  - the evaluator's own tools register into the toolstrip SURFACE zone
 *    (rehost, Integration A);
 *  - the shell-global participant-admin tool registers into the SHELL-GLOBAL
 *    zone (story 03), mounted by the frame's `globalOverlay` slot;
 *  - the header's Preview-as button (story 01) drives `usePreview()` (story
 *    04): pressing it SWAPS the work area for the read-only participant
 *    preview stage, and suppresses the shell-global admin flyout so it can
 *    never sit above the preview stage; exiting restores the work area.
 *
 * Planner workspace (exercise-configuration, story 01b) — proves:
 *  - the planner surface renders inside the real `StaffShellFrame` (staff
 *    header naming "Exercise Settings" + the shared toolstrip), NOT a stub and
 *    NOT some other surface: the real `ExerciseSettingsPage` AND the live
 *    `ExerciseSettingsPanel` beneath it are both asserted, so swapping the
 *    mounted surface (for another staff page, or for a participant element)
 *    fails here;
 *  - the COMPOSED surface has exactly ONE `<main>` landmark, the shell's work
 *    area, with the planner page inside it (#382). The page's own suite renders
 *    it standalone and so is structurally blind to a nested landmark; this file
 *    is the only place the composition is observable, which is why the guard
 *    lives here rather than there;
 *  - it stays inside the staff world — no participant compliance chrome, no
 *    brand skin;
 *  - it wires NO preview handler, so (post-WR-003) it ships no preview control
 *    at all rather than a dead one.
 *
 * `ExerciseContextProvider` resolves its mock scope asynchronously (it renders
 * nothing until resolved), so the first assertion waits via `findBy*`.
 *
 * `StaffHeader` (mounted inside both route compositions) calls `useNavigate()`
 * for its sign-out control (feature: login, story 04) — wrapped in a real
 * `MemoryRouter` here so this genuinely un-mocked integration path still renders.
 */
import { isValidElement, type ReactElement } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { RoleAwareEntryProps, StaffSurfaceRole } from './features/app-shell'
import { EvaluatorDashboardRoute, PlannerWorkspaceRoute } from './App'

/**
 * Captures the surface map `App.tsx` hands `createRoleAwareRoutes` at module
 * load. A PASS-THROUGH spy: the factory returns the real implementation (via
 * `importOriginal`), so the route table this file's other cases render against
 * is the genuine one — the only added behavior is recording the argument. It is
 * a plain object rather than a `vi.fn()` record so a future `clearMocks` can
 * never quietly erase the evidence (the call happens once, at import time,
 * before any `beforeEach` runs).
 */
const routeTable = vi.hoisted(() => ({
  surfaces: undefined as unknown,
}))

vi.mock('./features/app-shell', async importOriginal => {
  const actual = await importOriginal<typeof import('./features/app-shell')>()
  return {
    ...actual,
    createRoleAwareRoutes: (surfaces: RoleAwareEntryProps) => {
      routeTable.surfaces = surfaces
      return actual.createRoleAwareRoutes(surfaces)
    },
  }
})

/** A dedicated client per render so React Query state never leaks between cases. */
function renderInStaffWorld(surface: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{surface}</QueryClientProvider>
    </MemoryRouter>,
  )
}

function renderRoute() {
  return renderInStaffWorld(<EvaluatorDashboardRoute />)
}

function renderPlannerRoute() {
  return renderInStaffWorld(<PlannerWorkspaceRoute />)
}

describe('EvaluatorDashboardRoute — Integration B wiring', () => {
  it('renders the evaluator inside the real staff frame with both toolstrip zones populated', async () => {
    renderRoute()

    // Exercise context resolves async; the navy staff header appearing proves
    // the frame mounted (not the deleted stub).
    expect(await screen.findByTestId('staff-header')).toBeInTheDocument()
    expect(screen.getByTestId('staff-shell-header')).toHaveTextContent('Evaluator Dashboard')

    // Shell-global zone: the participant-admin tool (story 03) is mounted via
    // the frame's globalOverlay slot.
    expect(screen.getByTestId('toolstrip-tool-participant-admin')).toBeInTheDocument()
    // Surface zone: the evaluator's own tools registered through the rehost.
    expect(screen.getByTestId('toolstrip-tool-annotations')).toBeInTheDocument()

    // Not previewing yet: the button offers to enter preview, no stage shown.
    const previewButton = screen.getByTestId('staff-header-preview-toggle')
    expect(previewButton).toHaveTextContent('Preview as participant')
    expect(previewButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
  })

  it('Preview-as button swaps the work area for the read-only preview stage and suppresses the admin flyout, then restores on exit', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByTestId('staff-header')
    const previewButton = screen.getByTestId('staff-header-preview-toggle')

    // Enter preview.
    await user.click(previewButton)

    // The participant-preview stage replaces the work area, rendering the
    // read-only participant-world stub.
    expect(await screen.findByTestId('preview-as-participant')).toBeInTheDocument()
    expect(screen.getByTestId('portal-stub')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-preview-toggle')).toHaveAttribute('aria-pressed', 'true')

    // The shell-global admin flyout is suppressed during preview (so it can
    // never render above the preview stage), and the evaluator's surface tools
    // are gone with the swapped-out work area.
    expect(screen.queryByTestId('toolstrip-tool-participant-admin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('toolstrip-tool-annotations')).not.toBeInTheDocument()

    // Exit preview → the work area (and its tools) come back.
    await user.click(screen.getByTestId('preview-exit'))
    await waitFor(() => {
      expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('toolstrip-tool-participant-admin')).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-tool-annotations')).toBeInTheDocument()
  })

  it('opens the shell-global participant-admin flyout from the toolstrip (within the staff frame)', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByTestId('staff-header')

    // Flyout closed initially.
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('toolstrip-tool-participant-admin'))

    const flyout = await screen.findByTestId('participant-admin-flyout')
    expect(flyout).toBeInTheDocument()
    // Login-triage rows render (the mock roster) — proves the flyout is live,
    // not an empty shell.
    expect(within(flyout).getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})

describe('PlannerWorkspaceRoute — Integration B wiring (exercise-configuration/01b)', () => {
  it('renders the exercise-settings surface inside the real staff frame', async () => {
    renderPlannerRoute()

    // Exercise context resolves async; the navy staff header appearing proves
    // the frame mounted.
    expect(await screen.findByTestId('staff-header')).toBeInTheDocument()
    expect(screen.getByTestId('staff-shell-header')).toHaveTextContent('Exercise Settings')
    // The shared toolstrip is mounted (the frame's toolstrip slot is wired).
    expect(screen.getByTestId('staff-shell-toolstrip')).toBeInTheDocument()

    // The work area is the REAL planner page, not a placeholder and not another
    // surface: its landmark, its h1, and the live settings panel below it.
    expect(screen.getByTestId('exercise-settings-page')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: /exercise configuration/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('exercise-settings-panel')).toBeInTheDocument()

    // The panel is genuinely live — it loads through its own service seam and
    // renders the editable form, so this is the shipped page, not a shell.
    expect(await screen.findByTestId('exercise-settings-form')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /exercise name/i })).toBeInTheDocument()
  })

  it('exposes exactly ONE main landmark — the shell work area — and one h1 (#382)', async () => {
    // THE COMPOSED assertion, deliberately not a standalone one. `StaffShellFrame`
    // renders the work area as `<main>`, and `ExerciseSettingsPage` used to render
    // `component="main"` too, so the surface a planner actually loads carried TWO
    // nested `main` landmarks: invalid HTML, and two "main" destinations for one
    // page in a screen reader's landmark list. The page's own suite can only see
    // the page, so it could (and did) stay green while the running app was wrong;
    // this is the one place the nesting is observable.
    renderPlannerRoute()

    await screen.findByTestId('staff-header')

    const landmarks = screen.getAllByRole('main')
    expect(landmarks).toHaveLength(1)
    // ...and the one that survives is the SHELL's, with the planner page inside
    // it — not the page having won and the shell's having gone missing.
    expect(landmarks[0]).toBe(screen.getByTestId('staff-shell-work-area'))
    expect(landmarks[0]).toContainElement(screen.getByTestId('exercise-settings-page'))

    // One h1 for the composed page, so the heading outline still has a single root.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('stays in the staff world: no participant compliance chrome, no preview control', async () => {
    renderPlannerRoute()

    await screen.findByTestId('staff-header')

    // Participant-world chrome belongs to the participant shell; a staff
    // surface must never render it (D0 §2 two-worlds).
    expect(screen.queryByTestId('pulse-compliance-chrome-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-compliance-chrome-bottom')).not.toBeInTheDocument()

    // The planner wires no preview handler (a planner configuring the world has
    // no scenario moment to preview), so the handler-gated control is absent —
    // not present-and-inert (WR-003).
    expect(screen.queryByTestId('staff-header-preview-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
  })
})

describe('App route table — the staff surface map handed to createRoleAwareRoutes', () => {
  /** The captured argument, narrowed once for every case below. */
  function capturedSurfaces(): RoleAwareEntryProps {
    const captured = routeTable.surfaces
    if (captured === undefined || typeof captured !== 'object') {
      throw new Error('App.tsx never called createRoleAwareRoutes — the route table is not wired.')
    }
    return captured as RoleAwareEntryProps
  }

  it('fills every staff role that has a built surface — including planner', () => {
    const { staffSurfaces } = capturedSurfaces()

    // Named individually (not a loop over a list this test owns) so deleting a
    // slot from App.tsx fails HERE, loudly, instead of silently shrinking a
    // list and leaving that role's staff redirected to /login forever.
    expect(staffSurfaces.controller).toBeDefined()
    expect(staffSurfaces.evaluator).toBeDefined()
    expect(staffSurfaces.planner).toBeDefined()
  })

  it('maps the planner slot to PlannerWorkspaceRoute, not to some other element', () => {
    const planner = capturedSurfaces().staffSurfaces.planner

    // Identity, not just presence: swapping the planner surface for another
    // staff page — or for a participant element — fails here too.
    expect(isValidElement(planner)).toBe(true)
    expect(isValidElement(planner) ? planner.type : undefined).toBe(PlannerWorkspaceRoute)
  })

  it('mounts a surface for each of the three staff roles RoleAwareEntry can route', () => {
    const { staffSurfaces } = capturedSurfaces()

    // `StaffSurfaceRole` is the union RoleAwareEntry branches on; a role added
    // to it later shows up here as an unfilled slot rather than as a silent
    // fail-closed redirect discovered in UAT.
    const roles: StaffSurfaceRole[] = ['controller', 'evaluator', 'planner']
    for (const role of roles) {
      expect(staffSurfaces[role]).toBeDefined()
    }
  })

  it('wires the participant surface and both composed guards alongside them', () => {
    const surfaces = capturedSurfaces()

    // The staff table is only half the entry contract — assert the rest is
    // still wired so this case cannot pass on a half-built table.
    expect(surfaces.participantSurface).toBeDefined()
    expect(surfaces.participantGuard).toBeDefined()
    expect(surfaces.staffSwitcher).toBeDefined()
  })
})
