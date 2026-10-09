/**
 * core/auth/sessionReset.test.ts
 * ---------------------------------------------------------------------------
 * The session-reset registry (Wave 3 Gate-2 A L-5): features register a "forget my
 * session-scoped state" callback; `runSessionResets()` (called by `endSession`) runs them
 * synchronously in registration order, isolates one that throws, and ignores a registration
 * that was undone. `endSession`'s own use of it is covered in `endSession.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { registerSessionReset, runSessionResets } from './sessionReset'

describe('sessionReset', () => {
  it('runs resets in registration order', () => {
    const order: string[] = []
    const offs = [
      registerSessionReset(() => order.push('first')),
      registerSessionReset(() => order.push('second')),
    ]
    runSessionResets()
    expect(order).toEqual(['first', 'second'])
    offs.forEach(off => off())
  })

  it('registering the same function twice registers it once', () => {
    const reset = vi.fn()
    const off = registerSessionReset(reset)
    registerSessionReset(reset)
    runSessionResets()
    expect(reset).toHaveBeenCalledTimes(1)
    off()
  })

  it('a throwing reset does not stop the next one, and never throws out', () => {
    const next = vi.fn()
    const offBad = registerSessionReset(() => {
      throw new Error('boom')
    })
    const offNext = registerSessionReset(next)
    expect(() => runSessionResets()).not.toThrow()
    expect(next).toHaveBeenCalledTimes(1)
    offBad()
    offNext()
  })

  it('unregister is idempotent and takes effect', () => {
    const reset = vi.fn()
    const off = registerSessionReset(reset)
    off()
    off()
    runSessionResets()
    expect(reset).not.toHaveBeenCalled()
  })
})
