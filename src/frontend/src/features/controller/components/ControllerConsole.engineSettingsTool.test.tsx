/**
 * features/controller/components/ControllerConsole.engineSettingsTool.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the "ENGINE" toolstrip tool + its settings flyout (feature:
 * autonomy-safety, story 06):
 *  - registers into the toolstrip SURFACE zone (not shell-global), no badge;
 *  - activating it opens `<EngineSettingsPanel>`, keyed on
 *    `isActive(ENGINE_SETTINGS_TOOL_ID)` — the SAME one-flyout-at-a-time
 *    toolstrip contract the "Personas" tool already uses, so opening ENGINE
 *    closes an already-open Personas palette and vice versa;
 *  - Escape closes the panel and returns focus to the toolstrip button.
 *  - Gate-1 WR-005: activating ENGINE while the persona-dock host is open
 *    (from an EARLIER persona selection — a state independent of the
 *    toolstrip's `activeToolId`) closes that dock, so a still-mounted,
 *    still-Tab-reachable persona composer is never left obscured underneath
 *    the engine panel.
 *
 * Mirrors `ControllerConsole.test.tsx`'s / `.engineDock.test.tsx`'s render
 * setup (real `ExerciseContextProvider` + `ToolstripProvider` + the shipped
 * `<Toolstrip>` dock).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { ControllerConsole } from './ControllerConsole'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
})

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

describe('ControllerConsole — the "ENGINE" settings tool', () => {
  it('registers into the toolstrip SURFACE zone with no badge', async () => {
    renderConsole()
    await screen.findByTestId('controller-console')

    const surfaceZone = screen.getByTestId('toolstrip-zone-surface')
    const engineButton = await within(surfaceZone).findByTestId('toolstrip-tool-engine-settings')
    expect(engineButton).toBeInTheDocument()
    expect(engineButton).toHaveAccessibleName('ENGINE')
    expect(screen.queryByTestId('toolstrip-badge-engine-settings')).not.toBeInTheDocument()

    const shellGlobalZone = screen.getByTestId('toolstrip-zone-shell-global')
    expect(within(shellGlobalZone).queryByTestId('toolstrip-tool-engine-settings')).not.toBeInTheDocument()
  })

  it('opens the settings panel when activated, keeping the console body mounted', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))

    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()
    expect(screen.getByTestId('controller-console')).toBeInTheDocument()
    expect(screen.getByTestId('engine-control-bar')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the toolstrip button', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    const engineButton = await screen.findByTestId('toolstrip-tool-engine-settings')
    await user.click(engineButton)
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('engine-settings-panel')).not.toBeInTheDocument())
    expect(engineButton).toHaveFocus()
  })

  it('activating ENGINE closes an already-open Personas palette (one-flyout-at-a-time)', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('activating Personas closes an already-open ENGINE settings panel', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('engine-settings-panel')).not.toBeInTheDocument())
  })

  it('Gate-1 WR-005: activating ENGINE closes an already-open persona-dock host, so a mounted composer is never obscured underneath it', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <ToolstripProvider>
            <ControllerConsole
              renderPersonaResults={({ onSelectPersona }) => (
                <button
                  type="button"
                  data-testid="pick-persona"
                  onClick={() => onSelectPersona('persona-1')}
                >
                  pick persona-1
                </button>
              )}
            />
            <Toolstrip />
          </ToolstripProvider>
        </ExerciseContextProvider>
      </ThemeProvider>,
    )
    await screen.findByTestId('controller-console')

    // Open the palette and select a persona — this closes the palette (its
    // OWN `onClose`) but opens the persona-dock host, a state the toolstrip's
    // `activeToolId` does NOT track.
    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    await user.click(await screen.findByTestId('pick-persona'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByTestId('persona-dock-host')).toBeInTheDocument()

    // Activating ENGINE must close the still-open dock rather than painting
    // the engine panel over it.
    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())
  })
})
