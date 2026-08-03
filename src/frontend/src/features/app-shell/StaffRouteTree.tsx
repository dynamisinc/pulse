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
 *    (`allowedRoles` is the single gate — an unauthorized entry is simply not
 *    registered, so it cannot render, only redirect);
 *  - sends every other path — unknown, misspelt, bare `/staff`, or authorized-
 *    for-someone-else — to the role's DEFAULT surface via a replacing redirect.
 *    NOT to `/login`: a signed-in controller who types a bad path should land on
 *    their console, not be bounced to sign-in;
 *  - wraps each surface in a per-route `RouteFocusScope`, so moving between
 *    staff surfaces moves focus to the new surface instead of stranding it on
 *    `<body>` (NFR-001).
 *
 * ## Descendant-`<Routes>` contract
 * This renders a DESCENDANT `<Routes>`, which react-router matches relative to
 * the enclosing route's `pathnameBase`. The enclosing route is the root `*`
 * catch-all, whose base is `/`, so registry paths are registered via
 * `toDescendantRoutePath()` (`/staff/console` → `staff/console`). Mounting this
 * component under a non-splat route would make react-router warn and match
 * nothing — tests mount it under `path="*"` for exactly that reason.
 *
 * World: routing glue — world-neutral. The COBRA boundary is mounted by
 * `RoleAwareEntry`'s staff hand-off ABOVE this component; this file imports no
 * theme and no surface (the registry is injected).
 */

import { Navigate, Route, Routes } from 'react-router-dom'
import { RouteFocusScope } from './RouteFocusScope'
import { StaffNavigationProvider } from './staffNavigationContext'
import {
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
        {/*
          Unknown path, bare `/staff`, or a surface this role may not open → the
          role's default surface. `replace` so a mistyped URL does not sit in the
          back stack between two real surfaces.
        */}
        <Route
          path="*"
          element={<Navigate to={defaultPath} replace />}
        />
      </Routes>
    </StaffNavigationProvider>
  )
}
