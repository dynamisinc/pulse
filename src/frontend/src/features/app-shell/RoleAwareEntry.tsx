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
 *   controller /        -> the matching staff surface (console / evaluator /
 *   evaluator / planner    …), mounted inside a COBRA hand-off boundary next to
 *                          the cross-exercise switcher (`exercise-isolation/05`,
 *                          COR-005). Staff-only; impossible on a participant path.
 *   expired /            -> fail closed to the login entry (never a default
 *   unsupported role       surface, never a cross-world surface).
 *   unresolved            -> the providers above this component fail closed to
 *                            null; the RootFailClosedBoundary additionally
 *                            redirects to the login entry if a hook throws.
 *
 * ## Two worlds (D0 §2) — world-neutral until the hand-off
 * RoleAwareEntry itself is world-neutral: it imports NO COBRA and NO brand skin
 * for the participant path. The COBRA theme is mounted ONLY inside
 * `StaffWorldHandoff`, i.e. only on the staff branch, for the switcher chrome
 * that lives OUTSIDE the staff surface's own `StaffShellFrame`. The participant
 * branch has no `ThemeProvider(cobraTheme)` anywhere above it — the skin comes
 * entirely from the injected participant surface (its own `BrandThemeProvider`).
 *
 * ## Inversion of control (why the surfaces + guard + switcher are props)
 * The concrete route compositions live in the composition root (`App.tsx`): the
 * participant surface is inline (`BrandThemeProvider` -> `ShellLayout` ->
 * channel), and `EvaluatorDashboardRoute` is defined and exported by `App.tsx`
 * itself. The two composed seams — `ParticipantLandingGuard`
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
 * On every role/route change `RouteFocusScope` moves focus to the top of the
 * newly-entered surface (a programmatic-only `tabIndex={-1}` container), so
 * focus is never lost to `<body>`. The surfaces keep their own landmarks; this
 * scope does not add a competing `<main>`.
 */

import { Component, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import {
  useSession,
  useRole,
  isParticipantRole,
  isStaffRole,
  isSessionExpired,
} from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import { cobraTheme } from '@/theme/cobraTheme'
import { LOGIN_PATH } from './constants'

/** The staff roles that map to a built staff surface (controller/evaluator/planner). */
export type StaffSurfaceRole = 'controller' | 'evaluator' | 'planner'

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
   * The concrete staff route compositions, keyed by staff role. Each is a
   * self-contained COBRA surface (it mounts its own `StaffShellFrame`). A role
   * with no entry here fails closed (a staff person with no built surface never
   * silently lands on the wrong one).
   */
  staffSurfaces: Partial<Record<StaffSurfaceRole, ReactNode>>
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
 * A programmatic-only focus target that moves focus to the top of the surface
 * whenever `focusKey` changes (i.e. on a role/route change), so focus is never
 * stranded on `<body>` (NFR-001). Deliberately world-neutral: a plain `<div>`
 * with inline styles (no MUI, no theme) so it is safe to wrap either world. It
 * carries NO landmark role — the surfaces own their own `<main>`/regions.
 */
function RouteFocusScope({
  focusKey,
  label,
  children,
}: {
  focusKey: string
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [focusKey])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      data-app-shell-focus-scope={focusKey}
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  )
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
  staffSurfaces,
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
    return (
      <RouteFocusScope
        focusKey="participant"
        label="Participant home"
      >
        <ParticipantGuard>{participantSurface}</ParticipantGuard>
      </RouteFocusScope>
    )
  }

  if (isStaffRole(role)) {
    // The literal narrowing lets us index the role-keyed surface map without a
    // cast; STAFF_ROLES === these three surface roles (core/auth/roles.ts).
    const surface =
      role === 'controller' || role === 'evaluator' || role === 'planner'
        ? staffSurfaces[role]
        : undefined
    if (surface === undefined) {
      return <Navigate to={LOGIN_PATH} replace />
    }
    return (
      <RouteFocusScope
        focusKey={`staff:${role}`}
        label="Staff workspace"
      >
        <StaffWorldHandoff>
          {staffSwitcher}
          {surface}
        </StaffWorldHandoff>
      </RouteFocusScope>
    )
  }

  // orgAdmin (a separate surface family, roles.ts) or any unexpected role:
  // fail closed. Never a default surface, never a cross-world surface (XC-002).
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
