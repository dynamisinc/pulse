/**
 * core/exerciseContext/exerciseContextResolver.mockStatus.test.ts
 * ---------------------------------------------------------------------------
 * `setMockExerciseStatus` / `resetMockExerciseStatus` (demo-polish C6): the MOCK scope's
 * lifecycle-status control that lets a simulated StartEx / EndEx move the staff header's pill.
 * It is a mock-only lever, so (Gate-2 S-2):
 *   - it is NOT reachable from the public `core/exerciseContext` barrel -- only by path, from
 *     the lifecycle mock and the tests;
 *   - it is a NO-OP unless `USE_MOCK_DATA` is on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as barrel from './index'
import {
  resetMockExerciseStatus,
  resolveExerciseContext,
  setMockExerciseStatus,
} from './exerciseContextResolver'

/** A live binding the test can flip: `USE_MOCK_DATA` is read through a getter. */
const flag = vi.hoisted(() => ({ mock: true }))

vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return flag.mock
  },
  warnIfMockDataActive: () => undefined,
}))

afterEach(() => {
  flag.mock = true
  resetMockExerciseStatus()
})

describe('the mock status control', () => {
  it('is not exported from the public core/exerciseContext barrel', () => {
    expect(barrel).not.toHaveProperty('setMockExerciseStatus')
    expect(barrel).not.toHaveProperty('resetMockExerciseStatus')
  })

  it('moves the mock scope\'s status under mock data, and reset restores it', async () => {
    await expect(resolveExerciseContext()).resolves.toMatchObject({ status: 'live' })

    setMockExerciseStatus('completed')
    await expect(resolveExerciseContext()).resolves.toMatchObject({ status: 'completed' })

    resetMockExerciseStatus()
    await expect(resolveExerciseContext()).resolves.toMatchObject({ status: 'live' })
  })

  it('is a NO-OP when mock data is off: a stray call cannot move anything', async () => {
    flag.mock = false

    setMockExerciseStatus('archived')

    // Back on, the (mock) scope still reports its canned status: the call changed nothing.
    flag.mock = true
    await expect(resolveExerciseContext()).resolves.toMatchObject({ status: 'live' })
  })
})
