/**
 * features/staffShell/components/StaffHeader.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (Staff header) — RTL coverage for the Acceptance Criteria in
 * docs/features/staff-shell/01-staff-header.md:
 *  - renders the brand lockup + exercise identity badge + dual clock pair +
 *    state pill + FOUO classification tag + staff presence + preview button;
 *  - the identity badge is STATIC during conduct (COR-005) — a Live/active
 *    exercise renders no switcher control of any kind;
 *  - the state pill carries BOTH a dot AND a text label (NFR-001, never
 *    color-only), correctly mapped for every `ExerciseStatus`;
 *  - the Preview-as button reflects/toggles via `previewActive` /
 *    `onTogglePreview` only (story 04 supplies the real behavior) and is
 *    keyboard-operable;
 *  - the scenario clock and wall clock are independently SOURCED (WAVE0-
 *    REVIEW precedent 18: pinned by divergent system-vs-scenario clocks, not
 *    a bare `Date.now` spy) — proves the header never substitutes wall-clock
 *    time for the scenario reading.
 *
 * `@/core/exerciseContext` is mocked at the module boundary (mirrors the
 * existing pattern in `features/participant-shell/chromeConfig.test.tsx` /
 * `shellState.test.tsx`) so each test controls the exercise scope
 * (status/timeZone) directly and synchronously — that seam's own resolution
 * timing is covered by its own test suite. The sibling
 * `StaffHeader.default.test.tsx` covers the REAL, un-mocked
 * `ExerciseContextProvider` (the shipped DEV mock path) per WAVE0-REVIEW
 * precedent 19 (every mock-backed seam ships both a boundary-mocked-branch
 * test and an un-mocked shipped-path test) — mirroring how
 * `exerciseContextResolver.default.test.ts` sits beside
 * `exerciseContextResolver.test.ts`.
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StaffHeader, STAFF_CLASSIFICATION } from './StaffHeader'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope, ExerciseStatus } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const BASE_SCOPE: ExerciseScope = {
  exerciseId: 'ex-test-staff-header-0001',
  exerciseName: 'Bay Shield 2026',
  timeZone: 'UTC',
  status: 'active',
}

function mockScope(overrides: Partial<ExerciseScope> = {}) {
  vi.mocked(useExerciseContext).mockReturnValue({ ...BASE_SCOPE, ...overrides })
}

beforeEach(() => {
  mockScope()
})

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('StaffHeader — renders every required region (AC1)', () => {
  it('renders the brand lockup, identity badge, dual clock pair, state pill, FOUO tag, presence, and preview button', () => {
    render(<StaffHeader surfaceName="Controller Console" />)

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(within(lockup).getByText('PULSE')).toBeInTheDocument()
    expect(within(lockup).getByText('Controller Console')).toBeInTheDocument()

    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(within(badge).getByText('Bay Shield 2026')).toBeInTheDocument()
    expect(within(badge).getByText(/CONTROLLER/)).toBeInTheDocument()

    expect(screen.getByTestId('staff-header-scenario-clock')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-wall-clock')).toBeInTheDocument()

    expect(screen.getByTestId('staff-header-state-pill')).toBeInTheDocument()

    expect(screen.getByTestId('staff-header-classification-tag')).toHaveTextContent(STAFF_CLASSIFICATION)
    // Locks the actual persistent SHELL-CONTRACT §1 marking, not just
    // whatever the constant happens to hold.
    expect(STAFF_CLASSIFICATION).toBe('UNCLASSIFIED // FOUO')

    const presence = screen.getByRole('group', { name: 'Staff presence' })
    expect(within(presence).getAllByText(/^[A-Z0-9]{2}$/).length).toBeGreaterThan(0)

    expect(screen.getByRole('button', { name: /preview as participant/i })).toBeInTheDocument()
  })
})

describe('StaffHeader — identity badge is STATIC during conduct (COR-005)', () => {
  it('a Live (active) exercise renders no switcher control — the badge is plain, non-interactive text', () => {
    mockScope({ status: 'active' })
    render(<StaffHeader surfaceName="Controller Console" />)

    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(within(badge).queryByRole('button')).not.toBeInTheDocument()
    expect(within(badge).queryByRole('combobox')).not.toBeInTheDocument()
    expect(badge.tagName).not.toBe('BUTTON')
  })

  it('no switcher control renders regardless of status (switching UX is out of scope for this story)', () => {
    const statuses: ExerciseStatus[] = ['scheduled', 'active', 'complete', 'archived']

    for (const status of statuses) {
      mockScope({ status })
      const { unmount } = render(<StaffHeader surfaceName="Controller Console" />)

      const badge = screen.getByTestId('staff-header-identity-badge')
      expect(within(badge).queryByRole('button')).not.toBeInTheDocument()

      unmount()
    }
  })
})

describe('StaffHeader — exercise state pill (NFR-001: never color-only)', () => {
  const EXPECTED_LABELS: Record<ExerciseStatus, string> = {
    active: 'LIVE',
    scheduled: 'STAGED',
    complete: 'ENDEX',
    archived: 'ARCHIVED',
  }

  it.each(Object.entries(EXPECTED_LABELS) as Array<[ExerciseStatus, string]>)(
    'status "%s" renders both a dot AND the text label "%s"',
    (status, expectedLabel) => {
      mockScope({ status })
      render(<StaffHeader surfaceName="Controller Console" />)

      const pill = screen.getByTestId('staff-header-state-pill')
      const dot = within(pill).getByTestId('staff-header-state-pill-dot')
      const label = within(pill).getByTestId('staff-header-state-pill-label')

      expect(dot).toBeInTheDocument()
      expect(dot).toHaveAttribute('aria-hidden', 'true')
      expect(label).toHaveTextContent(expectedLabel)
      // The pill's accessible name carries the text label too — a screen
      // reader is never left with color as the only signal.
      expect(pill).toHaveAccessibleName(`Exercise state: ${expectedLabel}`)
    },
  )
})

describe('StaffHeader — Preview-as button is driven entirely by props (story 04 out of scope)', () => {
  it('reflects previewActive=false: unpressed, "Preview as participant" label', () => {
    render(<StaffHeader surfaceName="Controller Console" previewActive={false} />)

    const button = screen.getByRole('button', { name: /preview as participant/i })
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('reflects previewActive=true: pressed, "Exit preview" label', () => {
    render(<StaffHeader surfaceName="Controller Console" previewActive />)

    const button = screen.getByRole('button', { name: /exit preview/i })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onTogglePreview on click — the header never manages preview state itself', async () => {
    const user = userEvent.setup()
    const onTogglePreview = vi.fn()
    render(
      <StaffHeader
        surfaceName="Controller Console"
        previewActive={false}
        onTogglePreview={onTogglePreview}
      />,
    )

    await user.click(screen.getByRole('button', { name: /preview as participant/i }))

    expect(onTogglePreview).toHaveBeenCalledTimes(1)
  })

  it('is keyboard-operable: reachable by Tab and activatable with Enter', async () => {
    const user = userEvent.setup()
    const onTogglePreview = vi.fn()
    render(
      <StaffHeader
        surfaceName="Controller Console"
        previewActive={false}
        onTogglePreview={onTogglePreview}
      />,
    )

    await user.tab()
    // Keep tabbing until the preview button (last in DOM order) has focus, or
    // fail loudly rather than silently passing on the wrong element.
    const button = screen.getByRole('button', { name: /preview as participant/i })
    let guard = 0
    while (document.activeElement !== button && guard < 20) {
      await user.tab()
      guard += 1
    }
    expect(document.activeElement).toBe(button)

    await user.keyboard('{Enter}')
    expect(onTogglePreview).toHaveBeenCalledTimes(1)
  })
})

describe('StaffHeader — dual clock pair is Cadence-convention (scenario + wall), independently sourced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('the scenario clock and wall clock render DIFFERENT times when the scenario and system clocks diverge (WAVE0-REVIEW precedent 18)', () => {
    // System (wall) clock: 1999. Scenario clock: 2031. Wildly divergent so a
    // bug that renders wall-clock time for BOTH clocks cannot pass by
    // coincidence.
    vi.setSystemTime(new Date('1999-06-01T08:15:00Z'))
    setExerciseClock({ scenarioNow: () => new Date('2031-11-20T21:42:37Z') })
    mockScope({ timeZone: 'UTC' })

    render(<StaffHeader surfaceName="Controller Console" />)

    const scenarioText = screen.getByTestId('staff-header-scenario-clock').textContent ?? ''
    const wallText = screen.getByTestId('staff-header-wall-clock').textContent ?? ''

    expect(scenarioText).toContain('21:42:37')
    expect(scenarioText).not.toBe(wallText)
    expect(wallText).not.toContain('21:42:37')
  })

  it('the wall clock ticks forward on its own (~1s) without the scenario clock needing to change', () => {
    // The wall clock's displayed precision is hour:minute (no seconds), so
    // the system time starts one second before a minute boundary — any test
    // runner's local time zone still rolls its minute/hour digits at that
    // boundary, making the tick observable without depending on the runner's
    // offset.
    vi.setSystemTime(new Date('2026-07-16T10:00:59Z'))
    setExerciseClock({ scenarioNow: () => new Date('2026-07-16T14:30:00Z') })
    mockScope({ timeZone: 'UTC' })

    render(<StaffHeader surfaceName="Controller Console" />)

    const before = screen.getByTestId('staff-header-wall-clock').textContent

    act(() => {
      vi.setSystemTime(new Date('2026-07-16T10:01:00Z'))
      vi.advanceTimersByTime(1000)
    })

    const after = screen.getByTestId('staff-header-wall-clock').textContent
    expect(after).not.toBe(before)
  })
})

describe('StaffHeader — staff world (thumbnail-distinguishability, XC-002)', () => {
  it('renders as plain content with no participant chrome — the navy background/light text is the frame\'s job (story 05), not re-asserted here', () => {
    // StaffHeader lays out the ROW; StaffShellFrame paints the navy chrome
    // (see StaffShellFrame.test.tsx for that coverage). This test only
    // guards that StaffHeader renders standalone without needing the frame.
    render(<StaffHeader surfaceName="Controller Console" />)
    expect(screen.getByTestId('staff-header')).toBeInTheDocument()
  })
})
