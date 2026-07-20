/**
 * features/controller/identity/controllerIdentity.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (console-shell) — coverage for the mock controller-identity seam
 * (COR-018 attribution; AC "Mock controller identity"):
 *
 *  - `resolveMockControllerIdentity` is pure + exercise-scoped: the mock
 *    exercise gets the named SIMCELL-1 operator; a different exercise yields a
 *    DIFFERENT `actingHumanId` (so the scoping is observable), `role` always
 *    `'controller'`.
 *  - `useControllerIdentity()` is bound to `useExerciseContext()`: a different
 *    mounted exercise re-scopes the identity (mirrors `useExerciseContext()`'s
 *    pattern — the test list's exercise-context-bound requirement).
 *
 * `@/core/exerciseContext` is mocked at the module boundary (mirrors
 * `ParticipantAdminFlyout.test.tsx`) so each test controls the exercise scope
 * directly and deterministically.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExerciseScope } from '@/core/exerciseContext'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  resolveMockControllerIdentity,
  useControllerIdentity,
} from './controllerIdentity'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockedUseExerciseContext = vi.mocked(useExerciseContext)

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'UTC', status: 'active' }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveMockControllerIdentity', () => {
  it('returns the named SIMCELL-1 operator for the mock exercise', () => {
    const identity = resolveMockControllerIdentity('ex-mock-0001')
    expect(identity).toEqual({
      actingHumanId: 'human-controller-01',
      callSign: 'SIMCELL-1',
      role: 'controller',
      isLead: true,
    })
  })

  it('is exercise-scoped — a different exercise yields a different actingHumanId', () => {
    const a = resolveMockControllerIdentity('ex-alpha')
    const b = resolveMockControllerIdentity('ex-bravo')
    expect(a.actingHumanId).not.toBe(b.actingHumanId)
    expect(a.role).toBe('controller')
    expect(b.role).toBe('controller')
  })

  it('isLead: true for the mock exercise, false for any other (derived) exercise (ADP-040)', () => {
    expect(resolveMockControllerIdentity('ex-mock-0001').isLead).toBe(true)
    expect(resolveMockControllerIdentity('ex-alpha').isLead).toBe(false)
    expect(resolveMockControllerIdentity('ex-bravo').isLead).toBe(false)
  })
})

describe('useControllerIdentity', () => {
  it('resolves the identity for the currently bound exercise scope', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    const { result } = renderHook(() => useControllerIdentity())
    expect(result.current).toEqual({
      actingHumanId: 'human-controller-01',
      callSign: 'SIMCELL-1',
      role: 'controller',
      isLead: true,
    })
  })

  it('re-scopes when mounted under a different exercise', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-one'))
    const first = renderHook(() => useControllerIdentity())
    const firstId = first.result.current.actingHumanId
    first.unmount()

    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-two'))
    const second = renderHook(() => useControllerIdentity())
    expect(second.result.current.actingHumanId).not.toBe(firstId)
  })
})
