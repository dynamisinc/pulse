/**
 * features/controller/engine/components/UsagePanel.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the AI-generation usage flyout (feature: engine-telemetry-tuning,
 * story 03c):
 *  - closed renders nothing;
 *  - AC1: the provider statement is sourced ONLY from `useEngineSettings()`
 *    (`effectiveProvider`/`provider`/`providerCutToFake`), never re-derived,
 *    and stays structurally distinct from the per-model HISTORICAL provider
 *    rows below it;
 *  - AC2: volume totals, the four token categories kept visually distinct,
 *    latency, and the guard-result mix (icon + text, never colour alone);
 *  - AC3: cost is a separately-labelled section; an unpriced model renders
 *    "UNPRICED", never `$0`; `anyUnpriced` renders the priced subtotal as an
 *    explicit FLOOR;
 *  - AC8: an unattributed (empty provider/model) row renders honestly rather
 *    than a blank cell or a crash; a non-zero `unparseableEvents` renders a
 *    standing banner, and a zero one renders no banner;
 *  - AC6: the window label is explicitly marked "(wall-clock)";
 *  - the window selector re-requests a different window (mock mode: applies
 *    instantly via the real store, no network);
 *  - Escape closes the flyout; focus moves to the close button on open and
 *    returns to the opener on close (mirrors `EngineSettingsPanel`'s
 *    contract).
 *
 * Rendered through the REAL `ExerciseContextProvider` (mirrors
 * `EngineSettingsPanel.test.tsx`), with `engineUsageStore.setForTests(...)`
 * and `engineSettingsStore.setForTests(...)` injecting controlled snapshots
 * for the resolved mock exercise id.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import {
  engineSettingsStore,
  MOCK_ENGINE_SETTINGS,
  type EngineSettingsDto,
} from '../hooks/useEngineSettings'
import { buildMockEngineUsage, engineUsageStore, type EngineUsageDto } from '../hooks/useEngineUsage'
import { UsagePanel } from './UsagePanel'

/** The fixed exercise id `ExerciseContextProvider`'s mock resolver returns. */
const EXERCISE_ID = 'ex-mock-0001'

const NOW_MS = Date.parse('2033-09-04T14:00:00.000Z')

function settingsDto(overrides: Partial<EngineSettingsDto> = {}): EngineSettingsDto {
  return {
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
    inMemoryStateNote: MOCK_ENGINE_SETTINGS.inMemoryStateNote,
    ...overrides,
  }
}

function usage(): EngineUsageDto {
  return buildMockEngineUsage(60, NOW_MS)
}

beforeEach(() => {
  engineUsageStore.resetForTests()
  engineSettingsStore.resetForTests()
})

afterEach(() => {
  engineUsageStore.resetForTests()
  engineSettingsStore.resetForTests()
})

function renderPanel(open: boolean, onClose: () => void = vi.fn()) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <UsagePanel open={open} onClose={onClose} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

describe('UsagePanel — visibility', () => {
  it('renders nothing when closed', () => {
    renderPanel(false)
    expect(screen.queryByTestId('engine-usage-panel')).not.toBeInTheDocument()
  })
})

describe('UsagePanel — AC1: the provider statement is sourced ONLY from useEngineSettings()', () => {
  it('states the effective provider, never re-derived, when no cut is active', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto({ effectiveProvider: 'AzureOpenAI', providerCutToFake: false }))
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    expect(screen.getByTestId('usage-provider-statement')).toHaveTextContent('AzureOpenAI')
    expect(screen.getByTestId('usage-provider-statement')).not.toHaveTextContent('cut from')
  })

  it('states the cut posture (effective Fake, configured provider named) when a runtime cut is active', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      settingsDto({ provider: 'AzureOpenAI', effectiveProvider: 'Fake', providerCutToFake: true }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const statement = screen.getByTestId('usage-provider-statement')
    expect(statement).toHaveTextContent('Fake')
    expect(statement).toHaveTextContent('cut from AzureOpenAI')
  })

  it('pairs the provider-cut indicator with BOTH an icon and text — never colour alone (NFR-001)', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      settingsDto({ provider: 'AzureOpenAI', effectiveProvider: 'Fake', providerCutToFake: true }),
    )
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const statement = screen.getByTestId('usage-provider-statement')
    // A regression that reduced this to a colour change alone (e.g. dropping
    // the icon and relying on the amber text colour) would still pass a
    // text-only assertion — this specifically requires the icon too.
    expect(statement.querySelector('svg')).not.toBeNull()
    expect(statement).toHaveTextContent(/cut from AzureOpenAI/i)
  })

  it('keeps the AC1 provider statement structurally distinct from the historical per-model provider rows', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto({ effectiveProvider: 'AzureOpenAI' }))
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    // The Fake provider appears among the HISTORICAL byModel rows (the mock
    // snapshot's own Fake row) even though the LIVE provider statement above
    // says AzureOpenAI — the two must coexist without either winning.
    expect(screen.getByTestId('usage-provider-statement')).toHaveTextContent('AzureOpenAI')
    const modelRows = screen.getAllByTestId('usage-model-row')
    expect(modelRows.some(row => row.textContent?.includes('Fake'))).toBe(true)
  })
})

