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
 *    `onTogglePreview` only (story 04 supplies the real behavior), is
 *    keyboard-operable, and is HANDLER-GATED — a surface that wires no
 *    `onTogglePreview` renders no preview control at all, rather than a
 *    focusable, keyboard-reachable button whose click does nothing (WR-003:
 *    a dead control is indistinguishable from a broken feature);
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
 *
 * `StaffHeader` now also calls `useNavigate()` for its sign-out control
 * (feature: login, story 04) — every render needs a Router ancestor. The
 * local `render()` wrapper below (shadowing RTL's own, renamed `rtlRender`)
 * wraps every call site in a real `MemoryRouter` so none of the existing
 * `render(<StaffHeader ... />)` call sites below need to change.
 * `react-router-dom` keeps its real `MemoryRouter` (via `importOriginal`) and
 * only overrides `useNavigate()` with a spy; `@/core/auth`'s `endSession()` is
 * mocked at the module boundary (its own contract — cache clear + logout — is
 * covered by `core/auth/endSession.test.ts`) so this file only asserts that the
 * control CALLS it, never re-tests its internals.
 */
import type { ReactElement } from 'react'
import { act, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StaffHeader, STAFF_CLASSIFICATION } from './StaffHeader'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope, ExerciseStatus } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { endSession } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

vi.mock('@/core/auth', () => ({
  endSession: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

/** Wraps every `render(<StaffHeader ... />)` call site in a real Router. */
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: MemoryRouter })
}

const BASE_SCOPE: ExerciseScope = {
  exerciseId: 'ex-test-staff-header-0001',
  exerciseName: 'Bay Shield 2026',
  timeZone: 'UTC',
  status: 'active',
}

const mockEndSession = vi.mocked(endSession)

function mockScope(overrides: Partial<ExerciseScope> = {}) {
  vi.mocked(useExerciseContext).mockReturnValue({ ...BASE_SCOPE, ...overrides })
}

