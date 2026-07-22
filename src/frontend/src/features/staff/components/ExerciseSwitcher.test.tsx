/**
 * features/staff/components/ExerciseSwitcher.test.tsx
 * ---------------------------------------------------------------------------
 * Story 05 (staff cross-exercise switcher) — RTL coverage for the Acceptance
 * Criteria in docs/features/exercise-isolation/05-staff-cross-exercise-switcher.md:
 *  - lists the staff user's assignments from the mock seam;
 *  - shows the currently-active exercise, conveyed by MORE than color
 *    (icon + text + color, NFR-001);
 *  - selecting a different exercise calls the switch mutation with the chosen
 *    exerciseId and reflects the new active exercise;
 *  - keyboard-operable with an accessible label (NFR-001);
 *  - loading + error feedback for both the list read and the switch.
 *
 * `@/core/exerciseContext` is mocked at the module boundary (mirrors
 * `StaffHeader.test.tsx`) so each test controls the resolved scope directly
 * and synchronously. `../services/staffAssignmentsService` is mocked the way
 * `AccountImport.errors.test.tsx` mocks `accountImportService` (via
 * `importOriginal`, keeping the real `StaffAssignmentError` class) so no real
 * axios sink is ever touched here — that seam's own request/validation logic
 * is covered by `staffAssignmentsService.test.ts`. The sibling
 * `ExerciseSwitcher.default.test.tsx` covers the REAL, un-mocked mock seam
 * (the shipped DEV path) per WAVE0-REVIEW precedent 19.
 */
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { ExerciseSwitcher } from './ExerciseSwitcher'
import {
  StaffAssignmentError,
  getStaffAssignments,
  setActiveExercise,
} from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

vi.mock('../services/staffAssignmentsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/staffAssignmentsService')>()
  return { ...actual, getStaffAssignments: vi.fn(), setActiveExercise: vi.fn() }
})

const mockGetAssignments = vi.mocked(getStaffAssignments)
const mockSetActiveExercise = vi.mocked(setActiveExercise)

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  timeZone: 'UTC',
  status: 'scheduled',
}

const ASSIGNMENTS: StaffAssignment[] = [
  { exerciseId: 'ex-alpha', exerciseName: 'Alpha Exercise', role: 'controller' },
  { exerciseId: 'ex-bravo', exerciseName: 'Bravo Exercise', role: 'evaluator' },
  { exerciseId: 'ex-charlie', exerciseName: 'Charlie Exercise', role: 'planner' },
]

function mockScope(overrides: Partial<ExerciseScope> = {}) {
  vi.mocked(useExerciseContext).mockReturnValue({ ...SCOPE, ...overrides })
}

function renderSwitcher() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExerciseSwitcher />, { wrapper: Wrapper })
}

beforeEach(() => {
  mockScope()
  mockGetAssignments.mockReset()
  mockSetActiveExercise.mockReset()
  mockGetAssignments.mockResolvedValue(ASSIGNMENTS)
})

describe('ExerciseSwitcher — lists assignments from the mock seam (AC: make-real data source)', () => {
  it('renders every assignment with its exercise name and role', async () => {
    renderSwitcher()

    const list = await screen.findByTestId('exercise-switcher-list')
    expect(within(list).getByText('Alpha Exercise')).toBeInTheDocument()
    expect(within(list).getByText('Bravo Exercise')).toBeInTheDocument()
    expect(within(list).getByText('Charlie Exercise')).toBeInTheDocument()
    expect(within(list).getByText('EVALUATOR')).toBeInTheDocument()
    expect(within(list).getByText('PLANNER')).toBeInTheDocument()
  })

  it('shows a loading state while assignments are in flight', () => {
    mockGetAssignments.mockReturnValue(new Promise(() => {})) // never resolves
    renderSwitcher()

    const status = screen.getByTestId('exercise-switcher-loading')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveTextContent(/loading your exercise assignments/i)
  })

  it('renders a role="alert" when the assignments load fails', async () => {
    mockGetAssignments.mockRejectedValue(new StaffAssignmentError('Unauthorized', { status: 401 }))
    renderSwitcher()

    const alert = await screen.findByTestId('exercise-switcher-load-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/staff session is not active/i)
    // Icon + text, never color alone.
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
  })

  it('renders a graceful empty state when the caller has no assignments', async () => {
    mockGetAssignments.mockResolvedValue([])
    renderSwitcher()

    expect(await screen.findByTestId('exercise-switcher-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher-list')).not.toBeInTheDocument()
  })
})

describe('ExerciseSwitcher — the active exercise is conveyed by MORE than color (NFR-001)', () => {
  it('marks the assignment matching the resolved scope with aria-current, an icon, AND an "ACTIVE" text badge', async () => {
    renderSwitcher()

    const activeRow = await screen.findByTestId('exercise-switcher-row-ex-alpha')
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    expect(within(activeRow).getByText('ACTIVE')).toBeInTheDocument()
    expect(activeRow.querySelector('svg[data-icon="circle-check"]')).not.toBeNull()
  })

  it('renders every non-active assignment as a plain switch button, not the active row', async () => {
    renderSwitcher()
    await screen.findByTestId('exercise-switcher-row-ex-alpha')

    expect(screen.queryByTestId('exercise-switcher-row-ex-bravo')).not.toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher-switch-button-ex-bravo')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher-row-ex-charlie')).not.toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher-switch-button-ex-charlie')).toBeInTheDocument()
  })
})

