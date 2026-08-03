/**
 * App.tsx
 * ---------------------------------------------------------------------------
 * Root application component (integration glue — see D7-009 / D0 §2 "two
 * worlds"). This is the ONE place the router, React Query, and the toast layer
 * are assembled, and it is deliberately THEME-FREE at the root: there is no
 * ancestor `<ThemeProvider theme={cobraTheme}>`, so the COBRA staff look is
 * PHYSICALLY UNREACHABLE unless a route subtree mounts it itself. That split is
 * the structural half of the D0 §2 two-worlds thumbnail gate.
 *
 * Routing (Phase B2, app-shell/01 — COR-004/COR-005): the five flat routes were
 * replaced by a ROLE-AWARE entry (`createRoleAwareRoutes`). A `*` catch-all
 * mounts `ExerciseContextProvider > SessionProvider > RoleAwareEntry` (the
 * providers are hoisted there, once), which decides the WORLD from the RESOLVED
 * role/scope — never a typed path, never a client-supplied `exerciseId`:
 * - participant/PIO → the per-brand participant surface, wrapped in
 *   `ParticipantLandingGuard` (exercise-isolation/04). COBRA-FREE by
 *   construction — the surface passed here has no `cobraTheme` ancestor — and
 *   completely LOCATION-BLIND: a participant typing `/staff/console` still gets
 *   their participant surface (COR-004), because that branch never reads the URL.
 * - staff (controller/evaluator/planner) → a NESTED staff route tree over
 *   `STAFF_ROUTE_REGISTRY` (`@/features/staff`), mounted inside the COBRA
 *   hand-off next to the cross-exercise `ExerciseSwitcher` (exercise-isolation/05).
 *   Staff surfaces are real deep links (`/staff/plan`, `/staff/console`,
 *   `/staff/evaluate`); an unknown or role-unauthorized staff path redirects to
 *   that role's DEFAULT surface (not to `/login` — a signed-in controller who
 *   mistypes should land on their console). A staff role the registry has
 *   nothing for still fails closed.
 * - unresolved / expired / unsupported → fail closed to `/login`, which
 *   `createRoleAwareRoutes` mounts as the real `ParticipantSignInPage` (feature:
 *   login; see `docs/features/login/`), with a linked `/staff/login`
 *   (`StaffSignInPage`) for the staff minority.
 *
 * WHY THE CATCH-ALL IS NOT A FLAT ROUTE TABLE: flattening `/staff/*` into
 * sibling routes of `*` would make the URL, not the role, decide the world — and
 * a participant typing a staff path would then match a staff route. The single
 * catch-all is the COR-004 guarantee; staff URLs are matched one level deeper,
 * after the role has already chosen the world.
 *
 * WHERE STAFF SURFACES ARE DECLARED: `@/features/staff/staffRouteRegistry` — one
 * entry per surface (`id/path/label/icon/element/allowedRoles/group`). This file
 * no longer defines staff route compositions; each lives with its own feature
 * (`ControllerConsoleRoute`, `EvaluatorDashboardRoute`, `PlannerWorkspaceRoute`),
 * so the registry can import them without an `App.tsx` import cycle. The two that
 * used to be defined here are re-exported below, unchanged, for their existing
 * consumers.
 *
 * EXACTLY ONE `ExerciseContextProvider` IS MOUNTED, EVER (CR-001). It is hoisted
 * into the `*` catch-all by `createRoleAwareRoutes`, above BOTH worlds. The three
 * staff route compositions used to mount their own as well ("a benign re-resolve
 * of the same host/auth-resolved scope"); they no longer do. Once the scope
 * became re-resolvable at runtime (`useExerciseScopeRefresh`,
 * staff-navigation/04) that nesting was actively harmful: the cross-exercise
 * switcher is a SIBLING of the staff route tree, so it refreshes the HOISTED
 * provider, and because that refresh commits atomically without a remount, an
 * inner provider would go on serving the pre-switch exercise name over
 * post-switch data. The participant surface is likewise passed
 * provider-stripped, so exactly one Session/ExerciseContext resolves on either
 * path.
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/core/services/queryClient'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { BrandThemeProvider } from './features/participant-shell/BrandThemeProvider'
import { ShellLayout } from './features/participant-shell/ShellLayout'
import { ParticipantLandingGuard } from '@/features/participant-shell'
import { SocialChannel } from './features/social'
import { ExerciseSwitcherSlot, STAFF_ROUTE_REGISTRY } from '@/features/staff'
import { createRoleAwareRoutes } from './features/app-shell'

// The two staff route compositions this file used to define now live with their
// own features (see the header: the registry has to import them, and cannot
// import from the module that imports the registry). Re-exported here so their
// existing consumers keep working against the same component identities.
export { EvaluatorDashboardRoute } from '@/features/evaluator'
export { PlannerWorkspaceRoute } from '@/features/planner'

// The single shared query client + its defaults now live in
// `@/core/services/queryClient` so non-component code (core/auth/endSession)
// can clear the cache on logout against the SAME instance this provider mounts.

// Role-aware route table (app-shell/01). Replaces the five flat routes: the
// catch-all mounts RoleAwareEntry (behind hoisted Session/ExerciseContext
// providers), which decides the WORLD from the resolved role and then — for
// staff only — routes on the URL through the injected staff route registry. The
// concrete cross-world leaves — the participant guard (exercise-isolation/04),
// the staff switcher (exercise-isolation/05), and the staff registry — are
// injected here (App.tsx is the one place concrete cross-world wiring lives;
// RoleAwareEntry stays world-neutral).
const router = createBrowserRouter(
  createRoleAwareRoutes({
    // Provider-stripped (Session/ExerciseContext are hoisted by createRoleAwareRoutes);
    // COBRA-free by construction — the only theme here is the per-brand skin.
    participantSurface: (
      <BrandThemeProvider>
        <ShellLayout>
          <SocialChannel />
        </ShellLayout>
      </BrandThemeProvider>
    ),
    // Every staff surface, declared once (`@/features/staff/staffRouteRegistry`).
    // Adding a staff surface is an edit THERE, not here — this composition root
    // never grows a route per surface again.
    staffRoutes: STAFF_ROUTE_REGISTRY,
    participantGuard: ParticipantLandingGuard,
    // Visibility-gated: the switcher only appears above the staff console when
    // the caller has >1 exercise to switch between (see ExerciseSwitcherSlot);
    // a single-exercise staff member gets a clean console (the header identity
    // badge already shows their exercise).
    staffSwitcher: <ExerciseSwitcherSlot />,
  }),
)

/**
 * Root application component.
 *
 * Holds ONLY the app-wide, world-neutral providers: React Query, the router,
 * and toasts. The COBRA staff theme is deliberately NOT here — it is scoped to
 * staff surfaces via `<StaffShellFrame>` (mounted inside the staff route
 * compositions + the role-aware staff hand-off), and participant routes mount
 * their own per-brand theme. This split makes the staff look unreachable from
 * participant paths (D0 §2 two-worlds gate).
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </QueryClientProvider>
  )
}

export default App