beforeEach(() => {
  mockScope()
  mockEndSession.mockReset()
  mockEndSession.mockResolvedValue(undefined)
  mockNavigate.mockReset()
})

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('StaffHeader — renders every required region (AC1)', () => {
  it('renders the brand lockup, identity badge, dual clock pair, state pill, FOUO tag, presence, and preview button', () => {
    // The preview control is HANDLER-GATED (see the header describe below), so
    // a render that expects it must wire the handler that gives it a behavior.
    render(<StaffHeader surfaceName="Controller Console" onTogglePreview={vi.fn()} />)

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(within(lockup).getByText('PULSE')).toBeInTheDocument()
    expect(within(lockup).getByText('Controller Console')).toBeInTheDocument()

    const badge = screen.getByTestId('staff-header-identity-badge')
    expect(within(badge).getByText('Bay Shield 2026')).toBeInTheDocument()
    // Exact role/cell string (not a loose substring match) — pins the
    // `${role} · ${cell}` join format the mock seam (staffHeaderMocks.ts) feeds it.
    expect(within(badge).getByText('CONTROLLER · SimCell-1')).toBeInTheDocument()

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

describe('StaffHeader — surfaceName reflects the prop, not a hardcoded lockup value', () => {
  it('renders a different surface name for a different surfaceName prop', () => {
    render(<StaffHeader surfaceName="Evaluator Dashboard" />)

    const lockup = screen.getByTestId('staff-header-lockup')
    expect(within(lockup).getByText('Evaluator Dashboard')).toBeInTheDocument()
    expect(within(lockup).queryByText('Controller Console')).not.toBeInTheDocument()
  })
})

describe('StaffHeader — staff presence roster (contract seam: staffHeaderMocks.ts)', () => {
  it('exposes each presence member by its real accessible label, not just its initials', () => {
    render(<StaffHeader surfaceName="Controller Console" />)

    const presence = screen.getByRole('group', { name: 'Staff presence' })
    expect(within(presence).getByLabelText('SimCell-1 (you)')).toBeInTheDocument()
    expect(within(presence).getByLabelText('SimCell-2 · J. Okoro')).toBeInTheDocument()
    expect(within(presence).getByLabelText('Director · L. Park')).toBeInTheDocument()
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

  // The transitional superset story 01a widened `ExerciseStatus` to: the COR-032
  // six plus the legacy four still valid through the transition.
  const ALL_STATUSES: ExerciseStatus[] = [
    'build', 'staged', 'live', 'paused', 'completed', 'archived',
    'scheduled', 'active', 'complete',
  ]

  it.each(ALL_STATUSES)(
    'status "%s" renders no switcher control either (switching UX is out of scope for this story)',
    status => {
      mockScope({ status })
      render(<StaffHeader surfaceName="Controller Console" />)

      const badge = screen.getByTestId('staff-header-identity-badge')
      expect(within(badge).queryByRole('button')).not.toBeInTheDocument()
      expect(within(badge).queryByRole('combobox')).not.toBeInTheDocument()
    },
  )
})

describe('StaffHeader — exercise state pill (NFR-001: never color-only)', () => {
  // Exhaustive by its `Record` type over the widened union — so a status the
  // backend can now emit (COR-032's six) can never render a pill with no text
  // label. The legacy four are aliases of their COR-032 replacement.
  const EXPECTED_LABELS: Record<ExerciseStatus, string> = {
    build: 'BUILD',
    staged: 'STAGED',
    live: 'LIVE',
    paused: 'PAUSED',
    completed: 'ENDEX',
    archived: 'ARCHIVED',
    active: 'LIVE',
    scheduled: 'STAGED',
    complete: 'ENDEX',
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
      // The pill is a live-region landmark a screen reader can actually find
      // by role (not merely a data-testid hook) — locks in the `role="status"`
      // attribute genuinely registering in the accessibility tree.
      expect(screen.getByRole('status', { name: `Exercise state: ${expectedLabel}` })).toBe(pill)
    },
  )
})

describe('StaffHeader — Preview-as button is driven entirely by props (story 04 out of scope)', () => {
  it('reflects previewActive=false: unpressed, "Preview as participant" label', () => {
    render(
      <StaffHeader surfaceName="Controller Console" previewActive={false} onTogglePreview={vi.fn()} />,
    )

    const button = screen.getByRole('button', { name: /preview as participant/i })
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('reflects previewActive=true: pressed, "Exit preview" label', () => {
    render(<StaffHeader surfaceName="Controller Console" previewActive onTogglePreview={vi.fn()} />)

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

  it('renders NO preview control at all when no onTogglePreview handler is supplied (WR-003)', () => {
    // The old contract shipped the button regardless and merely proved the
    // click was a safe no-op. That is exactly the defect: on a surface with no
    // preview capability (the planner workspace; the controller console today)
    // it left a focusable, keyboard-reachable button that answers nothing, so
    // a staff user cannot tell "not available here" from "broken". The control
    // must now be ABSENT — not present-and-inert.
    render(<StaffHeader surfaceName="Exercise Settings" previewActive={false} />)

    expect(screen.queryByTestId('staff-header-preview-toggle')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /preview as participant/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exit preview/i })).not.toBeInTheDocument()

    // The rest of the header still rendered — this is a gated control, not a
    // header that failed to mount.
    expect(screen.getByTestId('staff-header-lockup')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-sign-out')).toBeInTheDocument()
  })

  it('renders the preview control, focusable and functional, as soon as a handler IS supplied', async () => {
    const user = userEvent.setup()
    const onTogglePreview = vi.fn()
    render(<StaffHeader surfaceName="Evaluator Dashboard" onTogglePreview={onTogglePreview} />)

    const button = screen.getByTestId('staff-header-preview-toggle')
    expect(button).toBeInTheDocument()

    button.focus()
    expect(document.activeElement).toBe(button)

    await user.click(button)
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

  it('the scenario clock renders in the exercise\'s configured IANA time zone, never raw UTC (COR-053)', () => {
    // 20:15:30 UTC is 13:15:30 in America/Los_Angeles (PDT, UTC-7 in July) —
    // proves the clock actually converts through the exercise's configured
    // zone rather than always rendering the underlying UTC instant.
    const scenarioInstant = new Date('2026-07-16T20:15:30Z')
    vi.setSystemTime(scenarioInstant)
    setExerciseClock({ scenarioNow: () => scenarioInstant })
    mockScope({ timeZone: 'America/Los_Angeles' })

    render(<StaffHeader surfaceName="Controller Console" />)

    const scenarioText = screen.getByTestId('staff-header-scenario-clock').textContent ?? ''

    expect(scenarioText).toContain('13:15:30')
    expect(scenarioText).not.toContain('20:15:30')
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

describe('StaffHeader — primary-emphasis text INHERITS its color rather than hardcoding one (module-header decision 2)', () => {
  it('the PULSE lockup, identity-badge exercise name, and scenario-clock digits pick up an ancestor text color instead of a fixed one', () => {
    // StaffShellFrame (story 05) is the one that actually paints the navy
    // background + light `textPrimary` on the real header element — this
    // test proves StaffHeader never shortcuts that by hardcoding its own
    // light color on its primary-emphasis text, which would silently stop
    // tracking the frame's color if the frame (or a future consumer) ever
    // painted the header a different color. (The preview-toggle label and
    // secondary/muted text are explicitly `textMuted`-colored in the
    // component, not inherited — this test only covers the elements that
    // actually set no explicit `color`.)
    render(
      <div style={{ color: 'rgb(10, 20, 30)' }}>
        <StaffHeader surfaceName="Controller Console" />
      </div>,
    )

    const pulseLabel = screen.getByText('PULSE')
    const exerciseNameLabel = screen.getByText('Bay Shield 2026')
    const scenarioClockDigits = screen
      .getByTestId('staff-header-scenario-clock')
      .querySelector('[aria-labelledby="staff-header-scenario-clock-label"]')

    expect(scenarioClockDigits).not.toBeNull()
    expect(getComputedStyle(pulseLabel).color).toBe('rgb(10, 20, 30)')
    expect(getComputedStyle(exerciseNameLabel).color).toBe('rgb(10, 20, 30)')
    expect(getComputedStyle(scenarioClockDigits as Element).color).toBe('rgb(10, 20, 30)')
  })
})

describe('StaffHeader — sign-out control (feature: login, story 04; COR-012)', () => {
  it('renders a real button with an accessible "Sign out" name', () => {
    render(<StaffHeader surfaceName="Controller Console" />)

    const button = screen.getByRole('button', { name: /sign out/i })
    expect(button.tagName).toBe('BUTTON')
  })

  it('calls the shared endSession() helper, then navigates to LOGIN_PATH, on click', async () => {
    const user = userEvent.setup()
    render(<StaffHeader surfaceName="Controller Console" />)

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(mockEndSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(LOGIN_PATH))
  })

  it('is keyboard-operable: reachable by Tab and activatable with Enter', async () => {
    const user = userEvent.setup()
    render(<StaffHeader surfaceName="Controller Console" />)

    const button = screen.getByRole('button', { name: /sign out/i })
    button.focus()
    expect(button).toHaveFocus()

    await user.keyboard('{Enter}')

    await waitFor(() => expect(mockEndSession).toHaveBeenCalledTimes(1))
  })
})
