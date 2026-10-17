/**
 * core/hooks/useKeyboardOverlap.test.tsx
 * ---------------------------------------------------------------------------
 * The keyboard lift is measured against the element's containing block, not the layout viewport.
 * Rects and the visual viewport are stubbed (jsdom has no layout).
 */
import { useRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { keyboardOverlap, useKeyboardOverlap } from './useKeyboardOverlap'

type FakeVv = EventTarget & { height: number, offsetTop: number }

function stubVv(height: number, offsetTop = 0): FakeVv {
  const vv = new EventTarget() as FakeVv
  vv.height = height
  vv.offsetTop = offsetTop
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  return vv
}

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
})

/** A positioned parent whose bottom edge is at `parentBottom`, holding the measured child. */
function Probe({ enabled, parentBottom }: { enabled: boolean, parentBottom: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const lift = useKeyboardOverlap(ref, enabled)
  return (
    <div
      data-testid="parent"
      ref={node => {
        if (node) node.getBoundingClientRect = () => ({ bottom: parentBottom }) as DOMRect
      }}
    >
      <div
        ref={node => {
          ref.current = node
          if (node) Object.defineProperty(node, 'offsetParent', { configurable: true, value: node.parentElement })
        }}
        data-testid="child"
      >
        {lift}
      </div>
    </div>
  )
}

describe('keyboardOverlap', () => {
  it('is the overlap of the container bottom with the visual viewport, never negative', () => {
    expect(keyboardOverlap(700, { height: 500, offsetTop: 0 })).toBe(200)
    expect(keyboardOverlap(700, { height: 500, offsetTop: 40 })).toBe(160)
    expect(keyboardOverlap(400, { height: 500, offsetTop: 0 })).toBe(0)
  })
})

describe('useKeyboardOverlap', () => {
  it('measures against the containing block, not the window bottom', () => {
    stubVv(500)
    render(<Probe enabled parentBottom={650} />)
    // The viewport bottom is at 500; the parent ends at 650: 150px are covered (not window-based).
    expect(screen.getByTestId('child')).toHaveTextContent('150')
  })

  it('follows visual viewport resize and scroll', () => {
    const vv = stubVv(500)
    render(<Probe enabled parentBottom={650} />)
    act(() => {
      vv.height = 650
      vv.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('child')).toHaveTextContent('0')
    act(() => {
      vv.height = 500
      vv.offsetTop = 20
      vv.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('child')).toHaveTextContent('130')
  })

  it('is 0 when disabled or without a visual viewport', () => {
    stubVv(500)
    const { unmount } = render(<Probe enabled={false} parentBottom={650} />)
    expect(screen.getByTestId('child')).toHaveTextContent('0')
    unmount()
    Reflect.deleteProperty(window, 'visualViewport')
    render(<Probe enabled parentBottom={650} />)
    expect(screen.getByTestId('child')).toHaveTextContent('0')
  })
})
