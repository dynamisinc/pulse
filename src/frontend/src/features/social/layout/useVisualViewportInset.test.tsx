/**
 * features/social/layout/useVisualViewportInset.test.tsx
 * ---------------------------------------------------------------------------
 * The on-screen keyboard inset (mobile-tablet story 02, composer AC): the maths, 0 without
 * `visualViewport`, and the hook's reaction to the visual viewport shrinking (keyboard up)
 * and growing back. `ComposeModal` publishes it as `--pulse-keyboard-inset`.
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposeModal } from './ComposeModal'
import { keyboardInset, useVisualViewportInset } from './useVisualViewportInset'

type Listener = () => void

function stubViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<Listener>>()
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(fn))
    },
    removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  return {
    resize(nextHeight: number, nextOffsetTop = 0) {
      vv.height = nextHeight
      vv.offsetTop = nextOffsetTop
      for (const fn of listeners.get('resize') ?? []) fn()
    },
  }
}

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
})

describe('keyboardInset', () => {
  it('is the part of the layout viewport the visual viewport no longer covers', () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300)
    expect(keyboardInset(800, { height: 500, offsetTop: 40 })).toBe(260)
  })
  it('never goes negative and rounds to whole px', () => {
    expect(keyboardInset(800, { height: 810, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(800, { height: 500.4, offsetTop: 0 })).toBe(300)
  })
})

describe('useVisualViewportInset', () => {
  it('is 0 without visualViewport', () => {
    expect(renderHook(() => useVisualViewportInset()).result.current).toBe(0)
  })

  it('tracks the keyboard going up and down', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    const vv = stubViewport(800)
    const { result } = renderHook(() => useVisualViewportInset())
    expect(result.current).toBe(0)
    act(() => vv.resize(480))
    expect(result.current).toBe(320)
    act(() => vv.resize(800))
    expect(result.current).toBe(0)
  })
})

describe('ComposeModal keyboard inset', () => {
  it('publishes --pulse-keyboard-inset on the backdrop so the dialog stays above the keyboard', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    const vv = stubViewport(800)
    render(<ComposeModal onClose={() => {}} />)
    const backdrop = screen.getByTestId('compose-backdrop')
    expect(backdrop.style.getPropertyValue('--pulse-keyboard-inset')).toBe('0px')
    act(() => vv.resize(450))
    expect(backdrop.style.getPropertyValue('--pulse-keyboard-inset')).toBe('350px')
  })
})