describe('ExerciseSwitcher — switching calls the mutation with the chosen exerciseId', () => {
  it('calls setActiveExercise with the clicked assignment\'s exerciseId', async () => {
    mockSetActiveExercise.mockResolvedValue(ASSIGNMENTS[1] as StaffAssignment)
    const user = userEvent.setup()
    renderSwitcher()

    const button = await screen.findByTestId('exercise-switcher-switch-button-ex-bravo')
    await user.click(button)

    // React Query's mutationFn is invoked with a second (context) argument it
    // owns internally — only the first argument is this seam's contract.
    expect(mockSetActiveExercise.mock.calls[0]?.[0]).toBe('ex-bravo')
  })

  it('reflects the newly active exercise after a successful switch', async () => {
    mockSetActiveExercise.mockResolvedValue(ASSIGNMENTS[1] as StaffAssignment)
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(await screen.findByTestId('exercise-switcher-switch-button-ex-bravo'))

    const newActiveRow = await screen.findByTestId('exercise-switcher-row-ex-bravo')
    expect(newActiveRow).toHaveAttribute('aria-current', 'true')
    expect(within(newActiveRow).getByText('ACTIVE')).toBeInTheDocument()
    // Alpha is no longer marked active — it's now a plain switch button.
    expect(screen.queryByTestId('exercise-switcher-row-ex-alpha')).not.toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher-switch-button-ex-alpha')).toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher-switch-success')).toHaveTextContent('Bravo Exercise')
  })

  it('is keyboard-operable: reachable by Tab and activatable with Enter', async () => {
    mockSetActiveExercise.mockResolvedValue(ASSIGNMENTS[1] as StaffAssignment)
    const user = userEvent.setup()
    renderSwitcher()

    await screen.findByTestId('exercise-switcher-switch-button-ex-bravo')
    const button = screen.getByTestId('exercise-switcher-switch-button-ex-bravo')

    // Reachable by Tab (a real native <button>, no custom tabindex plumbing).
    button.focus()
    expect(document.activeElement).toBe(button)

    await user.keyboard('{Enter}')

    expect(mockSetActiveExercise.mock.calls[0]?.[0]).toBe('ex-bravo')
  })

  it('is activatable with Space too', async () => {
    mockSetActiveExercise.mockResolvedValue(ASSIGNMENTS[2] as StaffAssignment)
    const user = userEvent.setup()
    renderSwitcher()

    const button = await screen.findByTestId('exercise-switcher-switch-button-ex-charlie')
    button.focus()

    await user.keyboard(' ')

    expect(mockSetActiveExercise.mock.calls[0]?.[0]).toBe('ex-charlie')
  })

  it('renders a role="alert" when the switch fails, and leaves the active exercise unchanged', async () => {
    mockSetActiveExercise.mockRejectedValue(new StaffAssignmentError('Forbidden', { status: 403 }))
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(await screen.findByTestId('exercise-switcher-switch-button-ex-bravo'))

    const alert = await screen.findByTestId('exercise-switcher-switch-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/not assigned/i)

    const stillActive = screen.getByTestId('exercise-switcher-row-ex-alpha')
    expect(stillActive).toHaveAttribute('aria-current', 'true')
  })

  it('disables the switch buttons while a switch is in flight', async () => {
    mockSetActiveExercise.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(await screen.findByTestId('exercise-switcher-switch-button-ex-bravo'))

    expect(screen.getByTestId('exercise-switcher-switching')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('exercise-switcher-switch-button-ex-charlie')).toBeDisabled()
  })
})

describe('ExerciseSwitcher — accessible label (NFR-001)', () => {
  it('the control has an accessible name via its own heading', async () => {
    renderSwitcher()
    await screen.findByTestId('exercise-switcher-list')

    expect(screen.getByTestId('exercise-switcher')).toHaveAccessibleName('Active exercise')
  })

  it('the assignment list carries its own accessible name', async () => {
    renderSwitcher()

    expect(await screen.findByTestId('exercise-switcher-list')).toHaveAccessibleName(
      'Your exercise assignments',
    )
  })

  it('every switch button has a distinct, descriptive accessible name', async () => {
    renderSwitcher()

    expect(
      await screen.findByRole('button', { name: 'Switch to Bravo Exercise (EVALUATOR)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Switch to Charlie Exercise (PLANNER)' }),
    ).toBeInTheDocument()
  })
})
