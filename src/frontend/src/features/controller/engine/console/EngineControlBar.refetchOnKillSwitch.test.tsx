/**
 * features/controller/engine/console/EngineControlBar.refetchOnKillSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the Gate-1 CR-001 WIRING in `<EngineControlBar>`: the kill switch
 * (`useEngineControl().setMode`) mutates the SAME server-side autonomy state
 * `useEngineSettings()` describes, entirely outside that hook, so this
 * component calls `engineSettings.refetch()` whenever the kill-switch mode or
 * the degraded clamp changes — closing the window where tripping the switch
 * would leave the "Live" label reporting a clamp that's no longer accurate.
 *
 * `../hooks/useEngineSettings` is mocked wholesale here (a lower-level, more
 * targeted unit than exercising the real store live end-to-end — the real
 * store's own refetch/reconciliation behaviour is covered exhaustively in
 * `useEngineSettings.test.ts`; this file proves only that THIS component
 * calls `refetch()` at the right moments, not a second time).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../services/reviewStore'
import { engineControlStore } from '../hooks/useEngineControl'
import { useEngineSettings, type UseEngineSettingsResult } from '../hooks/useEngineSettings'
import { EngineControlBar } from './EngineControlBar'

vi.mock('../hooks/useEngineSettings', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useEngineSettings')>(
    '../hooks/useEngineSettings',
  )
  return { ...actual, useEngineSettings: vi.fn() }
})

const mockedUseEngineSettings = vi.mocked(useEngineSettings)
const refetchMock = vi.fn()

function settingsResult(overrides: Partial<UseEngineSettingsResult> = {}): UseEngineSettingsResult {
  return {
    settings: {
      provider: 'Fake',
      tiers: [],
      autonomy: {
        swampedMode: false,
        generationStopped: false,
        safetyClampActive: false,
        degradedReason: null,
        exerciseDefaultLevel: 'suggest',
        effectiveLevel: 'suggest',
      },
      tierPolicyMode: 'auto',
      inMemoryState: true,
      inMemoryStateNote: 'reset on restart',
    },
    loading: false,
    error: null,
    forbidden: false,
    setAutonomyDefault: vi.fn(),
    setTierPolicyMode: vi.fn(),
    refetch: refetchMock,
    ...overrides,
  }
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  resetTelemetryBuffer()
  refetchMock.mockReset()
  mockedUseEngineSettings.mockReturnValue(settingsResult())
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

function renderBar() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EngineControlBar />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

describe('EngineControlBar — refetches engine settings on a kill-switch change (Gate-1 CR-001)', () => {
  it('does NOT refetch merely on mount (the hook itself already fetched once)', async () => {
    renderBar()
    await screen.findByTestId('engine-control-bar')

    expect(refetchMock).not.toHaveBeenCalled()
  })

  it('refetches once per kill-switch mode change (Live -> Suggest-only -> Stop)', async () => {
    renderBar()
    const killSwitch = await screen.findByTestId('engine-control-bar').then(() =>
      screen.getByTestId('engine-kill-switch'),
    )

    fireEvent.click(killSwitch) // Live -> Suggest-only
    expect(refetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(killSwitch) // Suggest-only -> Stop
    expect(refetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(killSwitch) // Stop -> Live
    expect(refetchMock).toHaveBeenCalledTimes(3)
  })
})
