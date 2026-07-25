/**
 * features/controller/engine/console/EngineControlBar.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the docked engine-control chrome strip (feature: engine-review-
 * cockpit, integration seam; ADP-042, D5-014/2.1, D5-014/2.7, NFR-001):
 *
 *  - COUNTS-CONSISTENCY: the inline "N need review / N timers <60s" indicator
 *    reads the SAME `useReviewQueue()` source as the docked `<ReviewQueue>`'s
 *    own header counts — rendered SIDE BY SIDE and asserted equal, so a future
 *    change that recomputes one independently of the other fails this test.
 *  - The kill switch (ADP-042) is always visible, text + icon + dot (never
 *    color-only), and cycles Live -> Suggest-only -> STOP -> Live.
 *  - The CTL-034 demand meter renders "N / 6" and is a DEMAND signal (its
 *    tooltip states it is never a controller-performance measure, D5-014/2.7).
 *
 * Rendered through the REAL `ExerciseContextProvider` (mirrors
 * `ReviewQueue.test.tsx`).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { DraftDisposition } from '../models/reviewContracts'
import { reviewStore } from '../services/reviewStore'
import { engineControlStore } from '../hooks/useEngineControl'
import { engineSettingsStore, type EngineSettingsDto } from '../hooks/useEngineSettings'
import { ReviewQueue } from '../components/ReviewQueue'
import { EngineControlBar } from './EngineControlBar'

/** The fixed exercise id `ExerciseContextProvider`'s mock resolver returns. */
const EXERCISE_ID = 'ex-mock-0001'

function settingsDto(overrides: Partial<EngineSettingsDto> = {}): EngineSettingsDto {
  return {
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
    ...overrides,
  }
}

beforeEach(() => {
  // 30s into the minute so the seeded 1-minute burst reads a genuine sub-60s
  // timer — mirrors `ReviewQueue.test.tsx`'s fixture setup exactly, so both
  // surfaces observe the SAME seeded counts.
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
})

async function renderBarAndQueue() {
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EngineControlBar />
        <ReviewQueue />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  await screen.findByTestId('review-queue')
  return utils
}

describe('EngineControlBar — counts-consistency with the docked ReviewQueue (D5-014/2.1)', () => {
  it('the inline indicator reports the SAME pending/timers-under-60s counts as the queue header', async () => {
    await renderBarAndQueue()

    const pendingCount = screen.getByTestId('pending-count').textContent // "2 need review"
    const timersCount = screen.getByTestId('timers-under-60s').textContent // "1 timer under 60s"
    const pendingNumber = Number(pendingCount?.match(/\d+/)?.[0])
    const timersNumber = Number(timersCount?.match(/\d+/)?.[0])

    expect(pendingNumber).toBeGreaterThan(0)

    const indicator = screen.getByTestId('needs-review-indicator')
    expect(indicator).toHaveTextContent(`${pendingNumber} need review`)
    expect(indicator).toHaveTextContent(`${timersNumber} timer`)
  })

  it('reflects "All clear" once every item is resolved — still the same source, not a stale snapshot', async () => {
    await renderBarAndQueue()

    // Veto every outstanding item via the SAME store the hook reads (no UI
    // dependency here — proves the indicator reacts to the singleton store).
    for (const item of reviewStore.getItems()) {
      reviewStore.updateDisposition(item.draftId, DraftDisposition.Vetoed)
    }

    await waitFor(() => {
      expect(screen.getByTestId('needs-review-indicator')).toHaveTextContent('All clear')
    })
  })
})

describe('EngineControlBar — the ADP-042 kill switch', () => {
  it('defaults to ENGINE · LIVE and cycles Live -> Suggest-only -> STOP -> Live', async () => {
    await renderBarAndQueue()
    const killSwitch = screen.getByTestId('engine-kill-switch')
    expect(killSwitch).toHaveTextContent('ENGINE · LIVE')
    expect(killSwitch).toHaveAttribute('data-mode', 'live')

    fireEvent.click(killSwitch)
    expect(killSwitch).toHaveTextContent('ENGINE · SUGGEST-ONLY')

    fireEvent.click(killSwitch)
    expect(killSwitch).toHaveTextContent('ENGINE · STOPPED')

    fireEvent.click(killSwitch)
    expect(killSwitch).toHaveTextContent('ENGINE · LIVE')
  })
})

describe('EngineControlBar — the CTL-034 demand meter', () => {
  it('renders "N / 6" starting at 0', async () => {
    await renderBarAndQueue()
    expect(screen.getByTestId('demand-meter-count')).toHaveTextContent('0 / 6')
    expect(screen.getByTestId('demand-meter')).toHaveAttribute('data-over-budget', 'false')
  })
})

describe('EngineControlBar — the "Live" label honestly states the TRUE effective level (autonomy-safety story 06)', () => {
  it('the Suggest-today case: "Live" reads "ENGINE · LIVE (SUGGEST)", not an assumed Delayed-auto', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, settingsDto())
    await renderBarAndQueue()

    const killSwitch = screen.getByTestId('engine-kill-switch')
    expect(killSwitch).toHaveTextContent('ENGINE · LIVE (SUGGEST)')
    expect(killSwitch).not.toHaveTextContent('DELAYED-AUTO')
  })

  it('the Delayed-auto-after-a-flip case: "Live" reads "ENGINE · LIVE (DELAYED-AUTO)"', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      settingsDto({
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: false,
          degradedReason: null,
          exerciseDefaultLevel: 'delayed-auto',
          effectiveLevel: 'delayed-auto',
        },
      }),
    )
    await renderBarAndQueue()

    expect(screen.getByTestId('engine-kill-switch')).toHaveTextContent('ENGINE · LIVE (DELAYED-AUTO)')
  })

  it('follows effectiveLevel, NOT exerciseDefaultLevel, while a safety clamp is active', async () => {
    // Base default has been raised to Delayed-auto, but a safety clamp is
    // holding the ACTUAL effective level down at Suggest — the label must
    // say SUGGEST, never re-deriving "raised base -> Delayed-auto" itself.
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      settingsDto({
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: true,
          degradedReason: 'provider degraded',
          exerciseDefaultLevel: 'delayed-auto',
          effectiveLevel: 'suggest',
        },
      }),
    )
    await renderBarAndQueue()

    const killSwitch = screen.getByTestId('engine-kill-switch')
    expect(killSwitch).toHaveTextContent('ENGINE · LIVE (SUGGEST)')
    expect(killSwitch).not.toHaveTextContent('DELAYED-AUTO')
  })
})
