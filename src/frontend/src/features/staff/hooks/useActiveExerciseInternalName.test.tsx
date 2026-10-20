/**
 * features/staff/hooks/useActiveExerciseInternalName.test.tsx
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 09: staff labels use the INTERNAL name from the staff
 * assignments, matched by exercise id; the last name resolved for the CURRENT exercise
 * is kept across a refetch, and dropped the moment the exercise changes.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { selectInternalName, useActiveExerciseInternalName } from './useActiveExerciseInternalName'
import type { Enrollment } from '../types'

const scope = { exerciseId: 'EX-1' }
const assignments: { data: Enrollment[] | undefined; isSuccess: boolean } = {
  data: undefined,
  isSuccess: false,
}

vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: () => scope }))
vi.mock('./useStaffAssignments', () => ({ useStaffAssignments: () => assignments }))

function enrollment(exerciseId: string, exerciseName: string): Enrollment {
  return { exerciseId, exerciseName, role: 'controller' } as Enrollment
}

beforeEach(() => {
  scope.exerciseId = 'EX-1'
  assignments.data = undefined
  assignments.isSuccess = false
})

describe('selectInternalName', () => {
  it('matches the exercise id case-insensitively', () => {
    expect(selectInternalName([enrollment('ex-1', 'Harbor Storm')], 'EX-1')).toBe('Harbor Storm')
  })

  it('is null with no match or no list', () => {
    expect(selectInternalName([enrollment('ex-2', 'Other')], 'ex-1')).toBeNull()
    expect(selectInternalName(undefined, 'ex-1')).toBeNull()
  })
})

describe('useActiveExerciseInternalName', () => {
  it('keeps the last name for the same exercise while the assignments refetch', () => {
    assignments.data = [enrollment('ex-1', 'Harbor Storm')]
    const { result, rerender } = renderHook(() => useActiveExerciseInternalName())
    expect(result.current).toBe('Harbor Storm')

    assignments.data = undefined // reset/refetch after a switch, or a failed refetch
    rerender()
    expect(result.current).toBe('Harbor Storm')
  })

  it('drops the kept name as soon as the exercise changes (never another exercise\'s name)', () => {
    assignments.data = [enrollment('ex-1', 'Harbor Storm')]
    const { result, rerender } = renderHook(() => useActiveExerciseInternalName())
    expect(result.current).toBe('Harbor Storm')

    scope.exerciseId = 'ex-2'
    assignments.data = undefined
    rerender()
    expect(result.current).toBeNull()
  })

  it('drops the kept name when a SUCCESSFUL read no longer lists the exercise', () => {
    assignments.data = [enrollment('ex-1', 'Harbor Storm')]
    assignments.isSuccess = true
    const { result, rerender } = renderHook(() => useActiveExerciseInternalName())
    expect(result.current).toBe('Harbor Storm')

    assignments.data = [enrollment('ex-2', 'Other')] // unassigned from ex-1
    rerender()
    expect(result.current).toBeNull()
  })

  it('stays null when a refetch FAILS after a read that dropped the exercise (error keeps old data)', () => {
    assignments.data = [enrollment('ex-1', 'Harbor Storm')]
    assignments.isSuccess = true
    const { result, rerender } = renderHook(() => useActiveExerciseInternalName())
    expect(result.current).toBe('Harbor Storm')

    assignments.data = [enrollment('ex-2', 'Other')]
    rerender()
    expect(result.current).toBeNull()

    assignments.isSuccess = false // status 'error', previous data retained
    rerender()
    expect(result.current).toBeNull()
  })
})
