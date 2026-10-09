/**
 * features/controller/console/CommandPalette.modalPriority.test.tsx
 * ---------------------------------------------------------------------------
 * The ⌘K palette follows the product's one-way modal rule (`core/a11y/modalPriority.ts`;
 * demo-polish Wave 3 Gate-2 check 22): while ANY OTHER `[aria-modal="true"]` element is
 * mounted - a dialog opened over it, a shell-level overlay that declares itself modal - it
 * STANDS ASIDE:
 *
 *  - focus-on-open: the search field is not focused (it would pull focus out of the other
 *    modal and fight its trap);
 *  - Tab cycling: its Tab handler leaves the key alone, so a Tab pressed in a dialog that
 *    is rendered inside the palette's React tree (React bubbles portal events through the
 *    tree) is not hijacked and pulled back into the palette.
 *
 * With no other modal both behave as before (`CommandPalette.test.tsx` covers that in depth;
 * the first test here is the control that proves the stand-aside is the thing under test).
 */
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { CommandPalette } from './CommandPalette'

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>)
}

/** A palette with one extra focusable inside it, so Tab has somewhere to wrap. */
function palette(extra?: ReactNode) {
  return (
    <>
      {extra}
      <CommandPalette
        open
        onClose={vi.fn()}
        renderPersonaResults={() => <button type="button">last control</button>}
      />
    </>
  )
}

describe('CommandPalette - stands aside for another modal', () => {
  it('CONTROL: with no other modal it focuses its search field and wraps Tab', () => {
    renderWithTheme(palette())
    expect(screen.getByLabelText('Search personas')).toHaveFocus()

    const last = screen.getByRole('button', { name: 'last control' })
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('Search personas')).toHaveFocus()
  })

  it('does not take focus on open while another aria-modal layer is mounted', () => {
    renderWithTheme(palette(
      <div role="dialog" aria-modal="true" aria-label="Other modal">
        <button type="button">inside the other modal</button>
      </div>,
    ))
    // Focus was not moved into the palette's search field.
    expect(screen.getByLabelText('Search personas')).not.toHaveFocus()
  })

  it('leaves Tab alone while another aria-modal layer is mounted (no wrap, no pull-back)', () => {
    renderWithTheme(palette(
      <div role="dialog" aria-modal="true" aria-label="Other modal">
        <button type="button">inside the other modal</button>
      </div>,
    ))
    const last = screen.getByRole('button', { name: 'last control' })
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(last).toHaveFocus()
  })

  it('does not hijack Tab from a dialog rendered through a portal INSIDE its React tree', () => {
    // A modal whose React parent is the palette's results slot but whose DOM is elsewhere:
    // its key events bubble to the palette's panel handler through the React tree.
    function PortalledDialog() {
      const [host] = useState(() => document.createElement('div'))
      return (
        <>
          <span ref={() => { if (!host.isConnected) document.body.appendChild(host) }} />
          {createPortal(
            <div role="dialog" aria-modal="true" aria-label="Nested modal">
              <button type="button">nested control</button>
            </div>,
            host,
          )}
        </>
      )
    }
    renderWithTheme(
      <CommandPalette open onClose={vi.fn()} renderPersonaResults={() => <PortalledDialog />} />,
    )
    const nested = screen.getByRole('button', { name: 'nested control' })
    nested.focus()
    fireEvent.keyDown(nested, { key: 'Tab' })
    // Had the palette's trap handled it, focus would have been yanked to its first control.
    expect(nested).toHaveFocus()
  })
})
