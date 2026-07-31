/**
 * features/controller/components/ControllerConsole.usageTool.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the "USAGE" toolstrip tool + its flyout (feature: engine-telemetry-
 * tuning, story 03c) — the non-negotiable proof the panel is REACHABLE from a
 * rendered `<ControllerConsole>`, not merely a component file nobody opens:
 *  - registers into the toolstrip SURFACE zone (not shell-global), no badge;
 *  - activating it opens `<UsagePanel>`, keyed on
 *    `isActive(ENGINE_USAGE_TOOL_ID)` — the SAME one-flyout-at-a-time
 *    toolstrip contract "Personas"/ENGINE already use, so opening USAGE
 *    closes an already-open ENGINE settings panel (and vice versa) and an
 *    already-open Personas palette;
 *  - Escape closes the panel and returns focus to the toolstrip button;
 *  - activating USAGE closes an already-open persona-dock host, so a
 *    still-mounted, still-Tab-reachable persona composer is never left
 *    obscured underneath it (the same WR-005 shape ENGINE's own test covers).
 *
 * Mirrors `ControllerConsole.engineSettingsTool.test.tsx`'s render setup
 * (real `ExerciseContextProvider` + `ToolstripProvider` + the shipped
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
import { engineUsageStore } from '../engine/hooks/useEngineUsage'
import { ControllerConsole } from './ControllerConsole'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  engineUsageStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
  engineUsageStore.resetForTests()
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

describe('ControllerConsole — the "USAGE" tool', () => {
  it('registers into the toolstrip SURFACE zone with no badge', async () => {
    renderConsole()
    await screen.findByTestId('controller-console')

    const surfaceZone = screen.getByTestId('toolstrip-zone-surface')
    const usageButton = await within(surfaceZone).findByTestId('toolstrip-tool-engine-usage')
    expect(usageButton).toBeInTheDocument()
    expect(usageButton).toHaveAccessibleName('USAGE')
    expect(screen.queryByTestId('toolstrip-badge-engine-usage')).not.toBeInTheDocument()

    const shellGlobalZone = screen.getByTestId('toolstrip-zone-shell-global')
    expect(within(shellGlobalZone).queryByTestId('toolstrip-tool-engine-usage')).not.toBeInTheDocument()
  })

  it('opens the usage panel when activated, keeping the console body mounted', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-engine-usage'))

    expect(await screen.findByTestId('engine-usage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('controller-console')).toBeInTheDocument()
    expect(screen.getByTestId('engine-control-bar')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the toolstrip button', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    const usageButton = await screen.findByTestId('toolstrip-tool-engine-usage')
    await user.click(usageButton)
    expect(await screen.findByTestId('engine-usage-panel')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('engine-usage-panel')).not.toBeInTheDocument())
    expect(usageButton).toHaveFocus()
  })

  it('activating USAGE closes an already-open ENGINE settings panel (one-flyout-at-a-time)', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()

    await user.click(await screen.findByTestId('toolstrip-tool-engine-usage'))
    expect(await screen.findByTestId('engine-usage-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('engine-settings-panel')).not.toBeInTheDocument())
  })

  it('activating ENGINE closes an already-open USAGE panel (one-flyout-at-a-time, the reverse direction)', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-engine-usage'))
    expect(await screen.findByTestId('engine-usage-panel')).toBeInTheDocument()

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('engine-usage-panel')).not.toBeInTheDocument())
  })

  it('activating USAGE closes an already-open Personas palette (one-flyout-at-a-time)', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()

    await user.click(await screen.findByTestId('toolstrip-tool-engine-usage'))
    expect(await screen.findByTestId('engine-usage-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Gate-1 WR-005 (usage variant): activating USAGE closes an already-open persona-dock host, so a mounted composer is never obscured underneath it', async () => {
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

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    await user.click(await screen.findByTestId('pick-persona'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByTestId('persona-dock-host')).toBeInTheDocument()

    await user.click(await screen.findByTestId('toolstrip-tool-engine-usage'))
    expect(await screen.findByTestId('engine-usage-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())

    // Focus must land on the usage panel's own close button, mirroring the
    // ENGINE variant's assertion (`ControllerConsole.engineSettingsTool.test.tsx`).
    await waitFor(() => expect(screen.getByTestId('engine-usage-close')).toHaveFocus())
  })
})
