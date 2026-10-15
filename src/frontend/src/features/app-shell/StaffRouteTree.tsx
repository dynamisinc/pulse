/**
 * features/app-shell/StaffRouteTree.tsx
 * ---------------------------------------------------------------------------
 * The NESTED STAFF ROUTE TREE — the only place in the app-shell that reads the
 * browser location (feature: app-shell, extends story 01; COR-004/COR-005,
 * NFR-001).
 *
 * ## Where it sits
 *
 *   `*` catch-all (routes.tsx)
 *     > ExerciseContextProvider > SessionProvider
 *       > RoleAwareEntry            ← decides the WORLD from the resolved role
 *         ├─ participant / pio  →  the participant surface, LOCATION-BLIND
 *         └─ staff              →  COBRA hand-off > switcher > **this tree**
 *
 * The catch-all is deliberately NOT flattened into a route table. Participants
 * have no UI concept of exercise selection and must not route on a typed path
 * (COR-004): a participant typing `/staff/console` still lands on their
 * participant surface, because the participant branch above never reaches this
 * component and never reads the URL. This tree only ever mounts once the
 * resolved role is a staff role — the URL becomes meaningful *after* the role
 * has already decided the world, never before.
 *
 * ## What it does
 *  - registers ONE `<Route>` per registry entry the role is ALLOWED to open
 *    (`allowedRoles` is the single gate);
 *  - registers the path of every entry the role is NOT allowed to open to the
 *    COBRA `StaffNotAllowedPage` (demo-feedback story 15, DF-20): "You need the
 *    … role to open …" plus a button to the role's own default page. The
 *    refused surface's element is never rendered — only its label and
 *    `allowedRoles` are read. Before DF-20 these paths silently redirected,
 *    which left a controller at `/staff/exercises` on the console with no
 *    explanation;
 *  - sends every other path — unknown, misspelt, or bare `/staff` — to the
 *    role's DEFAULT surface via a replacing redirect. NOT to `/login`: a
 *    signed-in controller who types a bad path should land on their console,
 *    not be bounced to sign-in;
 *  - wraps each surface, and each not-allowed page, in a per-route
 *    `RouteFocusScope`, so moving between staff paths moves focus to the new
 *    content instead of stranding it on `<body>` (NFR-001).
 *
 * ## Descendant-`<Routes>` contract
 * This renders a DESCENDANT `<Routes>`, which react-router matches relative to
 * the enclosing route's `pathnameBase`. The enclosing route is the root `*`
 * catch-all, whose base is `/`, so registry paths are registered via
 * `toDescendantRoutePath()` (`/staff/console` → `staff/console`). Mounting this
 * component under a non-splat route would make react-router warn and match
 * nothing — tests mount it under `path="*"` for exactly that reason.
 *
 * World: routing glue, staff side. The COBRA boundary is mounted by
 * `RoleAwareEntry`'s staff hand-off ABOVE this component; this file imports no
 * theme and no concrete surface (the registry is injected). Its one rendered
 * page of its own, `StaffNotAllowedPage`, is COBRA and staff-only — this tree
 * never mounts on the participant branch.
 */

import { Navigate, Route, Routes } from 'react-router-dom'
import { RouteFocusScope } from './RouteFocusScope'
import { StaffNavigationProvider } from './staffNavigationContext'
import { StaffNotAllowedPage } from './StaffNotAllowedPage'
import {
  isStaffRouteAllowed,
  staffRoutesForRole,
  toDescendantRoutePath,
  type StaffRouteRegistry,
  type StaffSurfaceRole,
} from './staffRouting'

export interface StaffRouteTreeProps {
  /** The injected staff route registry (`@/features/staff`). */
  routes: StaffRouteRegistry
  /** The RESOLVED staff role — never read from the URL. */
  role: StaffSurfaceRole
  /**
   * Absolute path of this role's default surface, resolved by the caller with
   * `resolveDefaultStaffRoute()`. Required (not derived here) so the caller can
   * fail closed BEFORE mounting any staff chrome when the role has no surface
   * at all — and so this component can never redirect to a path it did not
   * register, which would loop.
   */
  defaultPath: string
}

export function StaffRouteTree({ routes, role, defaultPath }: StaffRouteTreeProps) {
  const allowed = staffRoutesForRole(routes, role)
  // Registered surfaces this role may NOT open: their paths get the not-allowed
  // page (DF-20) instead of falling through to the silent default redirect.
  const refused = routes.filter(entry => !isStaffRouteAllowed(entry, role))
  const homeLabel = routes.find(entry => entry.path === defaultPath)?.label

  return (
    // Publishes {registry, role} to staff chrome rendered INSIDE each surface —
    // notably `StaffHeader`'s `SurfaceLauncher`, which cannot import the
    // concrete registry without closing an import cycle. Wrapping here wires
    // every present and future surface once, instead of asking each
    // composition to forward props into its own header (see
    // `staffNavigationContext.tsx` for why prop-drilling is the wrong seam).
    <StaffNavigationProvider registry={routes} role={role}>
      <Routes>
        {allowed.map(entry => (
          <Route
            key={entry.id}
            path={toDescendantRoutePath(entry.path)}
            element={
              <RouteFocusScope
                focusKey={`staff:${entry.id}`}
                label={entry.label}
              >
                {entry.element}
              </RouteFocusScope>
            }
          />
        ))}
        {refused.map(entry => (
          <Route
            key={`not-allowed:${entry.id}`}
            path={toDescendantRoutePath(entry.path)}
            element={
              <RouteFocusScope
                focusKey={`staff:not-allowed:${entry.id}`}
                label={`Not allowed: ${entry.label}`}
              >
                <StaffNotAllowedPage
                  surfaceLabel={entry.label}
                  allowedRoles={entry.allowedRoles}
                  homePath={defaultPath}
                  homeLabel={homeLabel}
                />
              </RouteFocusScope>
            }
          />
        ))}
        {/*
          Unknown path or bare `/staff` → the role's default surface. `replace`
          so a mistyped URL does not sit in the back stack between two real
          surfaces. (A REGISTERED path this role may not open is handled above.)
        */}
        <Route
          path="*"
          element={<Navigate to={defaultPath} replace />}
        />
      </Routes>
    </StaffNavigationProvider>
  )
}
