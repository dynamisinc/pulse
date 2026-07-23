/**
 * features/staff/components/ExerciseSwitcherSlot.test.tsx
 * ---------------------------------------------------------------------------
 * Unit coverage for the switcher visibility gate: it mounts
 * `<ExerciseSwitcher>` ONLY when the staff member has >1 exercise to switch
 * between, and renders nothing otherwise (single exercise, none, still loading,
 * or on error). `useStaffAssignments` is mocked to control the count directly,
 * and `ExerciseSwitcher` is stubbed — this file tests the GATE, not the
 * switcher's internals (those are covered by `ExerciseSwitcher.test.tsx`).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'
import { ExerciseSwitcherSlot } from './ExerciseSwitcherSlot'
import { useStaffAssignments } from '../hooks/useStaffAssignments'
import type { StaffAssignmentError } from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'

vi.mock('../hooks/useStaffAssignments', () => ({ useStaffAssignments: vi.fn() }))
vi.mock('./ExerciseSwitcher', () => ({
  ExerciseSwitcher: () => <div data-testid="exercise-switcher-stub" />,
}))

const mockUseStaffAssignments = vi.mocked(useStaffAssignments)

type AssignmentsQuery = UseQueryResult<StaffAssignment[], StaffAssignmentError>

/** Minimal query-result shape the slot reads (`data` only). */
function queryWith(data: StaffAssignment[] | undefined): AssignmentsQuery {
  return { data } as AssignmentsQuery
}

const A = (exerciseId: string): StaffAssignment => ({
  exerciseId,
  exerciseName: `${exerciseId} Exercise`,
  role: 'controller',
})

beforeEach(() => {
  mockUseStaffAssignments.mockReset()
})

describe('ExerciseSwitcherSlot — visibility gate', () => {
  it('renders the switcher when there are 2+ assignments (something to switch to)', () => {
    mockUseStaffAssignments.mockReturnValue(queryWith([A('ex-alpha'), A('ex-bravo')]))
    render(<ExerciseSwitcherSlot />)
    expect(screen.getByTestId('exercise-switcher-stub')).toBeInTheDocument()
  })

  it('renders nothing for a single-exercise staff member (nothing to switch to)', () => {
    mockUseStaffAssignments.mockReturnValue(queryWith([A('ex-alpha')]))
    render(<ExerciseSwitcherSlot />)
    expect(screen.queryByTestId('exercise-switcher-stub')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no assignments', () => {
    mockUseStaffAssignments.mockReturnValue(queryWith([]))
    render(<ExerciseSwitcherSlot />)
    expect(screen.queryByTestId('exercise-switcher-stub')).not.toBeInTheDocument()
  })

  it('renders nothing while the assignment list is still loading (data undefined)', () => {
    mockUseStaffAssignments.mockReturnValue(queryWith(undefined))
    render(<ExerciseSwitcherSlot />)
    expect(screen.queryByTestId('exercise-switcher-stub')).not.toBeInTheDocument()
  })

  it('renders nothing on error, even when a stale 2+ assignment list is still cached', () => {
    // React Query can be isError while `data` still holds a prior-success array;
    // the gate must not mount the switcher against those stale options.
    mockUseStaffAssignments.mockReturnValue(
      { data: [A('ex-alpha'), A('ex-bravo')], isError: true } as AssignmentsQuery,
    )
    render(<ExerciseSwitcherSlot />)
    expect(screen.queryByTestId('exercise-switcher-stub')).not.toBeInTheDocument()
  })
})
