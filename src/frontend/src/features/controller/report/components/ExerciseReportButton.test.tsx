/**
 * features/controller/report/components/ExerciseReportButton.test.tsx
 * ---------------------------------------------------------------------------
 * The console's Exercise report button navigates to the report route in the SAME tab (CR-001:
 * staff tokens are per-tab, so a new tab would have no session).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { EXERCISE_REPORT_PATH, ExerciseReportButton } from './ExerciseReportButton'

describe('ExerciseReportButton', () => {
  it('navigates to the report route in the same tab', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <ThemeProvider theme={cobraTheme}>
        <MemoryRouter initialEntries={['/staff/console']}>
          <Routes>
            <Route path="/staff/console" element={<ExerciseReportButton />} />
            <Route path={EXERCISE_REPORT_PATH} element={<p>REPORT PAGE</p>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Exercise report' }))
    expect(screen.getByText('REPORT PAGE')).toBeInTheDocument()
    expect(windowOpen).not.toHaveBeenCalled()
    windowOpen.mockRestore()
  })
})
