/**
 * features/controller/console/CommandPalette.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (console-shell) — RTL coverage for the ⌘K command palette shell
 * (AC "⌘K command palette", NFR-001):
 *
 *  - Renders nothing when closed; a `role="dialog"` overlay when open, with a
 *    PERSONAS section.
 *  - On open, focus moves to the search field (keyboard-first, no pointer).
 *  - Esc closes it AND focus returns to the trigger that opened it.
 *  - Focus is TRAPPED: Tab past the last element wraps to the first, and
 *    Shift+Tab past the first wraps to the last.
 *  - Selecting a persona from the PERSONAS slot hands the id back
 *    (`onSelectPersona`) and closes the palette.
 *  - Without a persona-list slot (the fan-out state), the PERSONAS section
 *    shows a neutral placeholder — the seam persona-operation/02 fills.
 *
 * Wrapped in the COBRA theme because `CobraTextField` reads COBRA palette
 * augmentations (`buttonPrimary`).
 */
import { useState, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { CommandPalette, type CommandPalettePersonaSlot } from './CommandPalette'

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>)
}

/** Controlled harness with a trigger, mirroring how the console owns open state. */
function PaletteHarness({
  renderPersonaResults,
  onSelectPersona,
}: {
  renderPersonaResults?: (slot: CommandPalettePersonaSlot) => ReactNode
  onSelectPersona?: (personaId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open palette
      </button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        onSelectPersona={onSelectPersona}
        renderPersonaResults={renderPersonaResults}
      />
    </>
  )
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    renderWithTheme(<CommandPalette open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a labelled dialog with a PERSONAS section and focuses the search field', async () => {
    const user = userEvent.setup()
    renderWithTheme(<PaletteHarness />)

    await user.click(screen.getByTestId('trigger'))

    const dialog = screen.getByRole('dialog', { name: /command palette/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('command-palette-personas')).toBeInTheDocument()
    expect(screen.getByLabelText('Search personas and commands')).toHaveFocus()
  })

  it('shows a placeholder in the PERSONAS section when no persona list is wired', async () => {
    const user = userEvent.setup()
    renderWithTheme(<PaletteHarness />)
    await user.click(screen.getByTestId('trigger'))
    expect(screen.getByTestId('command-palette-personas-placeholder')).toBeInTheDocument()
  })

  it('closes on Esc and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderWithTheme(<PaletteHarness />)

    const trigger = screen.getByTestId('trigger')
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('traps focus — Tab past the last element wraps to the first, and back', async () => {
    const user = userEvent.setup()
    renderWithTheme(
      <PaletteHarness
        renderPersonaResults={({ onSelectPersona }) => (
          <button
            type="button"
            data-testid="persona-option"
            onClick={() => onSelectPersona('persona-1')}
          >
            Persona One
          </button>
        )}
      />,
    )

    await user.click(screen.getByTestId('trigger'))
    const search = screen.getByLabelText('Search personas and commands')
    const option = screen.getByTestId('persona-option')

    expect(search).toHaveFocus()
    await user.tab() // search -> option (last)
    expect(option).toHaveFocus()
    await user.tab() // option -> wraps to search (first)
    expect(search).toHaveFocus()
    await user.tab({ shift: true }) // search -> wraps back to option (last)
    expect(option).toHaveFocus()
  })

  it('hands the chosen persona back and closes when a persona is selected', async () => {
    const user = userEvent.setup()
    const onSelectPersona = vi.fn()
    renderWithTheme(
      <PaletteHarness
        onSelectPersona={onSelectPersona}
        renderPersonaResults={({ onSelectPersona: select }) => (
          <button type="button" data-testid="persona-option" onClick={() => select('persona-42')}>
            Persona 42
          </button>
        )}
      />,
    )

    await user.click(screen.getByTestId('trigger'))
    await user.click(screen.getByTestId('persona-option'))

    expect(onSelectPersona).toHaveBeenCalledWith('persona-42')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
