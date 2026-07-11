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

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '*', element: <NotFoundPage /> },
])

/**
 * Root application component.
 *
 * Provides the COBRA staff theme, React Query, the router, and toasts.
 * Participant surfaces (the fiction) will mount their own per-brand themes
 * within nested routes rather than inheriting this staff theme.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={cobraTheme}>
        <CssBaseline />
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
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
