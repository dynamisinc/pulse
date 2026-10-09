/**
 * features/controller/ControllerConsoleRoute.test.tsx
 * ---------------------------------------------------------------------------
 * The `/console` ROUTE composition, mounted for REAL (inject-queue story 07, #453) — the
 * "built, tested, green, wired to nothing" guard: a panel with passing unit tests that the
 * route never mounts would be invisible on stage. Nothing here injects a fixture or a
 * `runSheetSlot` of its own: the REAL `ControllerConsoleRoute` assembles the console, and
 * the assertions look for the run sheet INSIDE the console's run-sheet slot.
 *
 *  - the run sheet renders in the console (the slot status line "not connected" is gone) and
 *    lists the mock queue (the dev demo script) through the real hooks + service seam;
 *  - an action pressed in the slot reaches the queue (Fire next -> Fired);
 *  - PAUSE INJECTS set through the REAL PausePill reaches the run sheet (the mock pause
 *    bridge): the suspended banner appears and Resume clears it; FREEZE disables Fire with
 *    "World frozen". Without the bridge the mock queue would never see the tier.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { ControllerConsoleRoute } from './ControllerConsoleRoute'
import { resetPauseStateForTest } from './hooks/usePauseState'
import { reviewStore } from './engine/services/reviewStore'
import { engineControlStore } from './engine/hooks/useEngineControl'
import { injectMock } from './runSheet/injectMock'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  resetPauseStateForTest()
  resetTelemetryBuffer()
  injectMock.reset() // the dev demo script (4 items)
})

afterEach(() => {
  injectMock.dispose()
  resetPauseStateForTest()
  resetExerciseClock()
})

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExerciseContextProvider>
            <ControllerConsoleRoute />
          </ExerciseContextProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

const LONG = { timeout: 8000 }

/** The run sheet, found INSIDE the console's run-sheet slot (not anywhere on the page). */
async function findRunSheet(): Promise<HTMLElement> {
  const slot = await screen.findByTestId('console-slot-run-sheet', undefined, LONG)
  return await within(slot).findByTestId('run-sheet-panel', undefined, LONG)
}

const rowTitles = (sheet: HTMLElement): string[] =>
  within(sheet).queryAllByTestId('row-title').map(el => el.textContent ?? '')

describe('ControllerConsoleRoute: the run sheet is mounted in the console', () => {
  it('renders the run sheet in the console run-sheet slot and lists the queue', async () => {
    renderRoute()
    const sheet = await findRunSheet()

    // The "not connected" status line is gone: the slot is really supplied.
    expect(screen.queryByTestId('console-slots-status')).toBeNull()
    expect(screen.getByTestId('console-slot-run-sheet')).toContainElement(sheet)
    await waitFor(() => expect(rowTitles(sheet)).toHaveLength(4), LONG)
    expect(rowTitles(sheet)).toContain('Boil-water advisory (official)')
    // Real chrome around it: the same console carries the review queue and the pause pill.
    expect(screen.getByTestId('review-queue-column')).toBeInTheDocument()
    expect(screen.getByTestId('pause-pill')).toBeInTheDocument()
  })

  it('an action in the slot reaches the queue: Fire next fires the first pending item', async () => {
    const user = userEvent.setup()
    renderRoute()
    const sheet = await findRunSheet()
    await waitFor(() => expect(rowTitles(sheet)).toHaveLength(4), LONG)

    await user.click(within(sheet).getByRole('button', { name: 'Fire next pending item' }))
    await waitFor(
      () => expect(injectMock.snapshot().items.find(i => i.order === 1)?.status).toBe('fired'),
      LONG,
    )
    const first = within(sheet).getAllByTestId('run-sheet-row')[0]
    if (!first) throw new Error('no rows')
    await waitFor(() => expect(within(first).getByTestId('status-text')).toHaveTextContent('Fired'), LONG)
  })
})

describe('ControllerConsoleRoute: PausePill reaches the run sheet (mock pause bridge)', () => {
  it('PAUSE INJECTS shows the suspended banner; Resume clears it', async () => {
    const user = userEvent.setup()
    renderRoute()
    const sheet = await findRunSheet()
    await waitFor(() => expect(rowTitles(sheet)).toHaveLength(4), LONG)
    expect(within(sheet).queryByTestId('banner-injects-paused')).toBeNull()

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-tier-option-injects'))
    await user.click(screen.getByTestId('pause-apply'))

    expect(await within(sheet).findByTestId('banner-injects-paused', undefined, LONG)).toHaveTextContent(
      'Injects paused: bursts are suspended; manual fire still works',
    )
    expect(injectMock.snapshot().pauseTier).toBe('injects')
    // Manual fire still works while injects are paused.
    expect(within(sheet).getByRole('button', { name: 'Fire next pending item' })).toBeEnabled()

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-resume'))
    await waitFor(() => expect(within(sheet).queryByTestId('banner-injects-paused')).toBeNull(), LONG)
    expect(injectMock.snapshot().pauseTier).toBe('running')
  })

  it('FREEZE (confirmed) disables Fire in the run sheet with "World frozen"', async () => {
    const user = userEvent.setup()
    renderRoute()
    const sheet = await findRunSheet()
    await waitFor(() => expect(rowTitles(sheet)).toHaveLength(4), LONG)

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-tier-option-freeze'))
    await user.click(screen.getByTestId('pause-apply'))
    const confirm = screen.getByTestId('pause-freeze-confirm')
    await user.click(within(confirm).getByTestId('pause-freeze-confirm-button'))

    expect(await within(sheet).findByTestId('banner-frozen', undefined, LONG)).toHaveTextContent(
      'World frozen',
    )
    expect(within(sheet).getByRole('button', { name: 'Fire next pending item' })).toBeDisabled()
    expect(injectMock.snapshot().pauseTier).toBe('freeze')
  })
})