describe('UsagePanel — AC2: volume', () => {
  it('shows call totals, the four token categories kept distinct, and latency', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    const data = usage()
    await screen.findByTestId('engine-usage-panel')
    expect(screen.getByTestId('usage-total-calls')).toHaveTextContent(String(data.totals.calls))
    expect(screen.getByTestId('usage-tokens-input')).toHaveTextContent(
      data.totals.inputTokens.toLocaleString(),
    )
    expect(screen.getByTestId('usage-tokens-output')).toHaveTextContent(
      data.totals.outputTokens.toLocaleString(),
    )
    expect(screen.getByTestId('usage-tokens-cache-read')).toHaveTextContent(
      data.totals.cacheReadInputTokens.toLocaleString(),
    )
    expect(screen.getByTestId('usage-tokens-cache-creation')).toHaveTextContent(
      data.totals.cacheCreationInputTokens.toLocaleString(),
    )
    expect(screen.getByTestId('usage-total-latency')).toBeInTheDocument()
  })

  it('renders the guard-result mix with an icon AND a text label for every entry — never colour alone', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    // The re-roll chip appears both in the aggregate GUARD-RESULT MIX and
    // inside the gpt-5.4 model row that produced it — either instance must
    // pair an icon with visible text (never colour alone).
    const reRollChips = screen.getAllByTestId('usage-guard-result-re-roll')
    expect(reRollChips.length).toBeGreaterThan(0)
    for (const chip of reRollChips) {
      expect(chip).toHaveTextContent(/re-roll/i)
      expect(chip.querySelector('svg')).not.toBeNull()
    }

    const passChips = screen.getAllByTestId('usage-guard-result-pass')
    expect(passChips.length).toBeGreaterThan(0)
    for (const chip of passChips) {
      expect(chip).toHaveTextContent(/pass/i)
      expect(chip.querySelector('svg')).not.toBeNull()
    }
  })

  it('renders a model row for every provider/model, including the busiest (Fake) first', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const rows = screen.getAllByTestId('usage-model-row')
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows[0]).toHaveTextContent('Fake')
  })
})

describe('UsagePanel — AC8: unattributed rows and unparseable events', () => {
  it('renders an empty provider/model row as "Unattributed" rather than a blank cell or a crash', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const rows = screen.getAllByTestId('usage-model-row')
    expect(rows.some(row => row.textContent?.includes('Unattributed'))).toBe(true)
  })

  it('surfaces a standing banner when unparseableEvents is non-zero', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    expect(screen.getByTestId('usage-unparseable-banner')).toHaveTextContent(/could not be read/i)
  })

  it('renders NO banner when unparseableEvents is zero', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, { ...usage(), unparseableEvents: 0 })
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    expect(screen.queryByTestId('usage-unparseable-banner')).not.toBeInTheDocument()
  })
})

