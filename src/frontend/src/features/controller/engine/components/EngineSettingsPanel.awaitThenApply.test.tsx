/**
 * features/controller/engine/components/EngineSettingsPanel.awaitThenApply.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the AWAIT-THEN-APPLY WIRING in `<EngineSettingsPanel>` (feature:
 * autonomy-safety, story 06 — rebuilt after three optimistic-model attempts
 * produced six Criticals of one class; see `useEngineSettings`'s module
 * header for the full history): the SPECIFIC control shows a text
 * "Applying…" affordance and is disabled while its own POST is outstanding,
 * and BOTH controls disable whenever ANYTHING is in flight — the
 * serialization invariant that makes the historical "two mutations race to
 * overwrite each other's field, losing a genuinely successful change"
 * Critical structurally UNREPRESENTABLE, not merely guarded.
 *
 * `../hooks/useEngineSettings` is mocked WHOLESALE (mirrors
 * `EngineControlBar.refetchOnKillSwitch.test.tsx`'s / `EngineSettingsPanel.
 * refetchOnOpen.test.tsx`'s convention) — deliberately a SEPARATE file from
 * `EngineSettingsPanel.test.tsx`, since `vi.mock` is file-scoped/hoisted and
 * would otherwise break that file's tests against the REAL store. The hook's
 * own reconciliation (the serialization invariant's mechanics, the
 * single-counter guard, the no-revert-on-rejection contract) is covered
 * exhaustively in `useEngineSettings.test.ts`; this file proves only the
 * PANEL's disable/affordance rendering.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  useEngineSettings,
  type EngineSettingsDto,
  type UseEngineSettingsResult,
} from '../hooks/useEngineSettings'
import { EngineSettingsPanel } from './EngineSettingsPanel'

vi.mock('../hooks/useEngineSettings', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useEngineSettings')>(
    '../hooks/useEngineSettings',
  )
  return { ...actual, useEngineSettings: vi.fn() }
})

const mockedUseEngineSettings = vi.mocked(useEngineSettings)

function dto(overrides: Partial<EngineSettingsDto> = {}): EngineSettingsDto {
  return {
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
    ...overrides,
  }
}

function settingsResult(overrides: Partial<UseEngineSettingsResult> = {}): UseEngineSettingsResult {
  return {
    settings: dto(),
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

function renderPanel() {
  return render(<EngineSettingsPanel open onClose={vi.fn()} />)
}

describe('EngineSettingsPanel — await-then-apply: no speculative value, disable while in flight', () => {
  it('while pendingAutonomyDefault is true: shows "Applying…" next to autonomy AND disables BOTH groups (the serialization invariant)', async () => {
    mockedUseEngineSettings.mockReturnValue(settingsResult({ pendingAutonomyDefault: true }))
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-default-applying')).toBeInTheDocument()
    expect(screen.queryByTestId('tier-policy-applying')).not.toBeInTheDocument()

    // The clicked control...
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toBeDisabled()
    // ...AND its sibling group, even though `pendingTierPolicy` is false —
    // both are disabled while ANYTHING is in flight, so an operator can never
    // even attempt to start a second concurrent request (the mechanism that
    // makes the "two mutations racing to overwrite each other's field, losing
    // a genuinely successful change" Critical structurally unrepresentable).
    expect(screen.getByTestId('tier-policy-standard')).toBeDisabled()
  })

  it('while pendingTierPolicy is true: shows "Applying…" next to tier-policy AND disables BOTH groups', async () => {
    mockedUseEngineSettings.mockReturnValue(settingsResult({ pendingTierPolicy: true }))
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('tier-policy-applying')).toBeInTheDocument()
    expect(screen.queryByTestId('autonomy-default-applying')).not.toBeInTheDocument()
    expect(screen.getByTestId('tier-policy-standard')).toBeDisabled()
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toBeDisabled()
  })

  it('while a background GET (`loading`) is in flight, both controls disable too — a mutation attempted then would only no-op against the hook\'s own serialization guard', async () => {
    mockedUseEngineSettings.mockReturnValue(settingsResult({ loading: true }))
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toBeDisabled()
    expect(screen.getByTestId('tier-policy-standard')).toBeDisabled()
  })

  it('when nothing is in flight, both groups are enabled and no "Applying…" text renders', async () => {
    mockedUseEngineSettings.mockReturnValue(settingsResult())
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-default-delayed-auto')).not.toBeDisabled()
    expect(screen.getByTestId('tier-policy-standard')).not.toBeDisabled()
    expect(screen.queryByTestId('autonomy-default-applying')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tier-policy-applying')).not.toBeInTheDocument()
  })

  it('on a rejection, there is no revert to render: settings is exactly what the hook reports (unchanged), the pending flag is false, and the error renders as an action error (not the load-error/retry banner)', async () => {
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({
        settings: dto(), // still 'suggest' — nothing was ever asserted to 'delayed-auto'
        pendingAutonomyDefault: false,
        error: 'delayed-auto is not selectable in v1',
      }),
    )
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-default-suggest')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('autonomy-default-delayed-auto')).not.toBeDisabled()
    expect(screen.getByTestId('engine-settings-action-error')).toHaveTextContent(
      'delayed-auto is not selectable in v1',
    )
    expect(screen.queryByTestId('engine-settings-load-error')).not.toBeInTheDocument()
  })

  it('while pendingProviderLever is true: shows "Applying…" next to the provider lever AND disables the autonomy/tier groups too (the SAME serialization invariant, now covering a third mutation kind)', async () => {
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({
        settings: dto({ provider: 'AzureOpenAI', effectiveProvider: 'AzureOpenAI', alreadyFake: false }),
        pendingProviderLever: true,
      }),
    )
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-lever-applying')).toBeInTheDocument()
    expect(screen.getByTestId('provider-lever-cut')).toBeDisabled()
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toBeDisabled()
    expect(screen.getByTestId('tier-policy-standard')).toBeDisabled()
  })

  it('a pending AUTONOMY mutation also disables the provider lever (not only its own group) — the shared serialization invariant runs both ways', async () => {
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({
        settings: dto({ provider: 'AzureOpenAI', effectiveProvider: 'AzureOpenAI', alreadyFake: false }),
        pendingAutonomyDefault: true,
      }),
    )
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-lever-cut')).toBeDisabled()
    expect(screen.queryByTestId('provider-lever-applying')).not.toBeInTheDocument()
  })

  it('on a provider-lever rejection, there is no revert: settings is exactly what the hook reports, the pending flag is false, and the error renders as an action error', async () => {
    mockedUseEngineSettings.mockReturnValue(
      settingsResult({
        settings: dto({ provider: 'AzureOpenAI', effectiveProvider: 'AzureOpenAI', providerCutToFake: false, alreadyFake: false }),
        pendingProviderLever: false,
        error: 'The engine settings change could not be applied. Try again.',
      }),
    )
    renderPanel()

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-lever-cut')).not.toBeDisabled()
    expect(screen.queryByTestId('provider-lever-restore')).not.toBeInTheDocument()
    expect(screen.getByTestId('engine-settings-action-error')).toHaveTextContent(
      'The engine settings change could not be applied. Try again.',
    )
  })
})
