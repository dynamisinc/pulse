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
import { BrandThemeProvider } from './features/participant-shell/BrandThemeProvider'
import { ShellLayout } from './features/participant-shell/ShellLayout'
import { useShellContext } from './features/participant-shell/mountContract'

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
 * Staff-world theme boundary. The COBRA staff theme lives HERE — wrapping only
 * staff route elements — and NOT at the app root. That is the structural half
 * of the D0 two-worlds thumbnail gate: with no `ThemeProvider(cobraTheme)` (or
 * `CssBaseline`) above the router, the COBRA look is PHYSICALLY UNREACHABLE
 * from the participant route subtree — it cannot leak in by inheritance.
 *
 * When `staff-shell` lands, `<StaffShellFrame>` (which owns the COBRA boundary)
 * replaces this wrapper; until then staff routes keep the COBRA theme here.
 */
function StaffThemeBoundary({ children }: { children: ReactNode }) {
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
 * Phase-1 placeholder channel. It exists only to prove the mount contract: it
 * reads `{variant, scenarioNow}` from `useShellContext()` — the whole of what a
 * channel receives from its container. The first real channel (E2 social)
 * replaces it. Participant-world styling only: plain React + system-ui, NO
 * COBRA / `@/theme/styledComponents` / default MUI look (D0 §2). Scenario time
 * is shown for the mount-contract demo; it is never labelled "scenario time"
 * inside real fiction (XC-002).
 */
function ParticipantChannelPlaceholder() {
  const { variant, scenarioNow } = useShellContext()
  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>
        Participant shell
      </h1>
      <p style={{ fontSize: '14px', color: '#4a4f55', margin: 0 }}>
        A channel mounts here (E2 social is the first). Mount variant:{' '}
        <code>{variant}</code>; scenario now: <code>{scenarioNow.toISOString()}</code>.
      </p>
    </div>
  )
}

/**
 * The participant route subtree — COBRA-free BY CONSTRUCTION. There is no
 * `ThemeProvider(cobraTheme)` above it (see {@link StaffThemeBoundary}); the
 * stack is exercise scope (fail-closed) → per-exercise brand skin → the shell
 * (compliance chrome, alert bar, channel nav, overlay layer + the channel
 * mount point). This is the participant half of the D0 §2 two-worlds rule.
 */
function ParticipantShellRoute() {
  return (
    <ExerciseContextProvider>
      <BrandThemeProvider>
        <ShellLayout>
          <ParticipantChannelPlaceholder />
        </ShellLayout>
      </BrandThemeProvider>
    </ExerciseContextProvider>
  )
}

const router = createBrowserRouter([
  // Staff surfaces (COBRA) — wrapped in the staff theme boundary, never the app root.
  { path: '/', element: <StaffThemeBoundary><HomePage /></StaffThemeBoundary> },
  { path: '/evaluator', element: <StaffThemeBoundary><EvaluatorDashboardPage /></StaffThemeBoundary> },
  // Participant surface (the fiction) — per-brand skin, no COBRA anywhere above it.
  { path: '/shell', element: <ParticipantShellRoute /> },
  { path: '*', element: <StaffThemeBoundary><NotFoundPage /></StaffThemeBoundary> },
])

/**
 * Root application component.
 *
 * Holds ONLY the app-wide, world-neutral providers: React Query, the router,
 * and toasts. The COBRA staff theme is deliberately NOT here — it is scoped to
 * staff routes via {@link StaffThemeBoundary}, and participant routes mount
 * their own per-brand theme ({@link ParticipantShellRoute}). This split makes
 * the staff look unreachable from participant paths (D0 §2 two-worlds gate).
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
