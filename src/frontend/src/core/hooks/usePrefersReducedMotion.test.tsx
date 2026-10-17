import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

afterEach(() => vi.unstubAllGlobals())

describe('usePrefersReducedMotion', () => {
  it('is false and does not throw where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
  })

  it('follows change events', () => {
    const listeners = new Set<() => void>()
    const mql = {
      matches: true,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }
    vi.stubGlobal('matchMedia', () => mql)
    const { result, unmount } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
    mql.matches = false
    act(() => listeners.forEach(l => l()))
    expect(result.current).toBe(false)
    unmount()
    expect(listeners.size).toBe(0)
  })

  it('falls back to addListener / removeListener when addEventListener is absent', () => {
    const listeners = new Set<() => void>()
    const mql = {
      matches: false,
      addListener: (l: () => void) => listeners.add(l),
      removeListener: (l: () => void) => listeners.delete(l),
    }
    vi.stubGlobal('matchMedia', () => mql)
    const { result, unmount } = renderHook(() => usePrefersReducedMotion())
    mql.matches = true
    act(() => listeners.forEach(l => l()))
    expect(result.current).toBe(true)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
