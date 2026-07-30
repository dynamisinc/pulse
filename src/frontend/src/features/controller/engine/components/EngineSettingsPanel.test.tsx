/**
 * features/controller/engine/components/EngineSettingsPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the engine settings flyout (feature: autonomy-safety, story 06 —
 * rebuilt on the AWAIT-THEN-APPLY model; see `useEngineSettings`'s module
 * header for the full rebuild history):
 *  - closed renders nothing; open shows the autonomy default, tier-policy
 *    mode, and the read-only provider/tier mapping (never an editable field —
 *    a zero `input, select, textarea` assertion pins the governed-config
 *    boundary);
 *  - flipping the autonomy default / tier-policy mode updates the pressed
 *    segment via the real `useEngineSettings()` store (mock mode — applies
 *    instantly, no network);
 *  - the `inMemoryStateNote` is always surfaced, never hidden;
 *  - the CLAMP indicator is derived from `safetyClampActive` ALONE — it still
 *    renders even when `effectiveLevel === exerciseDefaultLevel` (both
 *    `suggest`), the trap case a level-equality inference would get backwards;
 *  - a 403-forced read-only state disables both controls with a visible note,
 *    rather than presenting a control that looks live but silently fails;
 *  - Escape closes the flyout; every control is a native, keyboard-operable
 *    `<button>` (Tab reaches it, Enter/Space activates it).
 *
 * The AWAIT-THEN-APPLY / in-flight-disable wiring (the "Applying…" affordance,
 * both controls disabling whenever ANYTHING is in flight) is covered in the
 * SEPARATE sibling file `EngineSettingsPanel.awaitThenApply.test.tsx`, which
 * mocks `useEngineSettings` wholesale — that mock is file-scoped/hoisted and
 * would otherwise break THIS file's tests against the real store.
 *
 * Rendered through the REAL `ExerciseContextProvider` (mirrors
 * `EngineControlBar.test.tsx`), with `engineSettingsStore.setForTests(...)`
 * injecting a controlled snapshot for the resolved mock exercise id.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { engineSettingsStore, type EngineSettingsDto } from '../hooks/useEngineSettings'
import { EngineSettingsPanel } from './EngineSettingsPanel'

/** The fixed exercise id `ExerciseContextProvider`'s mock resolver returns. */
const EXERCISE_ID = 'ex-mock-0001'

function dto(overrides: Partial<EngineSettingsDto> = {}): EngineSettingsDto {
  return {
    provider: 'Fake',
    // Matches the mock/live default posture everywhere today: the configured
    // provider IS Fake, so the lever is inert (`alreadyFake: true`) and no
    // cut is active.
    effectiveProvider: 'Fake',
    providerCutToFake: false,
    alreadyFake: true,
    tiers: [
      { tier: 'Ambient', model: 'fake-ambient', deployment: 'ambient', zdrCapable: false },
      { tier: 'Standard', model: 'fake-standard', deployment: '', zdrCapable: false },
    ],
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
    inMemoryStateNote:
      'Autonomy default, tier-policy mode and the generation-provider cut are held in process ' +
      'memory; a restart resets them to suggest / auto / the startup-configured provider.',
    ...overrides,
  }
}

beforeEach(() => {
  engineSettingsStore.resetForTests()
})

afterEach(() => {
  engineSettingsStore.resetForTests()
})

function renderPanel(open: boolean, onClose: () => void = vi.fn()) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EngineSettingsPanel open={open} onClose={onClose} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

describe('EngineSettingsPanel — visibility', () => {
  it('renders nothing when closed', () => {
    renderPanel(false)
    expect(screen.queryByTestId('engine-settings-panel')).not.toBeInTheDocument()
  })
})

