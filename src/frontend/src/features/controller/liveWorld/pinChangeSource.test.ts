/**
 * features/controller/liveWorld/pinChangeSource.test.ts
 * ---------------------------------------------------------------------------
 * Story 08: the default pin-change seam. Story 07 adds
 * `realtimeFeed.subscribePinChanged(handler): () => void`; until it lands the default
 * source must be a harmless no-op, and once it lands it must delegate to it (same
 * handler contract, malformed payloads dropped, unsubscribe passed through).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { realtimeFeed } from '@/features/social/services/realtimeFeed'
import {
  defaultPinChangeSource,
  isPinChangedEvent,
  type PinChangedHandler,
} from './pinChangeSource'

type Patchable = Record<string, unknown>
const feed = realtimeFeed as unknown as Patchable
const original = Object.getOwnPropertyDescriptor(feed, 'subscribePinChanged')

afterEach(() => {
  if (original !== undefined) Object.defineProperty(feed, 'subscribePinChanged', original)
  else delete feed.subscribePinChanged
})

describe('defaultPinChangeSource', () => {
  it('is a no-op (an unsubscribe that does nothing) when realtimeFeed has no subscribePinChanged', () => {
    // Shadow whatever is there (after 07 merges, a prototype method) with a non-function.
    Object.defineProperty(feed, 'subscribePinChanged', { value: undefined, configurable: true })
    const handler = vi.fn()
    const unsubscribe = defaultPinChangeSource.subscribePinChanged(handler)
    expect(typeof unsubscribe).toBe('function')
    expect(() => unsubscribe()).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  it('delegates to story 07\'s realtimeFeed.subscribePinChanged once it exists', () => {
    let registered: PinChangedHandler | undefined
    const unsubscribe = vi.fn()
    const subscribePinChanged = vi.fn((handler: PinChangedHandler) => {
      registered = handler
      return unsubscribe
    })
    Object.defineProperty(feed, 'subscribePinChanged', {
      value: subscribePinChanged,
      configurable: true,
    })

    const handler = vi.fn()
    const off = defaultPinChangeSource.subscribePinChanged(handler)
    expect(subscribePinChanged).toHaveBeenCalledTimes(1)

    registered?.({ postId: 'p1', pinnedForAll: true })
    expect(handler).toHaveBeenCalledWith({ postId: 'p1', pinnedForAll: true })

    // A malformed payload never reaches the column.
    ;(registered as unknown as (value: unknown) => void)({ postId: 1, pinnedForAll: 'yes' })
    expect(handler).toHaveBeenCalledTimes(1)

    off()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('isPinChangedEvent', () => {
  it('accepts only { postId: non-empty string, pinnedForAll: boolean }', () => {
    expect(isPinChangedEvent({ postId: 'p', pinnedForAll: false })).toBe(true)
    expect(isPinChangedEvent({ postId: '', pinnedForAll: true })).toBe(false)
    expect(isPinChangedEvent({ postId: 'p' })).toBe(false)
    expect(isPinChangedEvent(null)).toBe(false)
    expect(isPinChangedEvent('p')).toBe(false)
  })
})
