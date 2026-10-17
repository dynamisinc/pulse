/**
 * features/controller/components/confirm/useCoarsePointer.test.tsx
 * ---------------------------------------------------------------------------
 * `(pointer: coarse)` is read live: an EventTarget-backed MediaQueryList fake flips from fine to
 * coarse (an iPad keyboard/trackpad detached, a convertible switching modes) and the hook
 * follows via the `change` event. Also false without `matchMedia`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCoarsePointer } from './useCoarsePointer'

const realMatchMedia = window.matchMedia

class FakeMql extends EventTarget {
  matches: boolean
  readonly media = '(pointer: coarse)'
  constructor(matches: boolean) {
    super()
    this.matches = matches
  }
  flip(next: boolean): void {
    this.matches = next
    this.dispatchEvent(new Event('change'))
  }
}

afterEach(() => {
  window.matchMedia = realMatchMedia
})

describe('useCoarsePointer', () => {
  it('follows a live change event', () => {
    const mql = new FakeMql(false)
    window.matchMedia = (() => mql) as unknown as typeof window.matchMedia
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
    act(() => mql.flip(true))
    expect(result.current).toBe(true)
    act(() => mql.flip(false))
    expect(result.current).toBe(false)
  })

  it('is false without matchMedia', () => {
    // @ts-expect-error simulating an environment with no matchMedia
    window.matchMedia = undefined
    expect(renderHook(() => useCoarsePointer()).result.current).toBe(false)
  })
})
