/**
 * features/controller/engine/components/UsagePanel.providerUnavailable.test.tsx
 * ---------------------------------------------------------------------------
 * Covers WR-004 (feature: engine-telemetry-tuning, story 03c review fold):
 * `useEngineSettings()` leaves `settings` at `null` on a FAILED GET (it only
 * sets `error`) — `<UsagePanel>` must never silently omit the AC1 provider
 * statement in that case, since the historical `byModel` rows (which may
 * name `Fake`) would otherwise be the only provider information on the
 * page, inviting exactly the inference-from-history AC1 exists to prevent.
 *
 * `../hooks/useEngineSettings` is mocked WHOLESALE (mirrors
 * `EngineSettingsPanel.awaitThenApply.test.tsx`'s convention) — deliberately
 * a SEPARATE file from `UsagePanel.test.tsx`, since `vi.mock` is
 * file-scoped/hoisted and would otherwise break that file's tests against
 * the REAL settings store. `useEngineUsage()` stays REAL (via
 * `engineUsageStore.setForTests`) so this file proves only the ONE
 * cross-hook rendering decision WR-004 is about, not a second copy of
 * `UsagePanel.test.tsx`'s volume/cost coverage.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { useEngineSettings, type UseEngineSettingsResult } from '../hooks/useEngineSettings'
import { buildMockEngineUsage, engineUsageStore } from '../hooks/useEngineUsage'
import { UsagePanel } from './UsagePanel'

vi.mock('../hooks/useEngineSettings', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useEngineSettings')>(
    '../hooks/useEngineSettings',
  )
  return { ...actual, useEngineSettings: vi.fn() }
})

const mockedUseEngineSettings = vi.mocked(useEngineSettings)

/** The fixed exercise id `ExerciseContextProvider`'s mock resolver returns. */
const EXERCISE_ID = 'ex-mock-0001'

function settingsResult(overrides: Partial<UseEngineSettingsResult> = {}): UseEngineSettingsResult {
  return {
    settings: null,
    loading: false,
    error: null,
    forbidden: false,
    pendingAutonomyDefault: false,
    pendingTierPolicy: false,
    pendingProviderLever: false,
    setAutonomyDefault: vi.fn(),
    setTierPolicyMode: vi.fn(),
    cutGenerationToFake: vi.fn(),
    restoreGenerationProvider: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  engineUsageStore.resetForTests()
})

afterEach(() => {
  engineUsageStore.resetForTests()
})

function renderPanel() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <UsagePanel open onClose={vi.fn()} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

describe('UsagePanel — WR-004: a FAILED engine-settings read renders an explicit placeholder, never silence', () => {
  it('renders an explicit "unavailable" statement rather than omitting the provider line entirely', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, buildMockEngineUsage(60, Date.parse('2033-09-04T14:00:00.000Z')))
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({
        settings: null,
        error: 'Your session could not be resolved for this exercise — sign back in to view engine usage.',
      }),
    )

    renderPanel()

    const statement = await screen.findByTestId('usage-provider-statement')
    expect(statement).toHaveTextContent(/unavailable/i)
    expect(statement).toHaveTextContent(/not what is live now/i)
  })

  it('pairs the "unavailable" statement with an icon, not colour alone (NFR-001)', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, buildMockEngineUsage(60, Date.parse('2033-09-04T14:00:00.000Z')))
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({ settings: null, error: 'session unresolved' }),
    )

    renderPanel()

    const statement = await screen.findByTestId('usage-provider-statement')
    expect(statement.querySelector('svg')).not.toBeNull()
  })

  it('renders NOTHING for the provider statement while settings is merely still loading (no error yet) — not a false "unavailable"', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, buildMockEngineUsage(60, Date.parse('2033-09-04T14:00:00.000Z')))
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({ settings: null, error: null, loading: true }),
    )

    renderPanel()

    await screen.findByTestId('engine-usage-panel')
    expect(screen.queryByTestId('usage-provider-statement')).not.toBeInTheDocument()
  })

  it('still renders the normal provider statement once settings resolves successfully', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, buildMockEngineUsage(60, Date.parse('2033-09-04T14:00:00.000Z')))
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({
        settings: {
          provider: 'AzureOpenAI',
          effectiveProvider: 'AzureOpenAI',
          providerCutToFake: false,
          alreadyFake: false,
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
      }),
    )

    renderPanel()

    const statement = await screen.findByTestId('usage-provider-statement')
    expect(statement).toHaveTextContent('AzureOpenAI')
    expect(statement).not.toHaveTextContent(/unavailable/i)
  })
})
