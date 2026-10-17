/**
 * features/controller/console/consoleTouch.keyboard.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024): the command palette and the persona dock on a tablet.
 *  - the palette has a visible, labelled Close (the touch twin of Esc), 44px, only on a coarse
 *    pointer (so the desktop Tab order is unchanged); palette results scroll and a single tap on a
 *    row selects;
 *  - the on-screen keyboard (visual viewport) does not cover the composer: the dock lifts its
 *    bottom edge and the palette pads up by the covered px, on a coarse pointer only;
 *  - the dock's Close (the twin of Esc) is 44px.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { CommandPalette } from './CommandPalette'
import { PersonaDockHost } from './personaDockHost.tsx'
import { hasPseudoHitSlop, mediaRuleDeclarations, setPointer } from '../consoleTouchTestUtils'

let restorePointer: (() => void) | undefined

/** A visual viewport 400px shorter than the layout viewport (the on-screen keyboard is up). */
function stubKeyboard(coveredPx: number): () => void {
  const target = new EventTarget() as EventTarget & { height: number, offsetTop: number }
  target.height = window.innerHeight - coveredPx
  target.offsetTop = 0
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target })
  return () => Reflect.deleteProperty(window, 'visualViewport')
}
let restoreKeyboard: (() => void) | undefined

afterEach(() => {
  restorePointer?.()
  restoreKeyboard?.()
  restorePointer = undefined
  restoreKeyboard = undefined
})

const themed = (ui: React.ReactNode) => <ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>

describe('CommandPalette — touch', () => {
  it('has a labelled 44px Close on a coarse pointer that closes it with one tap', async () => {
    restorePointer = setPointer(true)
    const onClose = vi.fn()
    render(themed(<CommandPalette open onClose={onClose} />))
    const close = screen.getByRole('button', { name: 'Close command palette' })
    const coarse = mediaRuleDeclarations(close, 'pointer: coarse')
    expect(coarse['min-width']).toBe('44px')
    expect(coarse['min-height']).toBe('44px')
    expect(hasPseudoHitSlop(close)).toBe(false)
    await userEvent.setup().click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('has no extra Tab stop on a fine pointer (desktop Tab order unchanged)', () => {
    restorePointer = setPointer(false)
    render(themed(<CommandPalette open onClose={vi.fn()} />))
    expect(screen.queryByTestId('command-palette-close')).not.toBeInTheDocument()
  })

  it('a single tap on a result row selects and closes; the results area scrolls', async () => {
    restorePointer = setPointer(true)
    const onSelectPersona = vi.fn()
    const onClose = vi.fn()
    render(themed(
      <CommandPalette
        open
        onClose={onClose}
        onSelectPersona={onSelectPersona}
        renderPersonaResults={slot => (
          <button type="button" data-testid="row" onClick={() => slot.onSelectPersona('p1')}>Row</button>
        )}
      />,
    ))
    const results = screen.getByTestId('command-palette-personas').parentElement as HTMLElement
    expect(getComputedStyle(results).overflowY).toBe('auto')
    await userEvent.setup().click(screen.getByTestId('row'))
    expect(onSelectPersona).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pads up by the on-screen keyboard height on a coarse pointer', () => {
    restorePointer = setPointer(true)
    restoreKeyboard = stubKeyboard(300)
    render(themed(<CommandPalette open onClose={vi.fn()} />))
    expect(screen.getByTestId('command-palette-backdrop')).toHaveStyle({ paddingBottom: '300px' })
  })

  it('ignores the visual viewport on a fine pointer (desktop pinch-zoom must not shift it)', () => {
    restorePointer = setPointer(false)
    restoreKeyboard = stubKeyboard(300)
    render(themed(<CommandPalette open onClose={vi.fn()} />))
    expect(screen.getByTestId('command-palette-backdrop')).not.toHaveStyle({ paddingBottom: '300px' })
  })
})

describe('PersonaDockHost — touch', () => {
  it('lifts its bottom edge above the on-screen keyboard on a coarse pointer, and follows it', () => {
    restorePointer = setPointer(true)
    restoreKeyboard = stubKeyboard(320)
    render(themed(<PersonaDockHost open onClose={vi.fn()} />))
    expect(screen.getByTestId('persona-dock-host')).toHaveStyle({ bottom: '320px' })
    const vv = window.visualViewport as unknown as { height: number } & EventTarget
    act(() => {
      vv.height = window.innerHeight
      vv.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('persona-dock-host')).toHaveStyle({ bottom: '0px' })
  })

  it('has a 44px Close (the touch twin of Esc)', () => {
    render(themed(<PersonaDockHost open onClose={vi.fn()} />))
    const close = screen.getByRole('button', { name: /close post-as-persona panel/i })
    const coarse = mediaRuleDeclarations(close, 'pointer: coarse')
    expect(coarse['min-width']).toBe('44px')
    expect(coarse['min-height']).toBe('44px')
  })
})
