/**
 * features/controller/engine/console/EngineControlBar.rearm.test.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 15 (D5-025; Tom, 10/16): on a COARSE pointer the kill switch's
 * STOP -> Live re-arm asks first, while STOPPING stays one tap. The dialog restates the change,
 * opens with no focused button, ignores taps for 400ms (399ms ignored, 400ms fires), fires once,
 * and Cancel / Escape leave the engine STOPPED with focus back on the kill switch. A fine pointer
 * keeps the unchanged one-click cycle (also covered by `EngineControlBar.test.tsx`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { reviewStore } from '../services/reviewStore'
import { engineControlStore } from '../hooks/useEngineControl'
import { engineSettingsStore } from '../hooks/useEngineSettings'
import { mockPointer, restoreMatchMedia } from '../../components/confirm/coarsePointer.testUtils'
import { EngineControlBar } from './EngineControlBar'

// STOP -> Live is a raise: only the lead controller may do it (identity-auth-roles story 17).
vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

function renderBar() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EngineControlBar />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

const EXERCISE_ID = 'ex-mock-0001'

function autonomyEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.autonomy_changed')
}

/** Live -> Suggest-only -> STOP, one tap each. */
async function stopEngine() {
  const killSwitch = await screen.findByTestId('engine-kill-switch')
  fireEvent.click(killSwitch)
  fireEvent.click(killSwitch)
  expect(killSwitch).toHaveAttribute('data-mode', 'stop')
  return killSwitch
}

beforeEach(() => {
  resetStubSession()
  setStubSession({ role: 'controller', isLead: true })
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
  resetExerciseClock()
  engineSettingsStore.resetForTests()
})

describe('kill switch STOP -> Live on a coarse pointer', () => {
  it('stopping stays one tap: Live -> Suggest-only -> STOP with no dialog', async () => {
    mockPointer(true)
    renderBar()
    await stopEngine()
    expect(screen.queryByTestId('engine-rearm-dialog')).not.toBeInTheDocument()
  })

  it('re-arm opens a confirm instead of going Live, with no focused button', async () => {
    mockPointer(true)
    renderBar()
    const killSwitch = await stopEngine()
    fireEvent.click(killSwitch)

    const dialog = await screen.findByTestId('engine-rearm-dialog')
    expect(dialog).toHaveTextContent('Re-arm the engine?')
    expect(killSwitch).toHaveAttribute('data-mode', 'stop')
    expect(document.activeElement?.tagName).not.toBe('BUTTON')
    const confirm = screen.getByTestId('engine-rearm-confirm')
    const cancel = screen.getByTestId('engine-rearm-cancel')
    expect(Number.parseFloat(getComputedStyle(confirm).minHeight)).toBe(44)
    expect(Number.parseFloat(getComputedStyle(cancel).minHeight)).toBe(44)
    const row = confirm.parentElement as HTMLElement
    expect(Number.parseFloat(getComputedStyle(row).gap)).toBeGreaterThanOrEqual(8)
    expect(row.lastElementChild).toBe(confirm)
  })

  it('ignores Re-arm at 399ms, fires at 400ms, once', async () => {
    mockPointer(true)
    renderBar()
    const killSwitch = await stopEngine()
    const eventsBefore = autonomyEvents().length
    vi.useFakeTimers()
    fireEvent.click(killSwitch)
    const confirm = screen.getByTestId('engine-rearm-confirm')

    act(() => {
      vi.advanceTimersByTime(399)
    })
    fireEvent.click(confirm)
    expect(killSwitch).toHaveAttribute('data-mode', 'stop')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(killSwitch).toHaveAttribute('data-mode', 'live')
    // Exactly one re-arm reached the mode setter (one telemetry event), not one per tap.
    expect(autonomyEvents()).toHaveLength(eventsBefore + 1)
  })

  it('drops a stale dialog when the engine is re-armed elsewhere (no second POST)', async () => {
    mockPointer(true)
    renderBar()
    const killSwitch = await stopEngine()
    fireEvent.click(killSwitch)
    await screen.findByTestId('engine-rearm-dialog')
    const eventsBefore = autonomyEvents().length

    // Another controller re-armed it; this console adopts the server's mode silently.
    act(() => {
      engineControlStore.adoptServerMode(EXERCISE_ID, 'live')
    })
    await vi.waitFor(() => {
      expect(screen.queryByTestId('engine-rearm-dialog')).not.toBeInTheDocument()
    })
    expect(killSwitch).toHaveAttribute('data-mode', 'live')
    expect(autonomyEvents()).toHaveLength(eventsBefore)
  })

  it('Escape cancels, the engine stays STOPPED and focus returns to the kill switch', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderBar()
    const killSwitch = await stopEngine()
    await user.click(killSwitch)
    await screen.findByTestId('engine-rearm-dialog')
    await user.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(screen.queryByTestId('engine-rearm-dialog')).not.toBeInTheDocument()
    })
    expect(killSwitch).toHaveAttribute('data-mode', 'stop')
    expect(document.activeElement).toBe(killSwitch)
  })

  it('Cancel leaves the engine STOPPED', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderBar()
    const killSwitch = await stopEngine()
    await user.click(killSwitch)
    await user.click(await screen.findByTestId('engine-rearm-cancel'))
    expect(killSwitch).toHaveAttribute('data-mode', 'stop')
  })
})

describe('kill switch on a fine pointer', () => {
  it('STOP -> Live is still one click, no dialog', async () => {
    mockPointer(false)
    renderBar()
    const killSwitch = await stopEngine()
    fireEvent.click(killSwitch)
    expect(killSwitch).toHaveAttribute('data-mode', 'live')
    expect(screen.queryByTestId('engine-rearm-dialog')).not.toBeInTheDocument()
  })
})
