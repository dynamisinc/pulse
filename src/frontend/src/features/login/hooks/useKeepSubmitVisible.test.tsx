/**
 * features/login/hooks/useKeepSubmitVisible.test.tsx
 * ---------------------------------------------------------------------------
 * The submit button is scrolled into view when the keyboard resizes the visual
 * viewport while a field has focus, and not otherwise (mobile-tablet story 03).
 */
import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeepSubmitVisible } from './useKeepSubmitVisible'

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  useKeepSubmitVisible(ref)
  return (
    <div ref={ref}>
      <label htmlFor="f">Field</label>
      <input id="f" />
      <button type="submit">Go</button>
    </div>
  )
}

interface FakeViewport extends EventTarget { height: number, scale: number }

function installViewport(): FakeViewport {
  const target = Object.assign(new EventTarget(), { height: 800, scale: 1 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target })
  return target
}

const originalScrollIntoView = Element.prototype.scrollIntoView
let scroll: ReturnType<typeof vi.fn>

beforeEach(() => {
  scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll as unknown as typeof Element.prototype.scrollIntoView
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.restoreAllMocks()
})

function focusField() {
  render(<Harness />)
  screen.getByLabelText('Field').focus()
}

describe('useKeepSubmitVisible', () => {
  it('scrolls the submit into view when the keyboard shrinks the viewport', () => {
    const viewport = installViewport()
    focusField()
    viewport.height = 400
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
  })

  it('does nothing when no field has focus', () => {
    const viewport = installViewport()
    render(<Harness />)
    viewport.height = 400
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('ignores a pinch-zoom (scale changed) even if the height shrinks', () => {
    const viewport = installViewport()
    focusField()
    viewport.height = 400
    viewport.scale = 2
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('ignores resizes while already zoomed in (scale !== 1)', () => {
    const viewport = installViewport()
    viewport.scale = 2
    focusField()
    viewport.height = 400
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('ignores the keyboard closing (height grows)', () => {
    const viewport = installViewport()
    viewport.height = 400
    focusField()
    viewport.height = 800
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('is a no-op where visualViewport is unsupported (nothing scheduled)', () => {
    focusField()
    expect(scroll).not.toHaveBeenCalled()
  })
})
