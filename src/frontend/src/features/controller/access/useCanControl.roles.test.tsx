/**
 * features/controller/access/useCanControl.roles.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (issue #573): the console's gate hooks answer per the role matrix.
 *   - `useCanControl` (conduct: fire, hold, skip, takedown, noise, steering): controller only;
 *   - `useCanEditContent` (inject create / update / delete / reorder / import, persona edit):
 *     planner AND controller, never an evaluator;
 *   - `useCanStaffPost` / `useCanStaffPin`: planner + controller while the exercise is in
 *     `build`; controller only in any other state (a planner outside build loses them).
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExerciseStatus } from '@/core/exerciseContext'
import type { SessionRole } from '@/core/auth'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import {
  useCanControl,
  useCanEditContent,
  useCanStaffPin,
  useCanStaffPost,
} from './useCanControl'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))

const scope = vi.hoisted(() => ({ status: 'live' as string }))
vi.mock('@/core/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext')>()),
  useOptionalExerciseContext: () => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Test',
    timeZone: 'UTC',
    status: scope.status,
  }),
}))

beforeEach(() => {
  resetStubSession()
  scope.status = 'live'
})

const ROLES: readonly SessionRole[] = ['planner', 'controller', 'evaluator', 'orgAdmin']

describe('useCanControl / useCanEditContent', () => {
  for (const role of ROLES) {
    it(`${role}: conduct=${role === 'controller'}, content=${role === 'planner' || role === 'controller'}`, () => {
      setStubSession({ role, isLead: false })
      expect(renderHook(() => useCanControl()).result.current).toBe(role === 'controller')
      expect(renderHook(() => useCanEditContent()).result.current)
        .toBe(role === 'planner' || role === 'controller')
    })
  }

  it('no session fails closed', () => {
    setStubSession({ role: undefined })
    expect(renderHook(() => useCanControl()).result.current).toBe(false)
    expect(renderHook(() => useCanEditContent()).result.current).toBe(false)
  })
})

describe('useCanStaffPost / useCanStaffPin', () => {
  const STATUSES: readonly ExerciseStatus[] = ['build', 'staged', 'live', 'paused', 'completed']
  for (const status of STATUSES) {
    for (const role of ROLES) {
      const expected = role === 'controller' || (role === 'planner' && status === 'build')
      it(`${status}: ${role} -> ${expected ? 'allowed' : 'refused'}`, () => {
        scope.status = status
        setStubSession({ role, isLead: false })
        expect(renderHook(() => useCanStaffPost()).result.current).toBe(expected)
        expect(renderHook(() => useCanStaffPin()).result.current).toBe(expected)
      })
    }
  }
})
