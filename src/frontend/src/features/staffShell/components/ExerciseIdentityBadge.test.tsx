/**
 * features/staffShell/components/ExerciseIdentityBadge.test.tsx
 * ---------------------------------------------------------------------------
 * Coverage for the header exercise identity badge / switcher (UAT 10/16 fix):
 *  - with ONE assignment (or none, or still loading) the badge is the original
 *    static element, not a button;
 *  - with TWO OR MORE it is a menu button (aria-haspopup / aria-expanded);
 *  - the menu lists every exercise (name + role) and marks the active one with
 *    the TEXT "Active" (plus a check icon; never color alone);
 *  - choosing another exercise calls the existing switch path (the
 *    `setActiveExercise` service via `useSetActiveExercise`) and closes the menu;
 *  - a failed switch shows its error inside the menu and keeps it open;
 *  - Escape closes the menu and returns focus to the trigger;
 *  - Enter opens it from the keyboard.
 * The scope + service seams are mocked the way `ExerciseSwitcher.test.tsx` does.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import {
  StaffAssignmentError,
  getStaffAssignments,
  setActiveExercise,
} from '@/features/staff/services/staffAssignmentsService'
import type { Enrollment } from '@/features/staff/types'
import { ExerciseIdentityBadge } from './ExerciseIdentityBadge'

const mockRefreshExerciseScope = vi.fn()

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
  useExerciseScopeRefresh: () => mockRefreshExerciseScope,
}))

vi.mock('@/features/staff/services/staffAssignmentsService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/features/staff/services/staffAssignmentsService')>()
  return { ...actual, getStaffAssignments: vi.fn(), setActiveExercise: vi.fn() }
})

const mockGetAssignments = vi.mocked(getStaffAssignments)
const mockSetActiveExercise = vi.mocked(setActiveExercise)

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  timeZone: 'UTC',
  status: 'live',
}

const ALPHA: Enrollment = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  role: 'controller',
  personId: 'person-1',
  isLead: false,
}
const BRAVO: Enrollment = {
  exerciseId: 'ex-bravo',
  exerciseName: 'Bravo Exercise',
  role: 'evaluator',
  personId: 'person-1',
  isLead: false,
}
const TWO: Enrollment[] = [ALPHA, BRAVO]

function renderBadge() {
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
  return render(<ExerciseIdentityBadge role="CONTROLLER" cell="SIMCELL-1" />, { wrapper: Wrapper })
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue(SCOPE)
  mockGetAssignments.mockReset()
  mockSetActiveExercise.mockReset()
  mockRefreshExerciseScope.mockReset()
  mockRefreshExerciseScope.mockResolvedValue(undefined)
  mockGetAssignments.mockResolvedValue(TWO)
})

describe('ExerciseIdentityBadge — static with fewer than two assignments', () => {
  it('stays a plain, non-button badge with one assignment', async () => {
    mockGetAssignments.mockResolvedValue([ALPHA])
    renderBadge()

    await waitFor(() => expect(mockGetAssignments).toHaveBeenCalled())
    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(badge.tagName).not.toBe('BUTTON')
    expect(badge).not.toHaveAttribute('aria-haspopup')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(await within(badge).findByText('Alpha Exercise')).toBeInTheDocument()
    expect(within(badge).getByText('CONTROLLER · SIMCELL-1')).toBeInTheDocument()
  })

  it('stays static if the assignments fail to load', async () => {
    mockGetAssignments.mockRejectedValue(new StaffAssignmentError('boom', { status: 500 }))
    renderBadge()

    await waitFor(() => expect(mockGetAssignments).toHaveBeenCalled())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('ExerciseIdentityBadge — INTERNAL name, never the participant-facing scope name', () => {
  it('shows the internal name even when the scope name is null (static badge)', async () => {
    vi.mocked(useExerciseContext).mockReturnValue({ ...SCOPE, exerciseName: null })
    mockGetAssignments.mockResolvedValue([ALPHA])
    renderBadge()

    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(await within(badge).findByText('Alpha Exercise')).toBeInTheDocument()
  })

  it('does not show the participant-facing scope name; the internal one wins', async () => {
    vi.mocked(useExerciseContext).mockReturnValue({ ...SCOPE, exerciseName: 'Public Name' })
    mockGetAssignments.mockResolvedValue([ALPHA])
    renderBadge()

    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(await within(badge).findByText('Alpha Exercise')).toBeInTheDocument()
    expect(screen.queryByText('Public Name')).not.toBeInTheDocument()
  })

  it('renders no name line (not the scope name) until the assignments resolve', async () => {
    vi.mocked(useExerciseContext).mockReturnValue({ ...SCOPE, exerciseName: 'Public Name' })
    mockGetAssignments.mockRejectedValue(new StaffAssignmentError('boom', { status: 500 }))
    renderBadge()

    await waitFor(() => expect(mockGetAssignments).toHaveBeenCalled())
    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(within(badge).queryByText('Public Name')).not.toBeInTheDocument()
    expect(within(badge).getByText('CONTROLLER · SIMCELL-1')).toBeInTheDocument()
  })

  it('the switcher trigger names the internal exercise when the scope name is null', async () => {
    vi.mocked(useExerciseContext).mockReturnValue({ ...SCOPE, exerciseName: null })
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    expect(trigger).toHaveAccessibleName(/current: Alpha Exercise, CONTROLLER SIMCELL-1/)
  })
})

describe('ExerciseIdentityBadge — switcher with two or more assignments', () => {
  it('is a menu button with aria-haspopup and aria-expanded', async () => {
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('staff-header-identity-badge')).toBe(trigger)
  })

  it('lists each exercise with its role and marks the active one in text', async () => {
    const user = userEvent.setup()
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    await user.click(trigger)

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Alpha Exercise')).toBeInTheDocument()
    expect(within(menu).getByText('CONTROLLER')).toBeInTheDocument()
    expect(within(menu).getByText('Bravo Exercise')).toBeInTheDocument()
    expect(within(menu).getByText('EVALUATOR')).toBeInTheDocument()

    const active = screen.getByTestId('staff-header-exercise-item-ex-alpha')
    expect(active).toHaveAttribute('aria-current', 'true')
    expect(within(active).getByText('Active')).toBeInTheDocument()
    const other = screen.getByTestId('staff-header-exercise-item-ex-bravo')
    expect(other).not.toHaveAttribute('aria-current')
    expect(within(other).queryByText('Active')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('choosing another exercise calls the existing switch path and closes the menu', async () => {
    mockSetActiveExercise.mockResolvedValue(BRAVO)
    const user = userEvent.setup()
    renderBadge()

    await user.click(await screen.findByRole('button', { name: /switch exercise/i }))
    await user.click(await screen.findByTestId('staff-header-exercise-item-ex-bravo'))

    await waitFor(() => expect(mockSetActiveExercise).toHaveBeenCalledTimes(1))
    expect(mockSetActiveExercise.mock.calls[0]?.[0]).toBe('ex-bravo')
    await waitFor(() => expect(mockRefreshExerciseScope).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('choosing the already-active exercise just closes the menu (no switch call)', async () => {
    const user = userEvent.setup()
    renderBadge()

    await user.click(await screen.findByRole('button', { name: /switch exercise/i }))
    await user.click(await screen.findByTestId('staff-header-exercise-item-ex-alpha'))

    expect(mockSetActiveExercise).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('shows a failed switch inside the menu (text + alert) and keeps it open', async () => {
    mockSetActiveExercise.mockRejectedValue(new StaffAssignmentError('no', { status: 403 }))
    const user = userEvent.setup()
    renderBadge()

    await user.click(await screen.findByRole('button', { name: /switch exercise/i }))
    await user.click(await screen.findByTestId('staff-header-exercise-item-ex-bravo'))

    const alert = await screen.findByTestId('staff-header-switch-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('You are not assigned to that exercise.')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    await user.click(trigger)
    await screen.findByRole('menu')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens from the keyboard with Enter', async () => {
    const user = userEvent.setup()
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    trigger.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('can be dismissed with Escape while a switch is pending; reopening still shows pending', async () => {
    let release: (value: Enrollment) => void = () => undefined
    mockSetActiveExercise.mockReturnValue(
      new Promise<Enrollment>(resolve => {
        release = resolve
      }),
    )
    const user = userEvent.setup()
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    await user.click(trigger)
    await user.click(await screen.findByTestId('staff-header-exercise-item-ex-bravo'))
    expect(await screen.findByTestId('staff-header-switching')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    expect(await screen.findByTestId('staff-header-switching')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-exercise-item-ex-bravo')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByTestId('staff-header-exercise-item-ex-alpha')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(mockSetActiveExercise).toHaveBeenCalledTimes(1)
    release(BRAVO)
  })

  it('keeps focus on the badge button after a successful switch with a delayed refetch', async () => {
    mockSetActiveExercise.mockResolvedValue(BRAVO)
    const user = userEvent.setup()
    renderBadge()

    const trigger = await screen.findByRole('button', { name: /switch exercise/i })
    await user.click(trigger)
    await screen.findByRole('menu')

    // From now on the assignments refetch is slow (resetQueries clears + refetches).
    mockGetAssignments.mockImplementation(
      () => new Promise<Enrollment[]>(resolve => setTimeout(() => resolve(TWO), 150)),
    )
    await user.click(screen.getByTestId('staff-header-exercise-item-ex-bravo'))

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await new Promise(resolve => setTimeout(resolve, 300))
    const after = screen.getByRole('button', { name: /switch exercise/i })
    expect(after).toBe(trigger)
    expect(after).toHaveFocus()
  })
})
