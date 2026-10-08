/**
 * features/social/explore/useDebouncedValue.test.ts
 * ---------------------------------------------------------------------------
 * The trailing-edge debounce behind the search box's announcement and `search`
 * telemetry (demo-polish F6): the value settles only after it has rested for the
 * delay, every change restarts the wait, and an unmount cancels it. Fake timers make
 * the timing exact (no real-time race).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('starts with the initial value', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 400))
    expect(result.current).toBe('a')
  })

  it('settles on the new value only after the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })

    act(() => {
      vi.advanceTimersByTime(399)
    })
    expect(result.current).toBe('a')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('b')
  })

  it('restarts the wait on every change (a burst of keystrokes settles once)', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: '' },
    })
    for (const typed of ['z', 'ze', 'zep', 'zeph']) {
      rerender({ value: typed })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(result.current).toBe('')
    }
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('zeph')
  })

  it('does not update after unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    unmount()
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }).not.toThrow()
    expect(result.current).toBe('a')
  })
})
