/**
 * features/planner/components/StaffPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Story 20 (#575a): the planner Staff section. The service is mocked (real
 * `StaffAssignmentError` kept) so the panel is driven through its seam. Covers: list + lead
 * marker as text, grant from candidates, role change, remove and make-lead confirms (with the
 * swamped-mode and self-removal warnings), every 409/404 message, refetch after each mutation,
 * and that a non-assigning role gets nothing.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { StaffPanel } from './StaffPanel'
import * as service from '../services/staffAssignmentService'
import type { StaffRoster } from '../types/staff'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('@/core/exerciseContext', () => ({
  useOptionalExerciseContext: () => ({ exerciseId: 'ex-1' }),
}))
vi.mock('../services/staffAssignmentService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/staffAssignmentService')>()
  return {
    ...actual,
    getStaffRoster: vi.fn(),
    grantStaffRole: vi.fn(),
    changeStaffRole: vi.fn(),
    removeStaff: vi.fn(),
    makeStaffLead: vi.fn(),
  }
})

const svc = vi.mocked(service)
const { StaffAssignmentError } = service

const ROSTER: StaffRoster = {
  exerciseId: 'ex-1',
  enrollments: [
    { id: 'e1', personId: 'person-stub', displayName: 'Pat Planner', email: 'pat@x.org',
      role: 'planner', isLead: false },
    { id: 'e2', personId: 'p2', displayName: 'Cora Lead', email: null, role: 'controller',
      isLead: true },
    { id: 'e3', personId: 'p3', displayName: 'Carl Controller', email: 'carl@x.org',
      role: 'controller', isLead: false },
    { id: 'e4', personId: 'p4', displayName: 'Eve Eval', email: null, role: 'evaluator',
      isLead: false },
  ],
  candidates: [{ personId: 'p9', displayName: 'Newt Newcomer', email: 'newt@x.org' }],
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
    </QueryClientProvider>
  )
  return render(<StaffPanel />, { wrapper: Wrapper })
}

beforeEach(() => {
  vi.resetAllMocks()
  resetStubSession()
  setStubSession({ role: 'planner', isLead: false })
  svc.getStaffRoster.mockResolvedValue(ROSTER)
})

describe('StaffPanel', () => {
  it('lists staff and marks the lead with text and an icon', async () => {
    renderPanel()
    const row = await screen.findByTestId('staff-row-e2')
    const marker = within(row).getByTestId('staff-lead-marker')
    expect(marker).toHaveTextContent('Lead')
    expect(marker.querySelector('svg')).not.toBeNull()
    expect(screen.getAllByTestId('staff-lead-marker')).toHaveLength(1)
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Pat Planner \(you\)/ })).toBeInTheDocument()
  })

  it('offers Make lead to non-lead controllers only', async () => {
    renderPanel()
    await screen.findByTestId('staff-row-e2')
    expect(screen.getAllByRole('button', { name: /^Make .* lead$/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Make Carl Controller lead' })).toBeInTheDocument()
  })

  it('shows empty and loading states', async () => {
    svc.getStaffRoster.mockResolvedValue({ ...ROSTER, enrollments: [], candidates: [] })
    renderPanel()
    expect(screen.getByText(/Loading staff/)).toBeInTheDocument()
    expect(await screen.findByTestId('staff-empty')).toBeInTheDocument()
    expect(screen.getByTestId('staff-no-candidates')).toBeInTheDocument()
  })

  it('grants a role to a candidate and refetches', async () => {
    svc.grantStaffRole.mockResolvedValue()
    renderPanel()
    await screen.findByTestId('staff-row-e2')
    await userEvent.selectOptions(screen.getByLabelText('Person'), 'p9')
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'evaluator')
    await userEvent.click(screen.getByRole('button', { name: 'Add staff' }))
    await waitFor(() => expect(svc.grantStaffRole).toHaveBeenCalledWith('ex-1', 'p9', 'evaluator'))
    await waitFor(() => expect(svc.getStaffRoster).toHaveBeenCalledTimes(2))
  })

  it('changes a role and refetches', async () => {
    svc.changeStaffRole.mockResolvedValue()
    renderPanel()
    await screen.findByTestId('staff-row-e4')
    await userEvent.selectOptions(screen.getByLabelText('Role for Eve Eval'), 'controller')
    await waitFor(() => expect(svc.changeStaffRole).toHaveBeenCalledWith('e4', 'controller'))
    await waitFor(() => expect(svc.getStaffRoster).toHaveBeenCalledTimes(2))
  })

  it('removes only after confirming, then refetches', async () => {
    svc.removeStaff.mockResolvedValue()
    renderPanel()
    await screen.findByTestId('staff-row-e4')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eve Eval' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(svc.removeStaff).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(svc.removeStaff).toHaveBeenCalledWith('e4'))
    await waitFor(() => expect(svc.getStaffRoster).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('cancelling the remove confirm does nothing', async () => {
    renderPanel()
    await screen.findByTestId('staff-row-e4')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eve Eval' }))
    await userEvent.click(within(await screen.findByRole('alertdialog'))
      .getByRole('button', { name: 'Cancel' }))
    expect(svc.removeStaff).not.toHaveBeenCalled()
  })

  it('make lead warns that swamped mode turns off, then sets the lead', async () => {
    svc.makeStaffLead.mockResolvedValue()
    renderPanel()
    await screen.findByTestId('staff-row-e3')
    await userEvent.click(screen.getByRole('button', { name: 'Make Carl Controller lead' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Changing the lead turns swamped mode off.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make lead' }))
    await waitFor(() => expect(svc.makeStaffLead).toHaveBeenCalledWith('e3'))
    await waitFor(() => expect(svc.getStaffRoster).toHaveBeenCalledTimes(2))
  })

  it('warns when removing yourself', async () => {
    renderPanel()
    await screen.findByTestId('staff-row-e1')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Pat Planner' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/signed out of it/)
  })

  it('warns and confirms before demoting yourself', async () => {
    svc.changeStaffRole.mockResolvedValue()
    renderPanel()
    await screen.findByTestId('staff-row-e1')
    await userEvent.selectOptions(screen.getByLabelText('Role for Pat Planner'), 'evaluator')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/signed out of it/)
    expect(svc.changeStaffRole).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role' }))
    await waitFor(() => expect(svc.changeStaffRole).toHaveBeenCalledWith('e1', 'evaluator'))
  })

  const CASES: ReadonlyArray<readonly [number, string | undefined, string]> = [
    [409, 'last-planner', 'An exercise must keep at least one planner.'],
    [409, 'conflicting-enrollment', 'That person already has a role in this exercise.'],
    [409, 'lead-changed-retry', 'The lead changed while you were working. Refresh and try again.'],
    [409, 'lead-conflict', 'The lead changed while you were working. Refresh and try again.'],
    [409, 'not-a-controller', 'Only a controller can be the lead.'],
    [404, undefined, 'That person or role no longer exists here.'],
  ]
  for (const [status, code, message] of CASES) {
    it(`maps ${status} ${code ?? ''} to its message and refetches`, async () => {
      svc.removeStaff.mockRejectedValue(new StaffAssignmentError('x', status, code))
      renderPanel()
      await screen.findByTestId('staff-row-e4')
      await userEvent.click(screen.getByRole('button', { name: 'Remove Eve Eval' }))
      await userEvent.click(within(await screen.findByRole('alertdialog'))
        .getByRole('button', { name: 'Remove' }))
      const err = await screen.findByTestId('staff-error')
      expect(err).toHaveTextContent(message)
      expect(err.querySelector('svg')).not.toBeNull()
      expect(screen.getByTestId('staff-error-region')).toHaveAttribute('role', 'alert')
      await waitFor(() => expect(svc.getStaffRoster).toHaveBeenCalledTimes(2))
    })
  }

  for (const role of ['controller', 'evaluator', 'participant'] as const) {
    it(`${role} gets no Staff panel and no fetch`, () => {
      setStubSession({ role })
      renderPanel()
      expect(screen.queryByTestId('staff-panel')).not.toBeInTheDocument()
    })
  }
})
