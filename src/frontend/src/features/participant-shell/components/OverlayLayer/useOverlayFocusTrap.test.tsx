/**
 * features/participant-shell/components/OverlayLayer/useOverlayFocusTrap.test.tsx
 * ---------------------------------------------------------------------------
 * Story 05 (overlay layer) — coverage for the focus-trap primitive (NFR-001,
 * AC "overlays trap focus and are announced"): activation moves focus into
 * the overlay, escaped focus is pulled back (no dismiss affordance to
 * special-case), Tab/Shift+Tab cycles among any focusable descendants (none
 * exist for any overlay this story ships, but the trap stays correct if a
 * later story's content ever adds one), and deactivation restores whatever
 * was focused before the trap engaged.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOverlayFocusTrap } from './useOverlayFocusTrap'

function EmptyContainer({ active }: { active: boolean }) {
  const containerRef = useOverlayFocusTrap<HTMLDivElement>(active)
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      data-testid="trap-container"
    >
      no focusable descendants
    </div>
  )
}

function ContainerWithButtons({ active }: { active: boolean }) {
  const containerRef = useOverlayFocusTrap<HTMLDivElement>(active)
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      data-testid="trap-container"
    >
      <button data-testid="first">First</button>
      <button data-testid="last">Last</button>
    </div>
  )
}

/**
 * Mounts/unmounts the trap as a sibling of a persistent outside button -
 * mirroring how `OverlayLayer` unmounts one overlay's whole subtree when the
 * server-pushed state clears (never a user dismiss).
 */
function Scene({ mounted, active }: { mounted: boolean; active: boolean }) {
  return (
    <div>
      <button data-testid="outside-button">outside</button>
      {mounted && <EmptyContainer active={active} />}
    </div>
  )
}

describe('useOverlayFocusTrap — activation', () => {
  it('moves focus into the container the instant it activates', () => {
    render(<EmptyContainer active={true} />)

    expect(document.activeElement).toBe(screen.getByTestId('trap-container'))
  })

  it('does not steal focus while inactive', () => {
    render(<EmptyContainer active={false} />)

    expect(document.activeElement).not.toBe(screen.getByTestId('trap-container'))
  })
})

describe('useOverlayFocusTrap — deactivation restores prior focus', () => {
  it('restores focus to whatever was focused before activation, once the overlay clears', () => {
    const { rerender } = render(<Scene mounted={false} active={false} />)
    const outsideButton = screen.getByTestId('outside-button')
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    rerender(<Scene mounted={true} active={true} />)
    expect(document.activeElement).toBe(screen.getByTestId('trap-container'))

    // The overlay's whole subtree unmounts (a server push clearing the
    // state, never a user dismiss) - focus must return to the prior element.
    rerender(<Scene mounted={false} active={true} />)
    expect(document.activeElement).toBe(outsideButton)
  })
})

describe('useOverlayFocusTrap — escaped focus is pulled back in', () => {
  it('redirects focus back to the container the instant it lands anywhere else in the document', () => {
    render(<Scene mounted={true} active={true} />)
    const container = screen.getByTestId('trap-container')
    expect(document.activeElement).toBe(container)

    const outsideButton = screen.getByTestId('outside-button')
    outsideButton.focus()

    expect(document.activeElement).toBe(container)
  })
})

describe('useOverlayFocusTrap — Tab handling', () => {
  it('pins focus on the container and prevents the default Tab action when no focusable descendants exist', () => {
    render(<EmptyContainer active={true} />)
    const container = screen.getByTestId('trap-container')

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    container.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(container)
  })

  it('wraps Tab from the last focusable descendant back to the first', () => {
    render(<ContainerWithButtons active={true} />)
    const container = screen.getByTestId('trap-container')
    const first = screen.getByTestId('first')
    const last = screen.getByTestId('last')

    last.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    container.dispatchEvent(event)

    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from the first focusable descendant back to the last', () => {
    render(<ContainerWithButtons active={true} />)
    const container = screen.getByTestId('trap-container')
    const first = screen.getByTestId('first')
    const last = screen.getByTestId('last')

    first.focus()
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    container.dispatchEvent(event)

    expect(document.activeElement).toBe(last)
  })
})
