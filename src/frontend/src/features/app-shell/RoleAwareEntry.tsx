/**
 * features/app-shell/RoleAwareEntry.tsx
 * ---------------------------------------------------------------------------
 * The role-aware entry (feature: app-shell, story 01; COR-004, COR-005,
 * XC-001/XC-002; see docs/features/app-shell/01-global-nav.md). This is the
 * ONE component that decides which world a browser lands in, replacing the five
 * flat, URL-typed routes with a single decision driven ONLY by the resolved
 * role/scope — never by a client-supplied path or `exerciseId` (COR-004).
 *
 * ## The decision (routes on the RESOLVED role/scope only)
 *   participant / pio  -> the participant landing surface, wrapped in the
 *                         composed participant guard (`exercise-isolation/04`).
 *                         NO exercise picker, NO staff surface reachable, and —
 *                         by construction — NO COBRA ancestor (XC-002, D0 §2).
 *   controller /        -> the NESTED STAFF ROUTE TREE (`StaffRouteTree`) over
 *   evaluator /            the injected staff route registry, mounted inside a
 *   planner / orgAdmin     COBRA hand-off boundary next to the cross-exercise
 *                          switcher (`exercise-isolation/05`, COR-005).
 *                          Staff-only; impossible on a participant path.
 *   expired /            -> fail closed to the login entry (never a default
 *   unsupported role       surface, never a cross-world surface).
 *   role with no         -> fail closed to the login entry as well: the branch
 *   registered surface      is entered, `resolveDefaultStaffRoute` finds
 *                           nothing, and NO switcher and NO COBRA are mounted.
 *   unresolved           -> the providers above this component fail closed to
 *                           null; the RootFailClosedBoundary additionally
 *                           redirects to the login entry if a hook throws.
 *
 * ## COR-076 — `orgAdmin` is a routed role, not a fourth world
 * `orgAdmin` used to fall through to the fail-closed arm below, so an org-admin
 * who signed in was bounced straight back to the login page. It now takes the
 * staff-tree branch: `isStaffSurfaceRole()` (`./staffRouting`) admits it,
 * because there is no third VISUAL world in Pulse — org administration renders
 * in COBRA like every other staff surface and is gated, like every other
 * surface, by its registry entry's `allowedRoles`. What did NOT change is
 * `core/auth/roles.ts`: `orgAdmin` is still outside `STAFF_ROLES`, because that
 * set is the XC-002 authorization boundary, not a routing table. See
 * `staffRouting.ts`'s `StaffSurfaceRole` for the full two-predicates argument.
 * The fail-closed arm below is untouched and still catches any role that is
 * genuinely unexpected.
 *
 * ## COR-004 — the participant branch is LOCATION-BLIND, mechanically
 * Staff surfaces are real, deep-linkable URLs (`/staff/console`,
 * `/staff/evaluate`, `/staff/plan`, …). Participants have none: they have no UI
 * concept of exercise selection and must not route on a typed path, so a
 * participant typing `/staff/console` still lands on their participant surface.
 * The guarantee is STRUCTURAL, not a conditional: this module imports no
 * location-reading API at all (`useLocation` / `useParams` / `useMatch` /
 * `Routes`), so the participant branch physically cannot read the URL. Every
 * location read lives in `StaffRouteTree`, which is rendered ONLY after the
 * resolved role has been narrowed to a staff role. `participantLocationBlindness
 * .test.ts` asserts that import ban against this file's real source, so
 * re-introducing a URL read on the participant path fails the suite.
 *
 * ## Two worlds (D0 §2) — world-neutral until the hand-off
 * RoleAwareEntry itself is world-neutral: it imports NO COBRA and NO brand skin
 * for the participant path. The COBRA theme is mounted ONLY inside
 * `StaffWorldHandoff`, i.e. only on the staff branch, for the switcher chrome
 * that lives OUTSIDE the staff surface's own `StaffShellFrame`. The participant
 * branch has no `ThemeProvider(cobraTheme)` anywhere above it — the skin comes
 * entirely from the injected participant surface (its own `BrandThemeProvider`).
 *
 * ## Inversion of control (why the registry + guard + switcher are props)
 * The concrete participant surface is composed in the composition root
 * (`App.tsx`, inline `BrandThemeProvider` -> `ShellLayout` -> channel), and the
 * concrete STAFF surfaces are declared once in the staff-world registry
 * (`@/features/staff/staffRouteRegistry`) which `App.tsx` injects here. The two
 * composed seams — `ParticipantLandingGuard`
 * (exercise-isolation/04) and `ExerciseSwitcher` (exercise-isolation/05) — ship
 * on sibling branches and are NOT resolvable on this branch. So all of these are
 * INJECTED as props and wired by the orchestrator in `App.tsx` (the integration
 * seam). RoleAwareEntry still owns the security-relevant COMPOSITION the ACs
 * require: it wraps the participant surface in the guard, mounts the switcher +
 * COBRA hand-off around the staff surface, manages focus, and fails closed. The
 * contract-first imports of the two composed seams live where they belong — the
 * orchestrator's `App.tsx` edit — and resolve at integration (see routes.tsx /
 * this feature's README).
 *
 * ## Accessibility (NFR-001)
 * On every world change `RouteFocusScope` moves focus to the top of the
 * newly-entered surface (a programmatic-only `tabIndex={-1}` container), so
 * focus is never lost to `<body>`. On the staff side the scope is per-ROUTE
 * (inside `StaffRouteTree`), so navigating between staff surfaces re-focuses
 * too. The surfaces keep their own landmarks; this scope does not add a
 * competing `<main>`.
 */

