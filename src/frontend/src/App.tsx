/**
 * App.tsx
 * ---------------------------------------------------------------------------
 * Root application component (integration glue — see D7-009 / D0 §2 "two
 * worlds"). This is the ONE place the router, React Query, and the toast
 * layer are assembled, and it is deliberately THEME-FREE at the root: there
 * is no ancestor `<ThemeProvider theme={cobraTheme}>` here any more, so COBRA
 * is physically unreachable unless a route subtree mounts it itself.
 *
 * - The staff route (`/evaluator`) mounts the real staff shell —
 *   `ExerciseContextProvider` (exercise scope) > `ToolstripProvider` (the
 *   toolstrip registry) > `StaffShellFrame` (the ONE place that mounts
 *   `<ThemeProvider theme={cobraTheme}>`, see that component's own header).
 *   `StaffHeader` fills the frame's `header` slot and `Toolstrip` fills its
 *   `toolstrip` slot; the "Preview as participant" button is rendered
 *   inert (no `onTogglePreview`) — story 04 wires the real behavior later.
 * - `/` and `*` are scaffold/utility pages, not participant fiction, but
 *   they DO use COBRA components (`CobraPrimaryButton`, `CobraStyles`) for
 *   convenience — each wraps itself in its own local `CobraThemed` helper so
 *   COBRA still only ever mounts where a route explicitly asks for it.
 * - PARTICIPANT ROUTES (social, portal, news, press, weather) are NOT built
 *   yet. When they land, they mount their OWN per-brand theme within their
 *   own route subtree — NEVER `cobraTheme` — so COBRA stays physically
 *   unreachable from any participant path (two-worlds hard gate, D7-009).
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { Box, Typography } from '@mui/material'
import { ToastContainer } from 'react-toastify'
import type { ReactNode } from 'react'
import 'react-toastify/dist/ReactToastify.css'

import { cobraTheme } from './theme/cobraTheme'
import { CobraPrimaryButton } from './theme/styledComponents'
import CobraStyles from './theme/CobraStyles'
import { HomePage } from './features/home'
import { EvaluatorDashboardPage } from './features/evaluator'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { ParticipantAdminFlyout } from '@/features/staffShell/components/ParticipantAdminFlyout'
import { PreviewProvider, usePreview } from '@/features/staffShell/previewContext'
import { PreviewAsParticipant } from '@/features/staffShell/components/PreviewAsParticipant'

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
 * theme boundary, so the root stays theme-free and COBRA only ever mounts
 * where a route explicitly asks for it.
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

/**
 * The staff shell composition for the Evaluator Dashboard: exercise scope >
 * toolstrip registry > preview toggle > the real `StaffShellFrame` (which
 * mounts COBRA itself). See module header.
 */
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
  { path: '/', element: <CobraThemed><HomePage /></CobraThemed> },
  // Staff surface (COBRA, mounted inside StaffShellFrame — see module header).
  { path: '/evaluator', element: <EvaluatorDashboardRoute /> },
  // PARTICIPANT ROUTE SUBTREE MOUNTS HERE (future) — its own per-brand theme,
  // never `cobraTheme` (D7-009 two-worlds hard gate).
  { path: '*', element: <CobraThemed><NotFoundPage /></CobraThemed> },
])

/**
 * Root application component.
 *
 * Theme-free at the root: provides React Query, the router, and toasts only.
 * Each route subtree is responsible for mounting its own theme (COBRA for
 * staff surfaces via `StaffShellFrame`; a per-brand theme for participant
 * surfaces once they land) — see module header.
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
