/**
 * features/staffShell/components/SurfaceLauncher.test.tsx
 * ---------------------------------------------------------------------------
 * RTL coverage for docs/features/staff-navigation/02-surface-launcher.md
 * (COR-071):
 *  - a role sees EXACTLY its permitted surfaces, grouped by
 *    `STAFF_ROUTE_GROUP_ORDER` (not registry order, not alphabetical);
 *  - a surface the role is not in `allowedRoles` for is ABSENT from the
 *    DOM entirely, never a disabled-but-visible entry (`allowedRoles` is the
 *    single gate — no second list is derived anywhere in the component);
 *  - selecting an entry navigates to its registered path and closes the menu;
 *  - the current surface is `aria-current="page"`, excluded from
 *    re-navigation (disabled — a click does not call `navigate`, and it is
 *    excluded from the roving-tabindex arrow-key stops);
 *  - full keyboard operation: open via Enter/Space, arrow between items,
 *    activate with Enter, `Escape` closes AND restores focus to the trigger;
 *  - a role with at most one reachable surface (or no registry/role at all)
 *    degrades to the ORIGINAL static, non-interactive lockup — a launcher
 *    that goes nowhere is never rendered.
 *
 * A deliberately MULTI-ENTRY FIXTURE registry is used throughout (never the
 * real 3-entry `STAFF_ROUTE_REGISTRY`, which today gates every role to
 * exactly one surface and would only ever exercise the degrade path) — see
 * the story's own "Tests" section.
 */
import type { ReactElement } from 'react'
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { faClipboardCheck, faListCheck, faSliders } from '@fortawesome/free-solid-svg-icons'
import { SurfaceLauncher } from './SurfaceLauncher'
import type { StaffRouteRegistry } from '@/features/app-shell'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

/** Wraps every render in a real Router (`useNavigate` needs an ancestor). */
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: MemoryRouter })
}

/**
 * A MULTI-ENTRY fixture — TWO surfaces reachable by `controller` (in
 * different groups, and DELIBERATELY out of `STAFF_ROUTE_GROUP_ORDER` order
 * in the array itself, so a test that the launcher re-sorts by group rather
 * than trusting registry order actually proves something), and one surface
 * reachable ONLY by `evaluator` (the visibility-filter negative case).
 */
const FIXTURE_REGISTRY: StaffRouteRegistry = [
  {
    id: 'controller-console',
    path: '/staff/console',
    label: 'Controller Console',
    icon: faSliders,
    element: <div />,
    allowedRoles: ['controller'],
    group: 'conduct',
    description: 'Drive the simulated world.',
  },
  {
    id: 'inject-queue',
    path: '/staff/inject-queue',
    label: 'Inject Queue',
    icon: faListCheck,
    element: <div />,
    allowedRoles: ['controller'],
    group: 'plan',
    description: 'Manage the inject schedule.',
  },
  {
    id: 'evaluator-dashboard',
    path: '/staff/evaluate',
    label: 'Evaluator Dashboard',
    icon: faClipboardCheck,
    element: <div />,
    allowedRoles: ['evaluator'],
    group: 'evaluate',
    description: 'Observe and score the exercise.',
  },
]

beforeEach(() => {
  mockNavigate.mockReset()
})

