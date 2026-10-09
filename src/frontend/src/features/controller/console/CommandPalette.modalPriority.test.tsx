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

describe('CommandPalette - focus returns to a stable place when its opener is gone (Gate-2 A L-NEW-3)', () => {
  /**
   * A console-like tree: the palette lives inside `[data-console-root]`; a popup layer (like C5's
   * takedown step) names its home control with `data-focus-return-to`, and the control sits in a
   * Live world row. The layer owns the focused element when the palette opens, then goes away.
   */
  function Tree({ palette: paletteOpen, layer }: { palette: boolean; layer: boolean }) {
    return (
      <div data-console-root="" tabIndex={-1} data-testid="console-root">
        <div data-live-world-row="" tabIndex={-1} data-testid="row">
          <button type="button" id="row-control">Take down</button>
        </div>
        {layer && (
          <div role="dialog" data-focus-return-to="row-control" data-testid="layer">
            <input aria-label="inside the layer" />
          </div>
        )}
        <CommandPalette open={paletteOpen} onClose={vi.fn()} />
      </div>
    )
  }

  function openOverLayer() {
    const view = renderWithTheme(<Tree palette={false} layer />)
    screen.getByLabelText('inside the layer').focus()
    view.rerender(
      <ThemeProvider theme={cobraTheme}><Tree palette layer /></ThemeProvider>,
    )
    expect(screen.getByLabelText('Search personas')).toHaveFocus()
    return view
  }

  const withTheme = (ui: ReactNode) => <ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>

  it('CONTROL: an opener that is still there gets focus back, as before', () => {
    const view = renderWithTheme(<Tree palette={false} layer />)
    screen.getByLabelText('inside the layer').focus()
    view.rerender(withTheme(<Tree palette layer />))
    view.rerender(withTheme(<Tree palette={false} layer />))
    expect(screen.getByLabelText('inside the layer')).toHaveFocus()
  })

  it('opener gone -> the control the layer names as its home', () => {
    const view = openOverLayer()
    // The layer closes (focus moved to the palette), then the palette closes.
    view.rerender(withTheme(<Tree palette layer={false} />))
    view.rerender(withTheme(<Tree palette={false} layer={false} />))
    expect(document.getElementById('row-control')).toHaveFocus()
  })

  it('opener AND home control gone -> the row that held it', () => {
    const view = openOverLayer()
    document.getElementById('row-control')?.remove()
    view.rerender(withTheme(<Tree palette layer={false} />))
    view.rerender(withTheme(<Tree palette={false} layer={false} />))
    expect(screen.getByTestId('row')).toHaveFocus()
  })

  it('opener, home control AND row gone -> the console root, never <body>', () => {
    const view = openOverLayer()
    screen.getByTestId('row').remove()
    view.rerender(withTheme(<Tree palette layer={false} />))
    view.rerender(withTheme(<Tree palette={false} layer={false} />))
    expect(screen.getByTestId('console-root')).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('outside a console, with the opener gone and no home named, nothing is focused (and nothing throws)', () => {
    function Plain({ layer, paletteOpen }: { layer: boolean; paletteOpen: boolean }) {
      return (
        <>
          {layer && <div role="dialog"><input aria-label="lonely" /></div>}
          <CommandPalette open={paletteOpen} onClose={vi.fn()} />
        </>
      )
    }
    const view = renderWithTheme(<Plain layer paletteOpen={false} />)
    screen.getByLabelText('lonely').focus()
    view.rerender(withTheme(<Plain layer paletteOpen />))
    view.rerender(withTheme(<Plain layer={false} paletteOpen />))

    expect(() => view.rerender(withTheme(<Plain layer={false} paletteOpen={false} />)))
      .not.toThrow()
    expect(document.activeElement).toBe(document.body)
  })

  it('remembers the opener from BEFORE the palette\'s own contents autofocus', () => {
    // The persona picker inside the palette autofocuses its search field in the same commit the
    // palette opens, so `document.activeElement` is already inside the palette by the time its
    // open effect runs. The opener must still be the element that had focus before.
    function Autofocusing({ paletteOpen }: { paletteOpen: boolean }) {
      return (
        <>
          <button type="button">the opener</button>
          <CommandPalette
            open={paletteOpen}
            onClose={vi.fn()}
            renderPersonaResults={() => <input aria-label="picker search" autoFocus />}
          />
        </>
      )
    }
    const view = renderWithTheme(<Autofocusing paletteOpen={false} />)
    screen.getByRole('button', { name: 'the opener' }).focus()
    view.rerender(withTheme(<Autofocusing paletteOpen />))
    view.rerender(withTheme(<Autofocusing paletteOpen={false} />))

    expect(screen.getByRole('button', { name: 'the opener' })).toHaveFocus()
  })
})
