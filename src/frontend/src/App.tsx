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
 * providers are hoisted there, once), which routes on the RESOLVED role/scope —
 * never a typed path, never a client-supplied `exerciseId`:
 * - participant/PIO → the per-brand participant surface, wrapped in
 *   `ParticipantLandingGuard` (exercise-isolation/04). COBRA-FREE by
 *   construction — the surface passed here has no `cobraTheme` ancestor.
 * - staff (controller/evaluator) → their COBRA surfaces (`StaffShellFrame`),
 *   with the cross-exercise `ExerciseSwitcher` (exercise-isolation/05) mounted at
 *   the staff hand-off inside `RoleAwareEntry`. A staff role with no built
 *   surface (planner, Phase 1) fails closed.
 * - unresolved / expired / unsupported → fail closed to `/login`, which
 *   `createRoleAwareRoutes` mounts as the real `ParticipantSignInPage` (feature:
 *   login; see `docs/features/login/`), with a linked `/staff/login`
 *   (`StaffSignInPage`) for the staff minority.
 *
 * The staff surfaces (`ControllerConsoleRoute` / `EvaluatorDashboardRoute`) each
 * mount their OWN `ExerciseContextProvider` — a deliberate, benign re-resolve of
 * the same host/auth-resolved scope (stripping it is more invasive than it is
 * worth, and it binds the SAME scope; no cross-exercise leak, since scope is
 * never client-supplied). The participant surface is passed provider-stripped so
 * exactly one Session/ExerciseContext resolves on the participant path.
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/core/services/queryClient'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { EvaluatorDashboardPage } from './features/evaluator'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { ParticipantAdminFlyout } from '@/features/staffShell/components/ParticipantAdminFlyout'
import { PreviewProvider, usePreview } from '@/features/staffShell/previewContext'
import { PreviewAsParticipant } from '@/features/staffShell/components/PreviewAsParticipant'
import { BrandThemeProvider } from './features/participant-shell/BrandThemeProvider'
import { ShellLayout } from './features/participant-shell/ShellLayout'
import { ParticipantLandingGuard } from '@/features/participant-shell'
import { SocialChannel } from './features/social'
import { ControllerConsoleRoute } from './features/controller'
import { ExerciseSwitcher } from '@/features/staff'
import { createRoleAwareRoutes } from './features/app-shell'

// The single shared query client + its defaults now live in
// `@/core/services/queryClient` so non-component code (core/auth/endSession)
// can clear the cache on logout against the SAME instance this provider mounts.

/**
 * Inner staff-shell composition for the Evaluator Dashboard. Reads the preview
 * toggle (`usePreview`) to drive the header's Preview-as button AND to swap the
 * work area for the read-only participant-preview stage (story 04). Renders
 * inside `PreviewProvider` + `ToolstripProvider` + `ExerciseContextProvider`
 * (see `EvaluatorDashboardRoute`).
 */
function EvaluatorStaffShell() {
  const { active: previewActive, toggle: togglePreview } = usePreview()
  return (
    <StaffShellFrame
      header={
        <StaffHeader
          surfaceName="Evaluator Dashboard"
          previewActive={previewActive}
          onTogglePreview={togglePreview}
        />
      }
      toolstrip={<Toolstrip />}
      // Shell-global participant-admin flyout (story 03). Suppressed while the
      // participant preview is staged, so it can never render above the preview
      // stage (SHELL-CONTRACT §4 / story-03 stacking note); it re-registers on
      // preview exit.
      globalOverlay={previewActive ? undefined : <ParticipantAdminFlyout />}
    >
      {previewActive ? <PreviewAsParticipant /> : <EvaluatorDashboardPage />}
    </StaffShellFrame>
  )
}

// Exported for the Integration-B wiring test (App.integration.test.tsx) — it
// renders this composition directly to prove the preview button ↔ stage swap
// and the shell-global admin flyout are wired, without standing up the router.
// It mounts its own ExerciseContextProvider (staff scope); this re-resolves the
// same scope the role-aware entry already resolved — a documented, benign
// double-resolve (see the header note), not a cross-exercise path.
export const EvaluatorDashboardRoute = () => (
  <ExerciseContextProvider>
    <ToolstripProvider>
      <PreviewProvider>
        <EvaluatorStaffShell />
      </PreviewProvider>
    </ToolstripProvider>
  </ExerciseContextProvider>
)

// Role-aware route table (app-shell/01). Replaces the five flat routes: the
// catch-all mounts RoleAwareEntry (behind hoisted Session/ExerciseContext
// providers) and routes on the resolved role. The concrete cross-world leaves —
// the participant guard (exercise-isolation/04), the staff switcher
// (exercise-isolation/05), and the surfaces — are injected here (App.tsx is the
// one place concrete cross-world wiring lives; RoleAwareEntry stays world-neutral).
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
    staffSurfaces: {
      controller: <ControllerConsoleRoute />,
      evaluator: <EvaluatorDashboardRoute />,
      // planner: no Phase-1 staff surface — omitted, so a planner session fails closed.
    },
    participantGuard: ParticipantLandingGuard,
    staffSwitcher: <ExerciseSwitcher />,
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
