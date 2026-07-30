/**
 * features/controller/engine/components/EngineSettingsPanel.refetchOnOpen.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the Gate-1 CR-001 WIRING in `<EngineSettingsPanel>`: every OPEN
 * TRANSITION (not "each render while open") calls `useEngineSettings().refetch()`
 * — an operator opening this panel must never see a snapshot that predates a
 * kill-switch trip or a server-side degrade that happened while it was
 * closed. Also covers the Gate-1 WR-004 "Retry" affordance on a load error.
 *
 * `../hooks/useEngineSettings` is mocked wholesale — a lower-level, more
 * targeted unit than exercising the real store live end-to-end (the real
 * store's own refetch/reconciliation behaviour is covered exhaustively in
 * `useEngineSettings.test.ts`; this file proves only that THIS component
 * calls `refetch()` at the right moments).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEngineSettings, type UseEngineSettingsResult } from '../hooks/useEngineSettings'
import { EngineSettingsPanel } from './EngineSettingsPanel'

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
      effectiveProvider: 'Fake',
      providerCutToFake: false,
      alreadyFake: true,
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
    pendingAutonomyDefault: false,
    pendingTierPolicy: false,
    pendingProviderLever: false,
    setAutonomyDefault: vi.fn(),
    setTierPolicyMode: vi.fn(),
    cutGenerationToFake: vi.fn(),
    restoreGenerationProvider: vi.fn(),
    refetch: refetchMock,
    ...overrides,
  }
}

beforeEach(() => {
  refetchMock.mockReset()
  mockedUseEngineSettings.mockReturnValue(settingsResult())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('EngineSettingsPanel — refetches on every open transition (Gate-1 CR-001)', () => {
  it('refetches on the very first open', async () => {
    render(<EngineSettingsPanel open onClose={vi.fn()} />)
    await screen.findByTestId('engine-settings-panel')

    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT refetch again while it stays open (only on the TRANSITION)', async () => {
    const { rerender } = render(<EngineSettingsPanel open onClose={vi.fn()} />)
    await screen.findByTestId('engine-settings-panel')
    expect(refetchMock).toHaveBeenCalledTimes(1)

    // A re-render while `open` stays `true` (e.g. an unrelated settings
    // change) must not refetch a second time.
    mockedUseEngineSettings.mockReturnValue(settingsResult({ error: 'something else changed' }))
    rerender(<EngineSettingsPanel open onClose={vi.fn()} />)

    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches again on a SECOND open transition (close, then reopen)', async () => {
    const { rerender } = render(<EngineSettingsPanel open onClose={vi.fn()} />)
    await screen.findByTestId('engine-settings-panel')
    expect(refetchMock).toHaveBeenCalledTimes(1)

    rerender(<EngineSettingsPanel open={false} onClose={vi.fn()} />)
    expect(refetchMock).toHaveBeenCalledTimes(1)

    rerender(<EngineSettingsPanel open onClose={vi.fn()} />)
    await screen.findByTestId('engine-settings-panel')
    expect(refetchMock).toHaveBeenCalledTimes(2)
  })

  it('closed from the start never refetches', () => {
    render(<EngineSettingsPanel open={false} onClose={vi.fn()} />)

    expect(refetchMock).not.toHaveBeenCalled()
  })
})

describe('EngineSettingsPanel — the Retry affordance on a load error (Gate-1 WR-004)', () => {
  it('a failed initial GET shows a Retry button that calls the SAME refetch()', async () => {
    const user = userEvent.setup()
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({ settings: null, loading: false, error: 'network down' }),
    )
    render(<EngineSettingsPanel open onClose={vi.fn()} />)
    await screen.findByTestId('engine-settings-load-error')

    // The open-transition refetch already fired once; reset so the click
    // below is unambiguous.
    refetchMock.mockClear()

    await user.click(screen.getByTestId('engine-settings-retry'))

    expect(refetchMock).toHaveBeenCalledTimes(1)
  })
})
