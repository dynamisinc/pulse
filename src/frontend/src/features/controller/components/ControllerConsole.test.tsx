/**
 * features/controller/components/ControllerConsole.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (console-shell, KEYSTONE) — RTL coverage for the console frame
 * content (AC dock-registration, ⌘K palette, D7-011, NFR-001):
 *
 *  - Registers a "Personas" CONSULT-ON-DEMAND tool into the shell toolstrip's
 *    SURFACE zone (not the shell-global zone, not a strip of its own) with a
 *    never-color-only count badge (visible digits + an accessible name that
 *    spells the count out).
 *  - Activating the "Personas" tool opens the command palette without
 *    unmounting the console body (a future live-world/queue column analog).
 *  - ⌘K / Ctrl+K opens the palette too; Esc closes it and the console survives.
 *  - Surfaces the mock controller call sign on the console chrome (COR-018).
 *
 * Rendered inside the real exercise scope + toolstrip provider + the shipped
 * `<Toolstrip>` dock, so the registration is exercised end-to-end against the
 * shipped seam (not a re-implemented fixture). `usePersonas()` resolves the
 * seeded cast via its wired mock adapter, so the badge count is a real,
 * exercise-scoped number.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ControllerConsole } from './ControllerConsole'

function renderConsole() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ControllerConsole />
          <Toolstrip />
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

async function findConsole() {
  return screen.findByTestId('controller-console')
}

describe('ControllerConsole', () => {
  it('surfaces the mock controller call sign (COR-018)', async () => {
    renderConsole()
    await findConsole()
    expect(screen.getByTestId('controller-callsign')).toHaveTextContent('SIMCELL-1')
  })

  it('registers the Personas tool into the toolstrip SURFACE zone with a count badge', async () => {
    renderConsole()
    await findConsole()

    const surfaceZone = screen.getByTestId('toolstrip-zone-surface')
    const personasButton = await within(surfaceZone).findByTestId('toolstrip-tool-personas')
    expect(personasButton).toBeInTheDocument()

    // Not a shell-global (continuous/global) tool — it is consult-on-demand.
    const shellGlobalZone = screen.getByTestId('toolstrip-zone-shell-global')
    expect(within(shellGlobalZone).queryByTestId('toolstrip-tool-personas')).not.toBeInTheDocument()

    // Badge count is visible TEXT (never color-only) and the accessible name
    // spells it out for a screen reader.
    const badge = await screen.findByTestId('toolstrip-badge-personas')
    expect(Number(badge.textContent)).toBeGreaterThan(0)
    expect(personasButton).toHaveAccessibleName(/PERSONAS: \d+ pending/)
  })

  it('opens the command palette when the Personas tool is activated, keeping the console mounted', async () => {
    const user = userEvent.setup()
    renderConsole()
    await findConsole()

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))

    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    // The console body is not displaced/unmounted by the flyout (AC2 analog).
    expect(screen.getByTestId('controller-console')).toBeInTheDocument()
  })

  it('opens the palette on Ctrl+K and closes it on Esc, leaving the console intact', async () => {
    const user = userEvent.setup()
    renderConsole()
    await findConsole()

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('controller-console')).toBeInTheDocument()
  })

  it('does not unmount/remount the console body while the flyout opens and closes', async () => {
    // A stronger check than "still in the document": the SAME heading node
    // must persist across the flyout's open/close cycle. If the console's
    // body were ever conditionally rendered on `paletteOpen` (e.g. hidden
    // behind the flyout instead of composed alongside it), a fresh node would
    // be mounted in its place and this reference-identity check would fail
    // even though a `toBeInTheDocument()`-only assertion would still pass.
    const user = userEvent.setup()
    renderConsole()
    await findConsole()

    const headingBeforeOpen = screen.getByRole('heading', { name: 'CONTROLLER CONSOLE' })

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'CONTROLLER CONSOLE' })).toBe(headingBeforeOpen)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'CONTROLLER CONSOLE' })).toBe(headingBeforeOpen)
  })

  it('activating the Personas tool a second time closes the palette and returns focus to it', async () => {
    // Distinct code path from the Ctrl+K/Esc test above: closing via
    // TOGGLING THE SAME TOOL OFF (click again) rather than Esc. This exercises
    // `closePalette`'s `toggleTool` branch, not just `setKeyboardPaletteOpen`.
    const user = userEvent.setup()
    renderConsole()
    await findConsole()

    const personasButton = await screen.findByTestId('toolstrip-tool-personas')
    await user.click(personasButton)
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()

    await user.click(personasButton)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(personasButton).toHaveFocus()
  })

  it('returns focus to the Personas toolstrip button (not just "a" trigger) on Esc close', async () => {
    // The Ctrl+K test above closes a palette opened by keyboard shortcut, so
    // the captured "trigger" is whatever had focus at that moment (often
    // `document.body` in a fresh render). This test opens via the toolstrip
    // BUTTON itself, so a regression that returns focus to the wrong element
    // (e.g. always `document.body`, or the palette's own search field) fails
    // this specific, stronger assertion.
    const user = userEvent.setup()
    renderConsole()
    await findConsole()

    const personasButton = await screen.findByTestId('toolstrip-tool-personas')
    await user.click(personasButton)
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(personasButton).toHaveFocus()
  })
})
