/**
 * features/login/hooks/useKeepSubmitVisible.test.tsx
 * ---------------------------------------------------------------------------
 * The submit button is scrolled into view when the keyboard resizes the visual
 * viewport while a field has focus, and not otherwise (mobile-tablet story 03).
 */
import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function installViewport() {
  const target = new EventTarget()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target })
  return target
}

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  vi.restoreAllMocks()
})

describe('useKeepSubmitVisible', () => {
  it('scrolls the submit into view on a viewport resize while a field is focused', () => {
    const viewport = installViewport()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<Harness />)
    screen.getByLabelText('Field').focus()
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
  })

  it('does nothing when no field has focus', () => {
    const viewport = installViewport()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<Harness />)
    viewport.dispatchEvent(new Event('resize'))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('is a no-op where visualViewport is unsupported', () => {
    expect(() => render(<Harness />)).not.toThrow()
  })
})
