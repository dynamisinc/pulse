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
 * Route worlds:
 * - Staff surface (`/evaluator`) — the real staff shell: `ExerciseContextProvider`
 *   (exercise scope) > `ToolstripProvider` (toolstrip registry) > `PreviewProvider`
 *   (preview toggle) > `StaffShellFrame`, which is the ONE place that mounts
 *   `<ThemeProvider theme={cobraTheme}>` (see that component's own header).
 *   `StaffHeader`/`Toolstrip` fill its slots; the shell-global participant-admin
 *   flyout and the read-only preview stage are wired via `EvaluatorStaffShell`.
 * - Staff surface (`/console`) — the E7 Simcell Operator controller console:
 *   `ExerciseContextProvider > ToolstripProvider > ActivePersonaProvider >
 *   StaffShellFrame` with `ControllerConsole` as the work-area child. The console
 *   posts as a persona through the shipped `createPost` pipeline; the published
 *   post lands in the participant feed (`/shell`) via the shared `postStore`, with
 *   the controller origin never participant-visible (see `ControllerConsoleRoute`).
 * - Participant surface (`/shell`) — the fiction: exercise scope > bound session
 *   > per-exercise `BrandThemeProvider` > `ShellLayout` (compliance chrome, alert
 *   bar, channel nav, overlay) > the `SocialChannel` (E2, the default channel).
 *   COBRA-free BY CONSTRUCTION — there is no `cobraTheme` above it, so the staff
 *   look cannot leak in by inheritance.
 * - Scaffold/utility pages (`/` home, `*` 404) — not participant fiction, but
 *   they use COBRA components, so each wraps itself in a local `CobraThemed`
 *   boundary. COBRA still only ever mounts where a route explicitly asks for it.
 *
 * The E2 social channel (`SocialChannel`) is mounted as the shell's default
 * channel; additional participant brands mount their own per-brand theme within
 * their own route subtree — NEVER `cobraTheme`.
 */
import type { ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { Box, Typography } from '@mui/material'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { cobraTheme } from './theme/cobraTheme'
import { CobraPrimaryButton } from './theme/styledComponents'
import CobraStyles from './theme/CobraStyles'
import { HomePage } from './features/home'
import { EvaluatorDashboardPage } from './features/evaluator'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { ParticipantAdminFlyout } from '@/features/staffShell/components/ParticipantAdminFlyout'
import { PreviewProvider, usePreview } from '@/features/staffShell/previewContext'
import { PreviewAsParticipant } from '@/features/staffShell/components/PreviewAsParticipant'
import { BrandThemeProvider } from './features/participant-shell/BrandThemeProvider'
import { ShellLayout } from './features/participant-shell/ShellLayout'
import { SocialChannel } from './features/social'
import { ControllerConsoleRoute } from './features/controller'

// Sensible React Query defaults. Real-time feeds will lean on a live transport
// rather than refetch-on-focus (see D0 §4 - burst legibility, 120 posts/min).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * Wraps a scaffold/utility page (never participant fiction) in its own COBRA
 * theme boundary, so the root stays theme-free and COBRA only ever mounts where
 * a route explicitly asks for it. Real staff SURFACES do NOT use this — they
 * render `<StaffShellFrame>`, which owns its own COBRA boundary.
 */
function CobraThemed({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={cobraTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

const NotFoundPage = () => (
  <Box sx={{ padding: CobraStyles.Padding.MainWindow }}>
    <Typography variant="h4" gutterBottom>
      404 - Not Found
    </Typography>
    <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
      The page you're looking for doesn't exist.
    </Typography>
    <CobraPrimaryButton onClick={() => { window.location.href = '/' }}>
      Go to Home
    </CobraPrimaryButton>
  </Box>
)

/**
 * The participant route subtree — COBRA-free BY CONSTRUCTION. There is no
 * `ThemeProvider(cobraTheme)` above it (the root is theme-free); the stack is
 * exercise scope (fail-closed) → bound session (COR-012 — the identity the
 * social channel composes/attributes posts and stamps view telemetry with) →
 * per-exercise brand skin → the shell (compliance chrome, alert bar, channel
 * nav, overlay layer) → the mounted channel. The E2 `SocialChannel` is the
 * shell's default channel (Wave S2). This is the participant half of the
 * D0 §2 two-worlds rule.
 */
function ParticipantShellRoute() {
  return (
    <ExerciseContextProvider>
      <SessionProvider>
        <BrandThemeProvider>
          <ShellLayout>
            <SocialChannel />
          </ShellLayout>
        </BrandThemeProvider>
      </SessionProvider>
    </ExerciseContextProvider>
  )
}

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
export const EvaluatorDashboardRoute = () => (
  <ExerciseContextProvider>
    <ToolstripProvider>
      <PreviewProvider>
        <EvaluatorStaffShell />
      </PreviewProvider>
    </ToolstripProvider>
  </ExerciseContextProvider>
)

const router = createBrowserRouter([
  // Scaffold/utility pages — COBRA-using, wrapped in their own theme boundary.
  { path: '/', element: <CobraThemed><HomePage /></CobraThemed> },
  // Staff surface (COBRA) — the real staff shell owns its own COBRA boundary.
  { path: '/evaluator', element: <EvaluatorDashboardRoute /> },
  // Staff surface (COBRA) — the E7 Simcell Operator controller console.
  { path: '/console', element: <ControllerConsoleRoute /> },
  // Participant surface (the fiction) — per-brand skin, no COBRA anywhere above it.
  { path: '/shell', element: <ParticipantShellRoute /> },
  { path: '*', element: <CobraThemed><NotFoundPage /></CobraThemed> },
])

/**
 * Root application component.
 *
 * Holds ONLY the app-wide, world-neutral providers: React Query, the router,
 * and toasts. The COBRA staff theme is deliberately NOT here — it is scoped to
 * staff surfaces via `<StaffShellFrame>` (and the `CobraThemed` scaffold
 * wrapper), and participant routes mount their own per-brand theme
 * (`ParticipantShellRoute`). This split makes the staff look unreachable from
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