describe('EngineSettingsPanel — read model (story 05\'s GET /api/engine/settings)', () => {
  it('shows the current autonomy default, tier-policy mode, and read-only provider/tier mapping', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-default-suggest')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('tier-policy-auto')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('engine-settings-provider')).toHaveTextContent('Fake')
    expect(screen.getByTestId('engine-settings-tier-row-ambient')).toHaveTextContent('fake-ambient')
    expect(screen.getByTestId('engine-settings-tier-row-standard')).toHaveTextContent('fake-standard')
  })

  it('never renders the provider/tier mapping as an editable field', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    const { container } = renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    // No text input / select anywhere in the whole panel — the tier mapping
    // is read-only text, never an editable control (story 05's governed-
    // config boundary).
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  it('always surfaces the inMemoryStateNote — never hidden', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto({ inMemoryStateNote: 'a distinctive restart warning' }))
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('engine-settings-in-memory-note')).toHaveTextContent(
      'a distinctive restart warning',
    )
  })
})

describe('EngineSettingsPanel — flipping the controls (mock mode: applies instantly)', () => {
  it('flips the autonomy default and updates the pressed segment', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)
    await screen.findByTestId('engine-settings-panel')

    await user.click(screen.getByTestId('autonomy-default-delayed-auto'))

    expect(screen.getByTestId('autonomy-default-delayed-auto')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('autonomy-default-suggest')).toHaveAttribute('aria-pressed', 'false')
  })

  it('picks a tier-policy mode and updates the pressed segment', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)
    await screen.findByTestId('engine-settings-panel')

    await user.click(screen.getByTestId('tier-policy-standard'))

    expect(screen.getByTestId('tier-policy-standard')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('tier-policy-auto')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('EngineSettingsPanel — the clamp indicator (WR-003 trap case)', () => {
  it('renders the clamp note when safetyClampActive is true, EVEN WHEN effectiveLevel equals exerciseDefaultLevel', async () => {
    // Base is already 'suggest' and a 'drop-to-suggest' kill-switch clamp is
    // ALSO active — both levels read 'suggest', so a level-EQUALITY inference
    // of "no clamp" would silently hide this. The indicator must come from
    // `safetyClampActive` alone.
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: true,
          degradedReason: 'kill switch engaged',
          exerciseDefaultLevel: 'suggest',
          effectiveLevel: 'suggest',
        },
      }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-clamp-note')).toHaveTextContent('kill switch engaged')
  })

  it('shows no clamp note when safetyClampActive is false, even with an unremarkable snapshot', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.queryByTestId('autonomy-clamp-note')).not.toBeInTheDocument()
  })

  it('reports "generation fully stopped" from generationStopped alone, not from a null effectiveLevel guess', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({
        autonomy: {
          swampedMode: false,
          generationStopped: true,
          safetyClampActive: true,
          degradedReason: 'full stop',
          exerciseDefaultLevel: 'delayed-auto',
          effectiveLevel: null,
        },
      }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-effective-label')).toHaveTextContent(/fully stopped/i)
  })
})

describe('EngineSettingsPanel — 403 read-only (story 05 AC6/#297)', () => {
  it('disables both controls and shows a read-only note when forbidden', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(), { forbidden: true })
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toBeDisabled()
    expect(screen.getByTestId('tier-policy-standard')).toBeDisabled()
    expect(screen.getByTestId('engine-settings-readonly-note')).toBeInTheDocument()
  })
})

