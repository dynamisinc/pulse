/**
 * features/controller/console/personaDockHost.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (console-shell) — RTL coverage for the persona-dock host mount slot
 * (AC "Persona-dock host", NFR-001):
 *
 *  - Renders nothing when closed; a labelled `role="region"` flyout when open.
 *  - Empty of persona content by default — shows a neutral placeholder (the
 *    seam persona-operation fills at integration).
 *  - Renders the `slots` (picker/composer/context panel) when provided; the
 *    placeholder disappears.
 *  - Keyboard-operable: Esc closes; focus returns to the opener on close.
 */
import { useState, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
// Component from the `.tsx` (explicit extension — a bare specifier resolves to
// the sibling `.ts`); the slot type from the `.ts`.
import { PersonaDockHost } from './personaDockHost.tsx'
import type { PersonaDockSlots } from './personaDockHost'

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>)
}

function DockHarness({ slots }: { slots?: PersonaDockSlots }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open dock
      </button>
      <PersonaDockHost open={open} onClose={() => setOpen(false)} slots={slots} />
    </>
  )
}

describe('PersonaDockHost', () => {
  it('renders nothing when closed', () => {
    renderWithTheme(<PersonaDockHost open={false} onClose={vi.fn()} />)
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
  })

  it('renders a labelled region with a placeholder when open and empty', () => {
    renderWithTheme(<PersonaDockHost open onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: /post as persona/i })).toBeInTheDocument()
    expect(screen.getByTestId('persona-dock-placeholder')).toBeInTheDocument()
  })

  it('renders the persona-operation slots when provided (no placeholder)', () => {
    renderWithTheme(
      <PersonaDockHost
        open
        onClose={vi.fn()}
        slots={{ composer: <div data-testid="composer-slot">composer</div> }}
      />,
    )
    expect(screen.getByTestId('composer-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('persona-dock-placeholder')).not.toBeInTheDocument()
  })

  it('closes on Esc and returns focus to the opener', async () => {
    const user = userEvent.setup()
    renderWithTheme(<DockHarness />)

    const trigger = screen.getByTestId('trigger')
    await user.click(trigger)
    expect(screen.getByTestId('persona-dock-host')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('moves focus to the close button on open (keyboard users land inside, no pointer required)', async () => {
    // TESTER-added: the module header promises "On open, focus moves to the
    // close button" as part of the NFR-001 keyboard-operability contract, but
    // no existing test observes it — only the round-trip back to the opener
    // on close. A regression that drops the open-time `.focus()` call (while
    // leaving the close-time restore intact) would pass every other test here
    // but fail this one.
    const user = userEvent.setup()
    renderWithTheme(<DockHarness />)

    await user.click(screen.getByTestId('trigger'))

    expect(screen.getByRole('button', { name: 'Close post-as-persona panel' })).toHaveFocus()
  })
})
