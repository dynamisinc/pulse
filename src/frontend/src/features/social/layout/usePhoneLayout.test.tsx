/**
 * features/social/layout/usePhoneLayout.test.tsx
 * ---------------------------------------------------------------------------
 * `usePhoneLayout` (mobile-tablet story 02): false without `matchMedia` (jsdom, so every
 * pre-existing test keeps the rail), follows the phone query, and reacts to changes.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHONE_QUERY } from './frameMetrics'
import { usePhoneLayout } from './usePhoneLayout'

type Listener = () => void

function stubMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<Listener>()
  const queries: string[] = []
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query)
    return {
      get matches() { return matches },
      media: query,
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    }
  })
  return {
    queries,
    set(next: boolean) {
      matches = next
      for (const fn of listeners) fn()
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('usePhoneLayout', () => {
  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(() => usePhoneLayout()).result.current).toBe(false)
  })

  it('reads the phone query and follows it', () => {
    const mm = stubMatchMedia(true)
    const { result } = renderHook(() => usePhoneLayout())
    expect(result.current).toBe(true)
    expect(mm.queries).toContain(PHONE_QUERY)
    act(() => mm.set(false))
    expect(result.current).toBe(false)
  })
})
