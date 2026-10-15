/**
 * features/social/pinned/pinEvents.test.ts
 * ---------------------------------------------------------------------------
 * `pinState`'s reset GENERATION (demo-feedback story 07, PR #517 pin-race fix): every
 * reset advances it - including a reset of an EMPTY store - so a pin write that started
 * under the previous identity can tell its late answer is stale (`usePin`). The session
 * reset path (`runSessionResets`, run on sign-out and every sign-in) reaches it too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSessionResets } from '@/core/auth/sessionReset'
import { pinState } from './pinEvents'

afterEach(() => {
  pinState.reset()
})

describe('pinState.generation()', () => {
  it('advances on a reset of an EMPTY store (and notifies no one: nothing changed)', () => {
    pinState.reset()
    const listener = vi.fn()
    const off = pinState.subscribe(listener)
    const before = pinState.generation()

    pinState.reset()

    expect(pinState.generation()).toBe(before + 1)
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('advances on a reset that forgets confirmed pins, and notifies subscribers', () => {
    pinState.set('post-1', true)
    const listener = vi.fn()
    const off = pinState.subscribe(listener)
    const before = pinState.generation()

    pinState.reset()

    expect(pinState.generation()).toBe(before + 1)
    expect(pinState.get('post-1')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('does not move on an ordinary set', () => {
    const before = pinState.generation()
    pinState.set('post-1', true)
    pinState.set('post-1', false)
    expect(pinState.generation()).toBe(before)
  })

  it('advances through the session reset path (sign-out / sign-in)', () => {
    const before = pinState.generation()
    runSessionResets()
    expect(pinState.generation()).toBeGreaterThan(before)
  })
})
