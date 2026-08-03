/**
 * features/app-shell/staffLauncherWiring.test.tsx
 * ---------------------------------------------------------------------------
 * THE ANTI-DEAD-WIRING GUARD for the surface launcher (COR-070/COR-071).
 *
 * ## Why this file exists
 * `SurfaceLauncher` degrades to a static, non-interactive brand lockup when it
 * has fewer than two reachable surfaces. That degrade is CORRECT behaviour for
 * a single-surface role — and it is also EXACTLY what an unwired launcher looks
 * like. "Correctly degraded" and "never received a registry" are pixel-identical,
 * so a launcher that is silently disconnected from the route tree cannot be
 * caught by looking at a rendered surface, and every unit test of the launcher
 * itself passes either way (they inject the registry explicitly).
 *
 * This repo has repeatedly shipped features that were built, tested, green, and
 * wired to nothing. The guard below is the mechanical check: it renders the REAL
 * `StaffRouteTree` (not a fixture wrapper) and asserts that a component sitting
 * where `StaffHeader` sits actually RECEIVES the registry and role. If someone
 * removes the provider, changes the injection seam, or a future surface stops
 * routing through the tree, this goes red.
 *
 * ## Three wires, not one (WR-001)
 * The launcher needs THREE things to work, and each of them can be dead
 * independently: the `registry`, the `role`, and the CURRENT PATH. The first two
 * were guarded here from the start; the third was not, and it was in fact dead —
 * `currentPath` was a prop nothing in production ever passed, so
 * `aria-current="page"`, the disabled state, and the "Current" chip (AC3) could
 * only ever be seen by a test that passed the prop itself. The last describe
 * closes that hole by rendering the REAL `SurfaceLauncher` with NO props at all
 * inside the real tree — exactly as `StaffHeader` mounts it — and asserting the
 * marking appears anyway.
 *
 * Beyond that it deliberately does NOT assert launcher UI —
 * `SurfaceLauncher.test.tsx` owns that. This asserts only the things no other
 * test can see: that the wires exist.
 */

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { faFlask } from '@fortawesome/free-solid-svg-icons'
import { SurfaceLauncher } from '@/features/staffShell/components/SurfaceLauncher'
import { StaffRouteTree } from './StaffRouteTree'
import { useStaffNavigation } from './staffNavigationContext'
import type { StaffRouteRegistry } from './staffRouting'

/** Stands in for `StaffHeader`: staff chrome rendered INSIDE a surface. */
function ChromeProbe() {
  const scope = useStaffNavigation()
  if (scope === null) return <div data-testid="probe">UNWIRED</div>
  return (
    <div data-testid="probe">
      {`role=${scope.role} count=${scope.registry.length}`}
    </div>
  )
}

/**
 * Two surfaces for one role, so the launcher's real degrade rule
 * (`entries.length <= 1`) is not what is being measured here.
 */
const REGISTRY: StaffRouteRegistry = [
  {
    id: 'probe-a',
    path: '/staff/probe-a',
    label: 'Probe A',
    icon: faFlask,
    element: <ChromeProbe />,
    allowedRoles: ['planner'],
    isDefaultFor: ['planner'],
    group: 'plan',
  },
  {
    id: 'probe-b',
    path: '/staff/probe-b',
    label: 'Probe B',
    icon: faFlask,
    element: <ChromeProbe />,
    allowedRoles: ['planner'],
    group: 'administer',
  },
]

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StaffRouteTree routes={REGISTRY} role="planner" defaultPath="/staff/probe-a" />
    </MemoryRouter>,
  )
}

describe('staff launcher wiring (anti-dead-wiring guard)', () => {
  it('delivers the registry and role to chrome rendered inside a staff surface', () => {
    renderAt('/staff/probe-a')
    // The assertion that a prop-drilled launcher would fail: chrome inside the
    // surface can see the navigable set without the composition forwarding it.
    expect(screen.getByTestId('probe')).toHaveTextContent('role=planner count=2')
  })

  it('delivers the scope on every registered surface, not just the default one', () => {
    // Guards the "new surface forgot to wire its header" regression directly:
    // a second surface must be wired by construction, with no per-surface step.
    renderAt('/staff/probe-b')
    expect(screen.getByTestId('probe')).toHaveTextContent('role=planner count=2')
  })

  it('reports UNWIRED outside a staff route tree, so the probe can actually fail', () => {
    // Proves the detector is capable of going red — without this, the two
    // assertions above could be passing for the wrong reason.
    render(
      <MemoryRouter>
        <ChromeProbe />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('UNWIRED')
  })
})

/**
 * The same two surfaces, but each one renders the REAL `SurfaceLauncher` with
 * NO props — the exact call `StaffHeader` makes in production. If the launcher
 * needed anything prop-drilled to mark the current surface, these cases fail.
 */
const LAUNCHER_REGISTRY: StaffRouteRegistry = [
  {
    id: 'probe-a',
    path: '/staff/probe-a',
    label: 'Probe A',
    icon: faFlask,
    element: <SurfaceLauncher surfaceName="Probe A" />,
    allowedRoles: ['planner'],
    isDefaultFor: ['planner'],
    group: 'plan',
  },
  {
    id: 'probe-b',
    path: '/staff/probe-b',
    label: 'Probe B',
    icon: faFlask,
    element: <SurfaceLauncher surfaceName="Probe B" />,
    allowedRoles: ['planner'],
    group: 'administer',
  },
]

function renderLauncherAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StaffRouteTree routes={LAUNCHER_REGISTRY} role="planner" defaultPath="/staff/probe-a" />
    </MemoryRouter>,
  )
}

describe('staff launcher wiring — current-surface marking (AC3, WR-001)', () => {
  it('marks the surface actually being rendered, with NOTHING prop-drilled in', async () => {
    const user = userEvent.setup()
    renderLauncherAt('/staff/probe-a')

    await user.click(screen.getByTestId('staff-header-lockup'))

    // WR-001: `currentPath` was a prop no production caller ever supplied, so
    // this marking was unreachable outside tests that passed it themselves.
    const current = screen.getByRole('menuitem', { name: /probe a/i })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('aria-disabled', 'true')
    // Never color-only (NFR-001): an icon plus the word "Current".
    expect(within(current).getByText('Current')).toBeInTheDocument()
  })

  it('follows the route: on the OTHER surface, the OTHER entry is the current one', async () => {
    const user = userEvent.setup()
    renderLauncherAt('/staff/probe-b')

    await user.click(screen.getByTestId('staff-header-lockup'))

    // The non-vacuity half: a hard-coded or stale path would fail here, and
    // "nothing is ever marked" would fail the case above.
    expect(screen.getByRole('menuitem', { name: /probe b/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('menuitem', { name: /probe a/i })).not.toHaveAttribute('aria-current')
  })
})
