/**
 * features/staff/components/ExerciseSwitcher.default.test.tsx
 * ---------------------------------------------------------------------------
 * Coverage for the SHIPPED default path: `ExerciseSwitcher` rendered under the
 * REAL, un-mocked `ExerciseContextProvider` (the Wave-0 DEV mock resolution)
 * AND the real, un-mocked `staffAssignmentsService` mock seam. The sibling
 * `ExerciseSwitcher.test.tsx` mocks both module boundaries to exercise every
 * branch deterministically; this file is the only one that runs what the app
 * actually executes today with NO backend (mirrors
 * `StaffHeader.default.test.tsx` — WAVE0-REVIEW precedent 19). Deliberately
 * does NOT mock `@/core/exerciseContext`, `../services/staffAssignmentsService`,
 * or `@/core/services/api`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ExerciseSwitcher } from './ExerciseSwitcher'

function renderShipped() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <ExerciseSwitcher />
        </ExerciseContextProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('ExerciseSwitcher — shipped default (real ExerciseContextProvider + real mock seam)', () => {
  it('lists the canned assignments and marks the mock-resolved exercise ACTIVE', async () => {
    renderShipped()

    const list = await screen.findByTestId('exercise-switcher-list')
    expect(within(list).getByText('Coastal Surge (Mock Exercise)')).toBeInTheDocument()
    expect(within(list).getByText('Ridgeline Wildfire TTX')).toBeInTheDocument()
    expect(within(list).getByText('Harbor Freeze Tabletop')).toBeInTheDocument()

    const activeRow = screen.getByTestId('exercise-switcher-row-ex-mock-0001')
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    expect(within(activeRow).getByText('ACTIVE')).toBeInTheDocument()
  })

  it('switching to another canned assignment moves the ACTIVE marker end-to-end, with no mocking at all', async () => {
    const user = userEvent.setup()
    renderShipped()

    const switchButton = await screen.findByTestId('exercise-switcher-switch-button-ex-mock-0002')
    await user.click(switchButton)

    const newActiveRow = await screen.findByTestId('exercise-switcher-row-ex-mock-0002')
    expect(newActiveRow).toHaveAttribute('aria-current', 'true')
    expect(within(newActiveRow).getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher-switch-success')).toHaveTextContent(
      'Ridgeline Wildfire TTX',
    )
  })
})