describe('UsagePanel — AC3: cost is a separately labelled section', () => {
  it('renders a priced model with real currency figures', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const costSection = screen.getByTestId('usage-cost-section')
    expect(costSection).toHaveTextContent(/USD/)
  })

  it('renders an unpriced model as "UNPRICED", NEVER as $0', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const unpriced = screen.getAllByTestId('usage-cost-unpriced')
    expect(unpriced.length).toBeGreaterThan(0)
    for (const el of unpriced) {
      expect(el).toHaveTextContent(/unpriced/i)
      expect(el).not.toHaveTextContent('$0')
    }
  })

  it('labels the priced subtotal as a FLOOR when anyUnpriced is true', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    expect(screen.getByTestId('usage-cost-floor-note')).toHaveTextContent(/not the total spend/i)
  })

  it('an unpriced row renders NO currency-formatted cost figure at all — a check that actually catches a fallback $0 (unlike a bare literal-"$0" search: this format never prints a "$")', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const unpricedBadges = screen.getAllByTestId('usage-cost-unpriced')
    expect(unpricedBadges.length).toBeGreaterThan(0)
    for (const badge of unpricedBadges) {
      const row = badge.closest('[data-testid="usage-cost-row"]')
      expect(row).not.toBeNull()
      // The panel's currency format always suffixes the currency code (e.g.
      // "0.00 USD") and never a "$" prefix, so a bare `not.toHaveTextContent('$0')`
      // check can never fail regardless of what the row renders — it is not
      // testing what it claims to. This instead asserts NO formatted amount
      // appears anywhere in an unpriced row: a regression that fell back to a
      // zero/placeholder cost for an unpriced model would print one.
      expect(row).not.toHaveTextContent(/USD/)
    }
  })

  it('pairs the UNPRICED state with an icon, not colour alone (NFR-001)', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const unpricedBadges = screen.getAllByTestId('usage-cost-unpriced')
    expect(unpricedBadges.length).toBeGreaterThan(0)
    for (const badge of unpricedBadges) {
      expect(badge.querySelector('svg')).not.toBeNull()
      expect(badge).toHaveTextContent(/unpriced/i)
    }
  })

  it('does NOT render the floor note when every model is priced', async () => {
    const zeroRates = {
      inputPer1MTokens: 0,
      outputPer1MTokens: 0,
      cacheReadPer1MTokens: 0,
      cacheCreationPer1MTokens: 0,
    }
    const allPriced: EngineUsageDto = {
      ...usage(),
      cost: {
        ...usage().cost,
        anyUnpriced: false,
        byModel: usage().cost.byModel.map(row => ({
          ...row,
          priced: true,
          inputCost: 0,
          outputCost: 0,
          cacheReadCost: 0,
          cacheCreationCost: 0,
          totalCost: 0,
          rates: zeroRates,
        })),
      },
    }
    engineUsageStore.setForTests(EXERCISE_ID, allPriced)
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    expect(screen.queryByTestId('usage-cost-floor-note')).not.toBeInTheDocument()
  })
})

describe('UsagePanel — AC6: the window axis is labelled wall-clock, never left to guess', () => {
  it('labels the window explicitly as wall-clock', async () => {
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    expect(screen.getByTestId('usage-window-label')).toHaveTextContent(/wall-clock/i)
  })
})

describe('UsagePanel — bucket series renders COUNTS, never a rate (SG-001)', () => {
  it('shows the exact per-bucket call count verbatim even when the final bucket is a partial span (windowMinutes not a whole multiple of bucketMinutes)', async () => {
    const base = usage()
    // 61 minutes at 2-minute buckets -> 31 buckets, the last covering only 1
    // real minute (SG-001) — not one of the panel's own presets, but a shape
    // the backend contract explicitly allows and this test constructs
    // directly via `setForTests` rather than going through
    // `buildMockEngineUsage` (which never produces this case for the panel's
    // fixed presets — see `useEngineUsage.ts`'s own preset list).
    const unevenUsage: EngineUsageDto = {
      ...base,
      window: { ...base.window, windowMinutes: 61, bucketMinutes: 2, bucketCount: 3 },
      buckets: [
        { startWallClock: '2033-09-04T13:00:00.000Z', calls: 12 },
        { startWallClock: '2033-09-04T13:02:00.000Z', calls: 8 },
        // The partial final bucket — a "calls per minute" rate would divide
        // this by its NOMINAL 2-minute width even though it only covers 1
        // real minute; the display must show the raw count, not a quotient.
        { startWallClock: '2033-09-04T13:04:00.000Z', calls: 3 },
      ],
    }
    engineUsageStore.setForTests(EXERCISE_ID, unevenUsage)
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)

    await screen.findByTestId('engine-usage-panel')
    const detail = screen.getByTestId('usage-bucket-detail')
    expect(detail).toHaveTextContent('12 calls')
    expect(detail).toHaveTextContent('8 calls')
    expect(detail).toHaveTextContent('3 calls')
    // Never a computed rate for the partial bucket (e.g. "1.5" from 3 / 2).
    expect(detail).not.toHaveTextContent('1.5')
  })
})

describe('UsagePanel — window selector (mock mode: applies instantly, no network)', () => {
  it('selecting a different preset marks it pressed and re-requests that window', async () => {
    const user = userEvent.setup()
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true)
    await screen.findByTestId('engine-usage-panel')

    expect(screen.getByTestId('usage-window-60')).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByTestId('usage-window-1440'))

    await waitFor(() =>
      expect(screen.getByTestId('usage-window-1440')).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByTestId('usage-window-60')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('UsagePanel — focus + Escape (mirrors EngineSettingsPanel)', () => {
  it('moves focus to the close button on open, and Escape closes + calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    engineUsageStore.setForTests(EXERCISE_ID, usage())
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    renderPanel(true, onClose)

    await waitFor(() => expect(screen.getByTestId('engine-usage-close')).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
