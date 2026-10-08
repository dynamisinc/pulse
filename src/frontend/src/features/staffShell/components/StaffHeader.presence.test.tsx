/**
 * features/staffShell/components/StaffHeader.presence.test.tsx
 * ---------------------------------------------------------------------------
 * The NON-EMPTY branch of the header's staff-presence region (demo-polish C4).
 *
 * `StaffHeader.test.tsx` proves the shipped state: the presence seam returns
 * `[]` and the header renders no presence region at all. This file proves the
 * other half of that contract — that the region is not dead code: the day a real
 * presence channel (CTL-004) hands the seam a roster, the header shows it as a
 * labelled group with one accessible avatar per member. The seam is mocked at its
 * module boundary (`../staffHeaderMocks`) to supply that roster; nothing here
 * puts a roster back into the shipped seam.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StaffHeader } from './StaffHeader'
import type { StaffPresenceMember } from '../staffHeaderMocks'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-staff-header-presence',
    exerciseName: 'Bay Shield 2026',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

vi.mock('@/core/auth', () => ({
  endSession: vi.fn(),
}))

const ROSTER: readonly StaffPresenceMember[] = [
  { id: 'a', initials: 'AB', label: 'Test member A', color: '#276749' },
  { id: 'b', initials: 'CD', label: 'Test member B', color: '#5b3f86' },
]

vi.mock('../staffHeaderMocks', async importOriginal => {
  const actual = await importOriginal<typeof import('../staffHeaderMocks')>()
  return { ...actual, useStaffPresence: () => ROSTER }
})

describe('StaffHeader — a non-empty presence roster', () => {
  it('renders a labelled "Staff presence" group with one accessible avatar per member', () => {
    render(
      <MemoryRouter>
        <StaffHeader surfaceName="Controller Console" />
      </MemoryRouter>,
    )

    const group = screen.getByRole('group', { name: 'Staff presence' })
    expect(within(group).getByLabelText('Test member A')).toHaveTextContent('AB')
    expect(within(group).getByLabelText('Test member B')).toHaveTextContent('CD')
  })
})
