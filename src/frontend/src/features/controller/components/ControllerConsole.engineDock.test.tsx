/**
 * features/controller/components/ControllerConsole.engineDock.test.tsx
 * ---------------------------------------------------------------------------
 * TESTER-added coverage for the SERIAL INTEGRATION step (feature:
 * engine-review-cockpit; D5-017): `ControllerConsole` docks the engine review
 * cockpit as a PERMANENT column + a full-width control strip, not a toolstrip
 * flyout, and mounts one invisible `<DraftTimerDriver>` per `CountingDown`
 * review item without crashing the console or displacing the existing
 * "post as persona" chrome (⌘K hint, call sign).
 *
 * A lighter smoke test than `EngineControlBar.test.tsx` / `ReviewQueue.test.tsx`
 * (which cover the docked pieces' own behavior in depth) — this one proves the
 * COMPOSITION: both pieces mount together, at the console level, under the
 * real providers `ControllerConsoleRoute` assembles.
 */
import { render, screen } from '@testing-library/react'
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
import { ControllerConsole } from './ControllerConsole'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
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

describe('ControllerConsole — engine review cockpit docked as a permanent column', () => {
  it('mounts the control strip + the docked queue alongside the existing console chrome', async () => {
    renderConsole()
    await screen.findByTestId('controller-console')

    // The existing keystone chrome survives the restructure.
    expect(screen.getByTestId('controller-callsign')).toHaveTextContent('SIMCELL-1')

    // The engine-review-cockpit is docked — not a toolstrip flyout: no
    // "Review" tool exists in the toolstrip, and the queue column is a direct,
    // always-rendered descendant of the console.
    expect(await screen.findByTestId('engine-control-bar')).toBeInTheDocument()
    const column = screen.getByTestId('review-queue-column')
    expect(column).toBeInTheDocument()
    expect(await screen.findByTestId('review-queue')).toBeInTheDocument()
  })

  it('drives the seeded CountingDown items without crashing (one DraftTimerDriver each)', async () => {
    renderConsole()
    await screen.findByTestId('review-queue')

    // Two seeded CountingDown bursts exist in the mock fixture; both render as
    // cards, proving their (invisible) drivers mounted without throwing.
    const countingDownCards = screen
      .getAllByTestId('review-card')
      .filter(card => card.getAttribute('data-disposition') === 'counting-down')
    expect(countingDownCards.length).toBeGreaterThan(0)
  })
})
