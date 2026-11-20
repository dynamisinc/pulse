/**
 * core/auth/sessionReset.scope.test.ts
 * ---------------------------------------------------------------------------
 * The exercise-scope reset registry (#856): module stores that hold exercise data outside React
 * Query register a reset that runs when the session's exercise changes. It is SEPARATE from the
 * session resets (a switch is not a sign-out), synchronous, in registration order, and isolates
 * a throwing reset.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  registerExerciseScopeReset,
  registerSessionReset,
  runExerciseScopeResets,
  runSessionResets,
} from './sessionReset'

describe('exercise-scope resets', () => {
  it('runs in registration order, isolates a throwing reset, and honours unregister', () => {
    const order: string[] = []
    const off1 = registerExerciseScopeReset(() => order.push('one'))
    const off2 = registerExerciseScopeReset(() => {
      throw new Error('boom')
    })
    const off3 = registerExerciseScopeReset(() => order.push('three'))

    runExerciseScopeResets()
    expect(order).toEqual(['one', 'three'])

    off1()
    off1() // idempotent
    runExerciseScopeResets()
    expect(order).toEqual(['one', 'three', 'three'])
    off2()
    off3()
  })

  it('is independent of the session resets', () => {
    const scopeReset = vi.fn()
    const sessionReset = vi.fn()
    const offScope = registerExerciseScopeReset(scopeReset)
    const offSession = registerSessionReset(sessionReset)

    runExerciseScopeResets()
    expect(scopeReset).toHaveBeenCalledTimes(1)
    expect(sessionReset).not.toHaveBeenCalled()

    runSessionResets()
    expect(sessionReset).toHaveBeenCalledTimes(1)
    expect(scopeReset).toHaveBeenCalledTimes(1)
    offScope()
    offSession()
  })
})
