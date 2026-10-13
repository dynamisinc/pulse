/**
 * features/participantAdmin/test/renderWithProviders.tsx
 * ---------------------------------------------------------------------------
 * Test harness for the staff roster screen (feature: easy-login, story 10).
 * Renders a component the way the app mounts it, minus the staff frame:
 *
 *   QueryClientProvider  (retries off, so a failure surfaces at once)
 *   ThemeProvider        (the COBRA theme — this is a STAFF surface)
 *   ExerciseContextProvider (resolves the mock exercise, `ex-mock-0001`, which
 *                            is why callers `await` their first assertion)
 *
 * The page needs only these three, which is what "testable without the frame"
 * means. Tests that need a different exercise id mock `useExerciseContext`.
 */
import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'

/** A client with no retries, so error states show immediately. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  options: { queryClient?: QueryClient, withExerciseContext?: boolean } = {},
) {
  const queryClient = options.queryClient ?? makeQueryClient()
  const withExerciseContext = options.withExerciseContext ?? true

  function Wrapper({ children }: { children: ReactNode }) {
    const themed = <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
    return (
      <QueryClientProvider client={queryClient}>
        {withExerciseContext ? <ExerciseContextProvider>{themed}</ExerciseContextProvider> : themed}
      </QueryClientProvider>
    )
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper }) }
}
