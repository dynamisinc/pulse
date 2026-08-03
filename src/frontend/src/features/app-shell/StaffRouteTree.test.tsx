/**
 * features/app-shell/StaffRouteTree.test.tsx
 * ---------------------------------------------------------------------------
 * The nested staff route tree in isolation: deep-linking, `allowedRoles` gating,
 * the unknown-path fallback (to the role's DEFAULT surface, never `/login`), and
 * per-route focus management (NFR-001).
 *
 * The tree is mounted under a SPLAT route, exactly as `routes.tsx` mounts it —
 * a descendant `<Routes>` under a non-splat parent matches nothing, so getting
 * this wrong in the app would silently blank every staff surface.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { faClipboardCheck, faGear, faSliders } from '@fortawesome/free-solid-svg-icons'
import { describe, it, expect } from 'vitest'
import { StaffRouteTree } from './StaffRouteTree'
import type { StaffRouteRegistry, StaffSurfaceRole } from './staffRouting'

const REGISTRY: StaffRouteRegistry = [
  {
    id: 'planner-workspace',
    path: '/staff/plan',
    label: 'Exercise Settings',
    icon: faGear,
    element: <div data-testid="surface-plan" />,
    allowedRoles: ['planner'],
    isDefaultFor: ['planner'],
    group: 'plan',
  },
  {
    id: 'controller-console',
    path: '/staff/console',
    label: 'Controller Console',
    icon: faSliders,
    element: <div data-testid="surface-console" />,
    allowedRoles: ['controller'],
    isDefaultFor: ['controller'],
    group: 'conduct',
  },
  {
    id: 'evaluator-dashboard',
    path: '/staff/evaluate',
    label: 'Evaluator Dashboard',
    icon: faClipboardCheck,
    element: <div data-testid="surface-evaluate" />,
    allowedRoles: ['evaluator'],
    isDefaultFor: ['evaluator'],
    group: 'evaluate',
  },
  {
    id: 'timeline-explorer',
    path: '/staff/timeline',
    label: 'Timeline Explorer',
    icon: faClipboardCheck,
    element: <div data-testid="surface-timeline" />,
    allowedRoles: ['controller', 'evaluator'],
    group: 'evaluate',
  },
]

/** Reports the router's live pathname so redirects are observable. */
function LocationProbe() {
  return <div data-testid="pathname">{useLocation().pathname}</div>
}

function renderTree(role: StaffSurfaceRole, defaultPath: string, initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/login"
          element={<div data-testid="login-sentinel" />}
        />
        <Route
          path="*"
          element={(
            <StaffRouteTree
              routes={REGISTRY}
              role={role}
              defaultPath={defaultPath}
            />
          )}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StaffRouteTree — deep links', () => {
  it('renders the requested surface directly when the role may open it', () => {
    renderTree('evaluator', '/staff/evaluate', '/staff/evaluate')

    expect(screen.getByTestId('surface-evaluate')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/evaluate')
  })

  it('renders a shared surface for each role that is allowed on it', () => {
    renderTree('controller', '/staff/console', '/staff/timeline')
    expect(screen.getByTestId('surface-timeline')).toBeInTheDocument()

    renderTree('evaluator', '/staff/evaluate', '/staff/timeline')
    expect(screen.getAllByTestId('surface-timeline').length).toBeGreaterThan(0)
  })
})

describe('StaffRouteTree — role gating (allowedRoles is the only gate)', () => {
  it('does NOT render a surface the role is not allowed to open', () => {
    renderTree('controller', '/staff/console', '/staff/plan')

    expect(screen.queryByTestId('surface-plan')).not.toBeInTheDocument()
    expect(screen.getByTestId('surface-console')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
  })

  it('sends a planner off the controller console to their own default surface', () => {
    renderTree('planner', '/staff/plan', '/staff/console')

    expect(screen.queryByTestId('surface-console')).not.toBeInTheDocument()
    expect(screen.getByTestId('surface-plan')).toBeInTheDocument()
  })
})

describe('StaffRouteTree — unknown paths fall back to the role default, never to /login', () => {
  it.each(['/staff', '/staff/does-not-exist', '/', '/console', '/staff/plan/nested'])(
    'redirects %s to the role default surface',
    path => {
      renderTree('controller', '/staff/console', path)

      expect(screen.getByTestId('surface-console')).toBeInTheDocument()
      expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
      // A signed-in controller who mistypes must not be bounced to sign-in.
      expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    },
  )
})

describe('StaffRouteTree — adding a surface is ONE registry entry', () => {
  it('routes a surface the routing glue has never heard of', () => {
    // The behavioural half of `registryIsTheOnlySeam.test.ts`: a surface invented
    // entirely in this test — no edit to StaffRouteTree, RoleAwareEntry or
    // routes.tsx — deep-links, gates on its own allowedRoles, and focuses.
    const withNewSurface: StaffRouteRegistry = [
      ...REGISTRY,
      {
        id: 'inject-queue',
        path: '/staff/injects',
        label: 'Inject Queue',
        icon: faGear,
        element: <div data-testid="surface-injects" />,
        allowedRoles: ['controller'],
        group: 'conduct',
      },
    ]

    render(
      <MemoryRouter initialEntries={['/staff/injects']}>
        <Routes>
          <Route
            path="*"
            element={(
              <StaffRouteTree
                routes={withNewSurface}
                role="controller"
                defaultPath="/staff/console"
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('surface-injects')).toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute(
      'data-app-shell-focus-scope',
      'staff:inject-queue',
    )
  })
})

describe('StaffRouteTree — focus management (NFR-001)', () => {
  it('moves focus to the mounted surface, keyed by ROUTE id', () => {
    renderTree('evaluator', '/staff/evaluate', '/staff/evaluate')

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toHaveAttribute(
      'data-app-shell-focus-scope',
      'staff:evaluator-dashboard',
    )
  })

  it('labels the focus scope with the surface label, so the landing is announced', () => {
    renderTree('controller', '/staff/console', '/staff/console')

    expect(document.activeElement).toHaveAttribute('aria-label', 'Controller Console')
  })
})
