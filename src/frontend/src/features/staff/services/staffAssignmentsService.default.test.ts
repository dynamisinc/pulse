/**
 * features/staff/services/staffAssignmentsService.default.test.ts
 * ---------------------------------------------------------------------------
 * Coverage for the SHIPPED default path: the real shared axios client plus
 * the canned mock adapters (`MOCK_ASSIGNMENTS`). The sibling
 * `staffAssignmentsService.test.ts` mocks `@/core/services/api` to exercise
 * the validation/error branches, so THIS is the file that proves "the mock
 * seam drives it with no backend" (mirrors
 * `exerciseContextResolver.default.test.ts` beside
 * `exerciseContextResolver.test.ts` — WAVE0-REVIEW precedent 19).
 *
 * Deliberately does NOT mock `@/core/services/api` — every request goes
 * through the real axios request pipeline and is short-circuited by the mock
 * adapter, so no network is touched.
 */
import { describe, it, expect } from 'vitest'
import { StaffAssignmentError, getStaffAssignments, setActiveExercise } from './staffAssignmentsService'

describe('getStaffAssignments (default mock adapter)', () => {
  it('resolves the canned multi-exercise assignment list through the real axios client', async () => {
    const assignments = await getStaffAssignments()

    expect(assignments).toEqual([
      { exerciseId: 'ex-mock-0001', exerciseName: 'Coastal Surge (Mock Exercise)', role: 'controller' },
      { exerciseId: 'ex-mock-0002', exerciseName: 'Ridgeline Wildfire TTX', role: 'evaluator' },
      { exerciseId: 'ex-mock-0003', exerciseName: 'Harbor Freeze Tabletop', role: 'planner' },
    ])
  })

  it('the first canned assignment matches exerciseContextResolver.ts\'s MOCK_EXERCISE_CONTEXT id', async () => {
    // The switcher's "currently active" match relies on this alignment in
    // mock/dev mode — see the module header of staffAssignmentsService.ts.
    const assignments = await getStaffAssignments()

    expect(assignments.some(a => a.exerciseId === 'ex-mock-0001')).toBe(true)
  })
})

describe('setActiveExercise (default mock adapter)', () => {
  it('echoes back the matching canned assignment for an exerciseId in the mock list', async () => {
    const active = await setActiveExercise('ex-mock-0002')

    expect(active).toEqual({
      exerciseId: 'ex-mock-0002',
      exerciseName: 'Ridgeline Wildfire TTX',
      role: 'evaluator',
    })
  })

  it('rejects (fails closed) for an exerciseId outside the caller\'s mock assignments', async () => {
    const caught = await setActiveExercise('ex-not-assigned').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBe(403)
  })
})