describe('SurfaceLauncher — trigger renders as the brand lockup', () => {
  it('is a real disclosure button with aria-haspopup/aria-expanded, closed by default', () => {
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(lockup.tagName).toBe('BUTTON')
    expect(lockup).toHaveAttribute('aria-haspopup', 'menu')
    expect(lockup).toHaveAttribute('aria-expanded', 'false')
    expect(within(lockup).getByText('PULSE')).toBeInTheDocument()
    expect(within(lockup).getByText('Controller Console')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('SurfaceLauncher — a role sees exactly its permitted surfaces, grouped (AC1/AC2)', () => {
  it('lists only entries allowedRoles includes the caller for, in STAFF_ROUTE_GROUP_ORDER (not registry order)', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    await user.click(screen.getByTestId('staff-header-lockup'))

    const menu = screen.getByRole('menu', { name: 'Staff surfaces' })
    expect(within(menu).getByText('Controller Console')).toBeInTheDocument()
    expect(within(menu).getByText('Inject Queue')).toBeInTheDocument()
    // Never the surface `controller` is not in `allowedRoles` for.
    expect(within(menu).queryByText('Evaluator Dashboard')).not.toBeInTheDocument()

    // Each group carries an accessible label (never spacing/icon alone).
    expect(screen.getByRole('group', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Conduct' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Evaluate' })).not.toBeInTheDocument()

    // 'plan' precedes 'conduct' in STAFF_ROUTE_GROUP_ORDER, so "Inject Queue"
    // (plan) renders BEFORE "Controller Console" (conduct) even though it is
    // declared SECOND in the fixture's own registry array.
    const itemLabels = within(menu)
      .getAllByRole('menuitem')
      .map(item => item.textContent ?? '')
    const injectIndex = itemLabels.findIndex(text => text.includes('Inject Queue'))
    const consoleIndex = itemLabels.findIndex(text => text.includes('Controller Console'))
    expect(injectIndex).toBeGreaterThanOrEqual(0)
    expect(consoleIndex).toBeGreaterThanOrEqual(0)
    expect(injectIndex).toBeLessThan(consoleIndex)
  })

  it('a different role sees a completely different set — never a disabled-but-visible leak of a surface it cannot reach', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Evaluator Dashboard"
        registry={[
          ...FIXTURE_REGISTRY,
          {
            id: 'evaluator-annotations',
            path: '/staff/evaluate/annotations',
            label: 'Annotation Review',
            icon: faClipboardCheck,
            element: <div />,
            allowedRoles: ['evaluator'],
            group: 'evaluate',
          },
        ]}
        role="evaluator"
        currentPath="/staff/evaluate"
      />,
    )

    await user.click(screen.getByTestId('staff-header-lockup'))

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Evaluator Dashboard')).toBeInTheDocument()
    expect(within(menu).getByText('Annotation Review')).toBeInTheDocument()
    expect(within(menu).queryByText('Controller Console')).not.toBeInTheDocument()
    expect(within(menu).queryByText('Inject Queue')).not.toBeInTheDocument()
  })
})

describe('SurfaceLauncher — selecting an entry navigates and closes the menu (AC3)', () => {
  it('navigates to the selected entry\'s registered path', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    await user.click(screen.getByTestId('staff-header-lockup'))
    await user.click(screen.getByRole('menuitem', { name: /inject queue/i }))

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('/staff/inject-queue')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('SurfaceLauncher — the current surface is marked and is not a re-navigation destination (AC3)', () => {
  it('the entry matching currentPath carries aria-current="page", is rendered disabled (unclickable — never a real pointer target), and never navigates', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    await user.click(screen.getByTestId('staff-header-lockup'))

    const currentItem = screen.getByRole('menuitem', { name: /controller console/i })
    expect(currentItem).toHaveAttribute('aria-current', 'page')
    expect(currentItem).toHaveAttribute('aria-disabled', 'true')
    // Never color-only: a textual + iconographic "Current" marker.
    expect(within(currentItem).getByText('Current')).toBeInTheDocument()

    // "Not presented as a destination to re-navigate to": a real pointer
    // interaction cannot even land on it (`pointer-events: none` — the same
    // guarantee MUI gives every `disabled` MenuItem) ...
    await expect(user.click(currentItem)).rejects.toThrow(/pointer-events: none/)
    // ... and — defense in depth — even a synthetic click dispatched
    // straight at the DOM node (bypassing that pointer-events guard) still
    // triggers no navigation, because the component's own onClick is a no-op
    // for the current entry (see `handleSelect` / `isCurrentEntry`).
    fireEvent.click(currentItem)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('a non-current entry carries no aria-current attribute', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    await user.click(screen.getByTestId('staff-header-lockup'))

    const otherItem = screen.getByRole('menuitem', { name: /inject queue/i })
    expect(otherItem).not.toHaveAttribute('aria-current')
  })
})

describe('SurfaceLauncher — full keyboard operation (NFR-001)', () => {
  it('opens with Enter, moves with ArrowDown, activates the focused item with Enter, and navigates', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    const trigger = screen.getByTestId('staff-header-lockup')
    trigger.focus()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // The current entry ("Controller Console") is disabled/excluded from the
    // roving-tabindex order, so ArrowDown from the initial focus lands on the
    // next real stop — "Inject Queue" — without a second press.
    await user.keyboard('{ArrowDown}')
    const injectItem = screen.getByRole('menuitem', { name: /inject queue/i })
    expect(injectItem).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(mockNavigate).toHaveBeenCalledWith('/staff/inject-queue')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(
      <SurfaceLauncher
        surfaceName="Controller Console"
        registry={FIXTURE_REGISTRY}
        role="controller"
        currentPath="/staff/console"
      />,
    )

    const trigger = screen.getByTestId('staff-header-lockup')
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('SurfaceLauncher — single-surface role degrades to the static lockup (AC: "do not render a launcher that goes nowhere")', () => {
  it('a role that can reach only ONE registry entry renders the plain, non-interactive lockup', () => {
    render(
      <SurfaceLauncher
        surfaceName="Evaluator Dashboard"
        registry={FIXTURE_REGISTRY}
        role="evaluator"
        currentPath="/staff/evaluate"
      />,
    )

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(lockup.tagName).not.toBe('BUTTON')
    expect(lockup).not.toHaveAttribute('aria-haspopup')
    expect(within(lockup).getByText('PULSE')).toBeInTheDocument()
    expect(within(lockup).getByText('Evaluator Dashboard')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('no registry/role supplied at all (every composition today) renders the plain lockup', () => {
    render(<SurfaceLauncher surfaceName="Exercise Settings" />)

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(lockup.tagName).not.toBe('BUTTON')
    expect(within(lockup).getByText('PULSE')).toBeInTheDocument()
    expect(within(lockup).getByText('Exercise Settings')).toBeInTheDocument()
  })

  it('registry without a matching role (role omitted) also degrades, never throwing', () => {
    render(<SurfaceLauncher surfaceName="Controller Console" registry={FIXTURE_REGISTRY} />)

    expect(screen.getByTestId('staff-header-lockup').tagName).not.toBe('BUTTON')
  })
})