describe('EngineSettingsPanel — generation-provider cut/restore lever (story 07, ADP-042)', () => {
  it('reads effectiveProvider DIRECTLY off the DTO — never re-derives it from providerCutToFake/provider (WR-003 trap: a naive "not cut => provider" derivation would get this wrong)', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({
        provider: 'AzureOpenAI',
        // Deliberately NOT derivable from provider/providerCutToFake — a
        // naive `providerCutToFake ? 'Fake' : provider` re-derivation would
        // render "AzureOpenAI" here instead.
        effectiveProvider: 'sentinel-effective-value',
        providerCutToFake: false,
        alreadyFake: false,
      }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-effective-label')).toHaveTextContent('sentinel-effective-value')
  })

  it('shows the effective-vs-configured distinction as TEXT (not colour alone) when a cut is active, and renders the RESTORE control (never CUT)', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({
        provider: 'AzureOpenAI',
        effectiveProvider: 'Fake',
        providerCutToFake: true,
        alreadyFake: false,
      }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-effective-label')).toHaveTextContent('RUNNING ON: Fake')
    expect(screen.getByTestId('provider-effective-label')).toHaveTextContent('cut from AzureOpenAI')
    expect(screen.getByTestId('provider-lever-restore')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-lever-cut')).not.toBeInTheDocument()
  })

  it('renders the CUT control (never RESTORE) with a plain "RUNNING ON" label when no cut is active', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAI', effectiveProvider: 'AzureOpenAI', providerCutToFake: false, alreadyFake: false }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-effective-label')).toHaveTextContent('RUNNING ON: AzureOpenAI')
    expect(screen.getByTestId('provider-effective-label')).not.toHaveTextContent('cut from')
    expect(screen.getByTestId('provider-lever-cut')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-lever-restore')).not.toBeInTheDocument()
  })

  it('renders the cut lever as INERT (disabled + an explanatory note) when alreadyFake is true, rather than a control that looks live but does nothing', async () => {
    // default dto(): provider 'Fake', alreadyFake true
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-lever-cut')).toBeDisabled()
    expect(screen.getByTestId('provider-lever-already-fake-note')).toBeInTheDocument()
  })

  it('WR-002: programmatically associates the disabled Cut button with its explanation via aria-describedby, so a screen-reader user in browse mode (who never reaches a disabled control by Tab) can still discover WHY it is inert', async () => {
    // default dto(): provider 'Fake', alreadyFake true
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    const cutButton = screen.getByTestId('provider-lever-cut')
    const note = screen.getByTestId('provider-lever-already-fake-note')

    // `toHaveAccessibleDescription` computes the accessible description the
    // SAME way assistive tech does (resolving `aria-describedby`), so this
    // proves the programmatic link rather than merely both facts being true
    // independently.
    expect(cutButton).toHaveAccessibleDescription(/already Fake/i)

    // Belt-and-braces: assert the association directly too — the id the
    // button's aria-describedby points at resolves to the note element.
    expect(cutButton).toHaveAttribute('aria-describedby', note.id)
  })

  it('does NOT render the inert note when alreadyFake is false — the cut control is genuinely actionable', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAI', effectiveProvider: 'AzureOpenAI', providerCutToFake: false, alreadyFake: false }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-settings-panel')
    expect(screen.getByTestId('provider-lever-cut')).not.toBeDisabled()
    expect(screen.queryByTestId('provider-lever-already-fake-note')).not.toBeInTheDocument()
  })

  it('clicking CUT in mock mode applies instantly when the lever is actionable (not alreadyFake)', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAI', effectiveProvider: 'AzureOpenAI', providerCutToFake: false, alreadyFake: false }),
    )
    renderPanel(true)
    await screen.findByTestId('engine-settings-panel')

    await user.click(screen.getByTestId('provider-lever-cut'))

    expect(screen.getByTestId('provider-effective-label')).toHaveTextContent('RUNNING ON: Fake')
    expect(screen.getByTestId('provider-lever-restore')).toBeInTheDocument()
  })

  it('clicking RESTORE in mock mode returns to the configured provider instantly', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAI', effectiveProvider: 'Fake', providerCutToFake: true, alreadyFake: false }),
    )
    renderPanel(true)
    await screen.findByTestId('engine-settings-panel')

    await user.click(screen.getByTestId('provider-lever-restore'))

    expect(screen.getByTestId('provider-effective-label')).toHaveTextContent('RUNNING ON: AzureOpenAI')
    expect(screen.getByTestId('provider-lever-cut')).toBeInTheDocument()
  })
})

describe('EngineSettingsPanel — a11y (NFR-001)', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true, onClose)
    await screen.findByTestId('engine-settings-panel')

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the close button on open', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)

    await waitFor(() => expect(screen.getByTestId('engine-settings-close')).toHaveFocus())
  })

  it('every autonomy/tier control is keyboard-reachable and Enter-activatable', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel(true)
    await screen.findByTestId('engine-settings-panel')

    const target = screen.getByTestId('autonomy-default-delayed-auto')
    target.focus()
    expect(target).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(target).toHaveAttribute('aria-pressed', 'true')
  })
})