import { Component, type ComponentType, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import {
  useSession,
  useRole,
  isParticipantRole,
  isSessionExpired,
} from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import { cobraTheme } from '@/theme/cobraTheme'
import { LOGIN_PATH } from './constants'
import { RouteFocusScope } from './RouteFocusScope'
import { StaffRouteTree } from './StaffRouteTree'
import {
  isStaffSurfaceRole,
  resolveDefaultStaffRoute,
  type StaffRouteRegistry,
} from './staffRouting'

export interface RoleAwareEntryProps {
  /**
   * The RAW participant landing surface (e.g. `BrandThemeProvider` ->
   * `ShellLayout` -> channel). RoleAwareEntry wraps it in the injected
   * `participantGuard`. It must NOT include a COBRA ancestor and must NOT
   * re-mount `SessionProvider`/`ExerciseContextProvider` (those are hoisted above
   * this entry by `routes.tsx`).
   */
  participantSurface: ReactNode
  /**
   * The STAFF ROUTE REGISTRY — the one declared table of staff surfaces
   * (`@/features/staff/staffRouteRegistry`), injected by the orchestrator. Each
   * entry is a self-contained COBRA surface (it mounts its own
   * `StaffShellFrame`) plus the metadata that gates it (`allowedRoles`) and will
   * later section it in a launcher (`group`). A role with NO entry it may open
   * fails closed to the login entry — a staff person with no built surface never
   * silently lands on someone else's.
   */
  staffRoutes: StaffRouteRegistry
  /**
   * The composed participant landing guard (`exercise-isolation/04`) — a
   * children-wrapping component that renders its children only for a resolved,
   * non-expired participant/PIO session and otherwise fails closed to the login
   * entry. Injected by the orchestrator from `@/features/participant-shell` so
   * this world-neutral glue never imports a not-yet-merged sibling module.
   */
  participantGuard: ComponentType<{ children: ReactNode }>
  /**
   * The composed cross-exercise switcher (`exercise-isolation/05`) — a COBRA
   * staff-only control. Injected by the orchestrator from `@/features/staff`
   * (as an element), rendered ONLY on the staff branch under the COBRA hand-off.
   */
  staffSwitcher: ReactNode
}

/**
 * The staff-world hand-off. Mounts the COBRA theme (the ONLY place this
 * component touches COBRA) so the cross-exercise switcher — a COBRA staff-only
 * control that sits OUTSIDE the staff surface's own `StaffShellFrame` — is
 * themed. The mounted staff surface re-mounts its own COBRA boundary inside
 * `StaffShellFrame`; nested `ThemeProvider`s are harmless (the inner theme
 * wins). NEVER rendered on the participant branch.
 */
function StaffWorldHandoff({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
}

/**
 * Reads the resolved session/role/scope and returns the surface for that role.
 * Split out from `RoleAwareEntry` so the `RootFailClosedBoundary` can wrap it:
 * an unresolved session/scope makes `useSession()`/`useExerciseContext()` throw,
 * which the boundary turns into a fail-closed redirect to the login entry.
 */
function RoleRouter({
  participantSurface,
  staffRoutes,
  participantGuard: ParticipantGuard,
  staffSwitcher,
}: RoleAwareEntryProps) {
  // Routes on the RESOLVED session/scope ONLY (COR-004) — there is no
  // client-supplied exerciseId anywhere here. A missing/unresolved session or
  // scope throws (fail-closed) and is caught by RootFailClosedBoundary.
  const session = useSession()
  useExerciseContext() // enforce a resolved exercise scope before routing (XC-001)
  const role = useRole()

  // Defense-in-depth expiry re-check (the provider already rejects an
  // already-expired session at resolve time; a session can still cross its TTL
  // after mount). Wall-clock is correct here: session lifetime is a real-time
  // auth concern, exempt from the participant scenario-time rule and never shown
  // in-fiction (see core/auth/sessionResolver.ts). `app-shell/` is intentionally
  // outside the participant wall-clock lint ban.
  if (isSessionExpired(session, new Date())) {
    return <Navigate to={LOGIN_PATH} replace />
  }

  if (isParticipantRole(role)) {
    // LOCATION-BLIND (COR-004). Nothing on this branch consults the URL — the
    // participant gets their surface whatever they typed. See the module header.
    return (
      <RouteFocusScope
        focusKey="participant"
        label="Participant home"
      >
        <ParticipantGuard>{participantSurface}</ParticipantGuard>
      </RouteFocusScope>
    )
  }

  if (isStaffSurfaceRole(role)) {
    // Resolve the role's default surface BEFORE mounting any staff chrome: a
    // staff role the registry has nothing for fails closed to the login entry
    // with no switcher and no COBRA rendered (unchanged pre-existing behaviour),
    // and `StaffRouteTree` can never redirect to a path it did not register.
    const defaultRoute = resolveDefaultStaffRoute(staffRoutes, role)
    if (defaultRoute === undefined) {
      return <Navigate to={LOGIN_PATH} replace />
    }
    return (
      <StaffWorldHandoff>
        {staffSwitcher}
        <StaffRouteTree
          routes={staffRoutes}
          role={role}
          defaultPath={defaultRoute.path}
        />
      </StaffWorldHandoff>
    )
  }

  // Any UNEXPECTED role: fail closed. Never a default surface, never a
  // cross-world surface (XC-002).
  //
  // `orgAdmin` no longer lands here (COR-076) — it is admitted by
  // `isStaffSurfaceRole()` above and, like every staff role, fails closed one
  // branch earlier if the registry has no surface it may open. This arm is kept
  // deliberately: `ExerciseRole` is a closed union today, so nothing should
  // reach it, but a role string that ever escapes `isExerciseRole()` validation
  // (a hand-edited session, a backend-ahead deploy) must still hit a closed
  // door rather than a default surface.
  return <Navigate to={LOGIN_PATH} replace />
}

interface RootFailClosedBoundaryProps {
  fallback: ReactNode
  children: ReactNode
}

interface RootFailClosedBoundaryState {
  failed: boolean
}

/**
 * The root fail-closed net. If resolving the routing decision throws — e.g. an
 * unresolved session/scope makes `useSession()`/`useExerciseContext()` throw —
 * this renders the fail-closed fallback (the login entry) rather than crashing
 * to a white screen or leaking a partial surface. The caught error is logged
 * (matching the providers' console-signal precedent) so a genuine bug is still
 * visible in dev, while the app fails closed in every environment.
 */
class RootFailClosedBoundary extends Component<
  RootFailClosedBoundaryProps,
  RootFailClosedBoundaryState
> {
  state: RootFailClosedBoundaryState = { failed: false }

  static getDerivedStateFromError(): RootFailClosedBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error(
      '[app-shell] routing decision failed; failing closed to the login entry',
      error,
    )
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * The role-aware entry. See the module header for the full decision and the
 * two-worlds / focus / fail-closed contracts.
 */
export function RoleAwareEntry(props: RoleAwareEntryProps) {
  return (
    <RootFailClosedBoundary fallback={<Navigate to={LOGIN_PATH} replace />}>
      <RoleRouter {...props} />
    </RootFailClosedBoundary>
  )
}
