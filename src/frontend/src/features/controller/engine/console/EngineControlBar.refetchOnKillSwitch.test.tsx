/**
 * features/controller/engine/console/EngineControlBar.refetchOnKillSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the Gate-1 CR-001/CR-101 WIRING in `<EngineControlBar>`: the kill
 * switch (`useEngineControl().setMode`) mutates the SAME server-side autonomy
 * state `useEngineSettings()` describes, entirely outside that hook, so this
 * component calls `engineSettings.refetch()` — but ONLY once the live
 * kill-switch POST has actually SETTLED (`modeSettledCount`), never on the
 * synchronous optimistic `mode` flip that fires in the SAME call as the POST.
 *
 * Gate-1 CR-101 (re-review) found the original wiring watched raw `mode`,
 * which changes in the same tick the POST is ISSUED — so the settings GET
 * raced the kill-switch POST, and (being one filter vs. the POST's mutation +
 * validation + a telemetry write) was favoured to WIN that race, applying a
 * pre-trip snapshot as authoritative with nothing left to correct it. Both
 * `useEngineControl` AND `useEngineSettings` are mocked wholesale here so the
 * test can independently control `mode`/`degraded`/`modeSettledCount` across
 * renders and observe exactly which transition triggers `refetch()` — the
 * real stores' own behaviour is covered in `useEngineControl.test.ts` /
 * `useEngineSettings.test.ts`; this file proves only THIS component's wiring.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { AutonomyLevel, runningAutonomy } from '../models/reviewContracts'
import { useEngineControl, type UseEngineControlResult } from '../hooks/useEngineControl'
import { useEngineSettings, type UseEngineSettingsResult } from '../hooks/useEngineSettings'
import { EngineControlBar } from './EngineControlBar'

vi.mock('../hooks/useEngineControl', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useEngineControl')>(
    '../hooks/useEngineControl',
  )
  return { ...actual, useEngineControl: vi.fn() }
})

vi.mock('../hooks/useEngineSettings', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useEngineSettings')>(
    '../hooks/useEngineSettings',
  )
  return { ...actual, useEngineSettings: vi.fn() }
})

const mockedUseEngineControl = vi.mocked(useEngineControl)
const mockedUseEngineSettings = vi.mocked(useEngineSettings)
const refetchMock = vi.fn()

function controlResult(overrides: Partial<UseEngineControlResult> = {}): UseEngineControlResult {
  return {
    mode: 'live',
    effective: runningAutonomy(AutonomyLevel.DelayedAuto),
    degraded: false,
    degradedReason: null,
    setMode: vi.fn(),
    degrade: vi.fn(),
    restore: vi.fn(),
    modeSettledCount: 0,
    ...overrides,
  }
}

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
  refetchMock.mockReset()
  mockedUseEngineControl.mockReturnValue(controlResult())
  mockedUseEngineSettings.mockReturnValue(settingsResult())
})

afterEach(() => {
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

describe('EngineControlBar — refetches engine settings only once the kill-switch POST SETTLES (Gate-1 CR-101)', () => {
  it('does NOT refetch merely on mount', async () => {
    renderBar()
    await screen.findByTestId('engine-control-bar')

    expect(refetchMock).not.toHaveBeenCalled()
  })

  it('does NOT refetch when `mode` changes but `modeSettledCount` has not (the optimistic flip, POST still in flight)', async () => {
    const { rerender } = renderBar()
    await screen.findByTestId('engine-control-bar')

    // Simulates `setMode`'s synchronous optimistic flip: `mode` changes,
    // `modeSettledCount` does not (the live POST hasn't settled yet).
    mockedUseEngineControl.mockReturnValue(controlResult({ mode: 'suggest-only', modeSettledCount: 0 }))
    rerender(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <EngineControlBar />
        </ExerciseContextProvider>
      </ThemeProvider>,
    )

    expect(refetchMock).not.toHaveBeenCalled()
  })

  it('refetches once `modeSettledCount` bumps (the POST has settled) — this is the CR-101 fix', async () => {
    const { rerender } = renderBar()
    await screen.findByTestId('engine-control-bar')

    const rerenderWith = (state: UseEngineControlResult) => {
      mockedUseEngineControl.mockReturnValue(state)
      rerender(
        <ThemeProvider theme={cobraTheme}>
          <ExerciseContextProvider>
            <EngineControlBar />
          </ExerciseContextProvider>
        </ThemeProvider>,
      )
    }

    // The optimistic flip first (no refetch yet — see the test above)...
    rerenderWith(controlResult({ mode: 'suggest-only', modeSettledCount: 0 }))
    expect(refetchMock).not.toHaveBeenCalled()

    // ...then the POST settles: `modeSettledCount` bumps (mode unchanged).
    rerenderWith(controlResult({ mode: 'suggest-only', modeSettledCount: 1 }))
    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches on a `degraded` change directly — no settle signal needed (it is a synchronous, mock-only clamp with no live POST)', async () => {
    const { rerender } = renderBar()
    await screen.findByTestId('engine-control-bar')

    mockedUseEngineControl.mockReturnValue(controlResult({ degraded: true, degradedReason: 'provider timeout' }))
    rerender(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <EngineControlBar />
        </ExerciseContextProvider>
      </ThemeProvider>,
    )

    expect(refetchMock).toHaveBeenCalledTimes(1)
  })
})
