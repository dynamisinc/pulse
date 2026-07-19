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
})
