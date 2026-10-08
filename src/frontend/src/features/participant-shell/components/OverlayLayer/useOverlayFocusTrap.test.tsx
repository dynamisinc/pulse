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
import type { RefObject } from 'react'
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

/**
 * Gate-1 H-1 / M-A (demo-polish F2): the overlay ALWAYS wins. A channel can have its own
 * `aria-modal` surface open — the social media viewer — when the Pause / EndEx /
 * break-fiction overlay mounts. The priority is one-way: the overlay trap pulls focus back
 * from everywhere outside itself (channel modals included), the channel trap stands aside
 * while the overlay is mounted, and the overlay only backs off for another SHELL layer
 * (`data-shell-layer`). So there is no ping-pong, and focus never sits in the channel modal
 * under the overlay. Also: the trap re-engages when the overlay's root element is swapped
 * (`layerKey`), and a Tab from outside enters the overlay.
 */
function OverlayWithModalSibling({ overlayActive }: { overlayActive: boolean }) {
  const containerRef = useOverlayFocusTrap<HTMLDivElement>(overlayActive)
  return (
    <div>
      <div role="dialog" aria-modal="true" tabIndex={-1} data-testid="channel-modal">
        <button data-testid="channel-modal-button">Close</button>
      </div>
      {overlayActive && (
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          data-shell-layer="overlay"
          data-testid="overlay-modal"
        >
          Paused
        </div>
      )}
    </div>
  )
}

function ShellLayerTrap({ id }: { id: string }) {
  const containerRef = useOverlayFocusTrap<HTMLDivElement>(true)
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      data-shell-layer="overlay"
      data-testid={`${id}-trap`}
    >
      <button data-testid={`${id}-button`}>{id}</button>
    </div>
  )
}

/** The overlay swaps its ROOT ELEMENT between pause and break-fiction while staying active. */
function SwappingOverlay({ kind }: { kind: 'pause' | 'broadcast' }) {
  const containerRef = useOverlayFocusTrap<HTMLElement>(true, kind)
  return kind === 'pause'
    ? <div ref={containerRef as RefObject<HTMLDivElement>} role="dialog" aria-modal="true" tabIndex={-1} data-testid="ov-pause">P</div>
    : <section ref={containerRef as RefObject<HTMLElement>} role="alertdialog" aria-modal="true" tabIndex={-1} data-testid="ov-broadcast">B</section>
}

function OverlayWithButtons() {
  const containerRef = useOverlayFocusTrap<HTMLDivElement>(true)
  return (
    <div ref={containerRef} role="dialog" aria-modal="true" tabIndex={-1} data-testid="ov-buttons">
      <button data-testid="ov-a">A</button>
      <button data-testid="ov-b">B</button>
    </div>
  )
}

const activeId = () =>
  (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? document.activeElement?.tagName

describe('useOverlayFocusTrap — the overlay always wins (H-1 / M-A)', () => {
  it('PULLS focus back from a CHANNEL aria-modal element (no back-off for channel modals)', () => {
    render(<OverlayWithModalSibling overlayActive={true} />)
    const overlay = screen.getByTestId('overlay-modal')
    expect(document.activeElement).toBe(overlay)

    screen.getByTestId('channel-modal-button').focus()

    expect(document.activeElement).toBe(overlay)
  })

  it('still pulls focus back from ordinary page content', () => {
    render(
      <>
        <button data-testid="page-button">page</button>
        <OverlayWithModalSibling overlayActive={true} />
      </>,
    )

    screen.getByTestId('page-button').focus()

    expect(document.activeElement).toBe(screen.getByTestId('overlay-modal'))
  })

  it('backs off for ANOTHER SHELL layer, so two shell layers settle (no ping-pong)', () => {
    render(
      <>
        <ShellLayerTrap id="first" />
        <ShellLayerTrap id="second" />
      </>,
    )
    const first = screen.getByTestId('first-button')
    const second = screen.getByTestId('second-button')

    // Count the focus moves each `.focus()` triggers: a ping-pong fires thousands of
    // `focusin`s before the stack overflows; settled traps fire a handful at most.
    let focusIns = 0
    const count = () => {
      focusIns += 1
    }
    document.addEventListener('focusin', count)
    try {
      first.focus()
      second.focus()
      first.focus()
    } finally {
      document.removeEventListener('focusin', count)
    }

    expect(focusIns).toBeLessThan(12)
    expect(document.activeElement).toBe(first)
  })

  it('re-engages on the NEW root when the overlay element is swapped while active (layerKey)', () => {
    const { rerender } = render(<SwappingOverlay kind="pause" />)
    expect(activeId()).toBe('ov-pause')

    rerender(<SwappingOverlay kind="broadcast" />)

    expect(activeId()).toBe('ov-broadcast')
    // ... and the NEW root is the one that traps now.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(activeId()).toBe('ov-broadcast')
    outside.remove()
  })

  it('remembers the focus from BEFORE the overlay across a root swap, and restores it once at the end', () => {
    function Scene({ kind, mounted }: { kind: 'pause' | 'broadcast', mounted: boolean }) {
      return (
        <>
          <button data-testid="before">before</button>
          {mounted && <SwappingOverlay kind={kind} />}
        </>
      )
    }
    const { rerender } = render(<Scene kind="pause" mounted={false} />)
    screen.getByTestId('before').focus()

    rerender(<Scene kind="pause" mounted={true} />)
    rerender(<Scene kind="broadcast" mounted={true} />)
    expect(activeId()).toBe('ov-broadcast')

    rerender(<Scene kind="broadcast" mounted={false} />)
    expect(activeId()).toBe('before')
  })

  it('a Tab pressed while focus is on <body> ENTERS the overlay (first control; Shift+Tab: last)', () => {
    render(
      <>
        <button data-testid="page-button">page</button>
        <OverlayWithButtons />
      </>,
    )
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.body.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(activeId()).toBe('ov-a')

    ;(document.activeElement as HTMLElement).blur()
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
    })
    document.body.dispatchEvent(shiftTab)
    expect(activeId()).toBe('ov-b')
  })
})
