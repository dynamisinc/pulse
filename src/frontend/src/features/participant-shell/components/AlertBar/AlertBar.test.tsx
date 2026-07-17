/**
 * features/participant-shell/components/AlertBar/AlertBar.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (alert-bar host) — RTL coverage for `AlertBar.tsx`: the four
 * states incl. `none` as zero height (AC1), the ticker-default vs
 * emergency-forced-band treatment split and collapse-on-scroll behavior
 * (AC2, D7-002), multi-alert ticker rotation and the emergency band's "+N
 * more" stack (AC3), persistence / never-user-dismissable (AC4), the
 * `role="status"` + live-region a11y contract with severity carried by chip
 * TEXT (AC5, NFR-001), and scenario-time-only rendering (AC5, COR-053).
 *
 * `./useAlerts` is mocked at the module boundary (mirrors
 * `ComplianceChrome.test.tsx` mocking `useChromeConfig`) so every test
 * controls exactly the active alert set under test, independent of that
 * seam's own network/query behavior (covered separately in
 * `useAlerts.test.tsx` / `useAlerts.default.test.tsx`).
 *
 * `@/core/exerciseContext` is mocked to a fixed `timeZone: 'UTC'` — exercise-
 * context resolution is a different seam's own concern here; only the
 * `timeZone` VALUE matters for `useScenarioTime`. `@/core/clock` itself is
 * NOT mocked — the REAL `useScenarioTime()` / `formatScenarioTime()` are
 * exercised against an injected exercise clock (`setExerciseClock`), exactly
 * as `ShellLayout.test.tsx` / `useScenarioTime.test.tsx` do, so a scenario-
 * time regression in the real seam would still be caught here.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertBar } from './AlertBar'
import { useAlerts } from './useAlerts'
import { formatScenarioTime, resetExerciseClock, setExerciseClock } from '@/core/clock'
import type { IExerciseClock } from '@/core/clock'
import type { Alert, AlertSeverity } from './alertTypes'

vi.mock('./useAlerts', () => ({
  useAlerts: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alert-bar-0001',
    exerciseName: 'Alert Bar Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockUseAlerts = vi.mocked(useAlerts)

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    severity: 'info',
    message: 'Default test alert message.',
    scenarioTime: '2026-07-16T14:00:00.000Z',
    ...overrides,
  }
}

/** Overrides jsdom's `window.scrollY` so the collapse-on-scroll effect can be exercised. */
function setScrollY(value: number): void {
  Object.defineProperty(window, 'scrollY', { value, configurable: true })
}

beforeEach(() => {
  mockUseAlerts.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  setScrollY(0)
  resetExerciseClock()
})

describe('AlertBar — none state (AC1)', () => {
  it('keeps a persistent but EMPTY, zero-height live region when there are no active alerts', () => {
    mockUseAlerts.mockReturnValue([])

    render(<AlertBar />)

    // The live region stays mounted (so the none→first-alert transition below
    // announces) but is empty and reserves no space (AC1): no chip, message,
    // timestamp, or Details anatomy.
    const host = screen.getByTestId('pulse-alert-bar')
    expect(host).toHaveAttribute('role', 'status')
    expect(host).toHaveAttribute('data-alert-treatment', 'none')
    expect(host).toBeEmptyDOMElement()
    expect(screen.queryByTestId('pulse-alert-bar-message')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-alert-bar-details')).not.toBeInTheDocument()
  })

  it('announces the first alert by populating a live region that was already mounted (none → active)', () => {
    // A role=status inserted already-populated is not reliably announced; the
    // region must exist EMPTY first, then receive content. Pin that the same
    // host element persists across the none→active transition and gains text.
    mockUseAlerts.mockReturnValue([])
    const { rerender } = render(<AlertBar />)
    const hostBefore = screen.getByTestId('pulse-alert-bar')
    expect(hostBefore).toBeEmptyDOMElement()

    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info', message: 'First alert appears.' })])
    rerender(<AlertBar />)

    const hostAfter = screen.getByTestId('pulse-alert-bar')
    expect(hostAfter).toBe(hostBefore) // same element — region existed before content
    expect(hostAfter).toHaveAttribute('role', 'status')
    expect(hostAfter).toHaveTextContent('First alert appears.')
  })
})

describe('AlertBar — four active states, full anatomy (AC1)', () => {
  it('info: renders chip (icon+LABEL) + message + scenario timestamp + Details link, in the ticker treatment', () => {
    const alert = makeAlert({ severity: 'info', message: 'Water main break reported on 5th Ave.' })
    mockUseAlerts.mockReturnValue([alert])

    render(<AlertBar />)

    const host = screen.getByTestId('pulse-alert-bar')
    expect(host).toHaveAttribute('data-alert-severity', 'info')
    expect(host).toHaveAttribute('data-alert-treatment', 'ticker')

    const chip = screen.getByTestId('pulse-alert-bar-chip')
    expect(chip).toHaveTextContent('INFO')
    expect(chip.querySelector('svg')).toBeInTheDocument()

    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent(alert.message)
    expect(screen.getByTestId('pulse-alert-bar-timestamp'))
      .toHaveTextContent(formatScenarioTime(alert.scenarioTime, 'UTC'))

    const details = screen.getByTestId('pulse-alert-bar-details')
    expect(details).toHaveTextContent(/details/i)
    expect(details).toHaveAttribute('href', '/alerts')
  })

  it('advisory: renders chip (icon+LABEL) + message + scenario timestamp + Details link, in the ticker treatment', () => {
    const alert = makeAlert({ severity: 'advisory', message: 'Boil-water notice in effect for Sector 4.' })
    mockUseAlerts.mockReturnValue([alert])

    render(<AlertBar />)

    const host = screen.getByTestId('pulse-alert-bar')
    expect(host).toHaveAttribute('data-alert-severity', 'advisory')
    expect(host).toHaveAttribute('data-alert-treatment', 'ticker')

    const chip = screen.getByTestId('pulse-alert-bar-chip')
    expect(chip).toHaveTextContent('ADVISORY')
    expect(chip.querySelector('svg')).toBeInTheDocument()

    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent(alert.message)
    expect(screen.getByTestId('pulse-alert-bar-timestamp'))
      .toHaveTextContent(formatScenarioTime(alert.scenarioTime, 'UTC'))

    const details = screen.getByTestId('pulse-alert-bar-details')
    expect(details).toHaveTextContent(/details/i)
    expect(details).toHaveAttribute('href', '/alerts')
  })

  it('emergency: renders chip (icon+LABEL) + message + scenario timestamp + Details link, in the full band treatment', () => {
    const alert = makeAlert({ severity: 'emergency', message: 'Immediate evacuation ordered for Zone A.' })
    mockUseAlerts.mockReturnValue([alert])

    render(<AlertBar />)

    const host = screen.getByTestId('pulse-alert-bar')
    expect(host).toHaveAttribute('data-alert-severity', 'emergency')
    expect(host).toHaveAttribute('data-alert-treatment', 'band')

    const chip = screen.getByTestId('pulse-alert-bar-chip')
    expect(chip).toHaveTextContent('EMERGENCY')
    expect(chip.querySelector('svg')).toBeInTheDocument()

    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent(alert.message)
    expect(screen.getByTestId('pulse-alert-bar-timestamp'))
      .toHaveTextContent(formatScenarioTime(alert.scenarioTime, 'UTC'))

    const details = screen.getByTestId('pulse-alert-bar-details')
    expect(details).toHaveTextContent(/details/i)
    expect(details).toHaveAttribute('href', '/alerts')
  })
})

describe('AlertBar — severity carried by chip TEXT, never color-only (NFR-001)', () => {
  it.each([
    ['info', 'INFO'],
    ['advisory', 'ADVISORY'],
    ['emergency', 'EMERGENCY'],
  ] satisfies [AlertSeverity, string][])(
    'renders the %s severity chip with the LABEL text "%s"',
    (severity, label) => {
      mockUseAlerts.mockReturnValue([makeAlert({ severity })])

      render(<AlertBar />)

      // The label text itself conveys severity - a chip that only swapped a
      // background/foreground color while keeping identical text would fail
      // this (NFR-001: never color-only).
      expect(screen.getByTestId('pulse-alert-bar-chip')).toHaveTextContent(label)
    },
  )
})

describe('AlertBar — ticker default vs emergency-forced band (AC2, D7-002)', () => {
  it('uses the dark ticker treatment (not the emergency band) when no active alert is emergency', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'advisory' })])

    render(<AlertBar />)

    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('data-alert-treatment', 'ticker')
  })

  it('forces the full emergency band the instant ANY active alert is emergency, even alongside non-emergency alerts', () => {
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'a1', severity: 'info', message: 'Routine info alert.' }),
      makeAlert({ id: 'a2', severity: 'emergency', message: 'Evacuate now.' }),
    ])

    render(<AlertBar />)

    const host = screen.getByTestId('pulse-alert-bar')
    expect(host).toHaveAttribute('data-alert-treatment', 'band')
    expect(host).toHaveAttribute('data-alert-severity', 'emergency')
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Evacuate now.')
  })

  it('the emergency band never collapses on scroll - full anatomy remains after scrolling past the threshold', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'emergency', message: 'Evacuate now.' })])

    render(<AlertBar />)

    setScrollY(1000)
    fireEvent.scroll(window)

    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('data-alert-treatment', 'band')
    expect(screen.getByTestId('pulse-alert-bar-message')).toBeInTheDocument()
    expect(screen.getByTestId('pulse-alert-bar-timestamp')).toBeInTheDocument()
    expect(screen.getByTestId('pulse-alert-bar-details')).toBeInTheDocument()
    // The ticker-only collapsed tap-to-expand affordance never appears here.
    expect(screen.queryByTestId('pulse-alert-bar-expand')).not.toBeInTheDocument()
  })
})

describe('AlertBar — ticker collapse-on-scroll + re-expand (AC2, D7-002)', () => {
  it('collapses to a compact strip (chip + message only, loses timestamp + Details) once scrolled past the threshold', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info', message: 'Water main break.' })])

    render(<AlertBar />)

    setScrollY(50)
    fireEvent.scroll(window)

    expect(screen.queryByTestId('pulse-alert-bar-timestamp')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-alert-bar-details')).not.toBeInTheDocument()
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Water main break.')
    const expand = screen.getByTestId('pulse-alert-bar-expand')
    expect(expand).toBeInTheDocument()
    // Severity still conveyed by text even in the collapsed compact strip.
    expect(expand).toHaveAttribute('aria-label', expect.stringContaining('INFO'))
  })

  it('re-expands the full anatomy when the collapsed compact strip is tapped', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info' })])

    render(<AlertBar />)

    setScrollY(50)
    fireEvent.scroll(window)
    fireEvent.click(screen.getByTestId('pulse-alert-bar-expand'))

    expect(screen.getByTestId('pulse-alert-bar-timestamp')).toBeInTheDocument()
    expect(screen.getByTestId('pulse-alert-bar-details')).toBeInTheDocument()
    expect(screen.queryByTestId('pulse-alert-bar-expand')).not.toBeInTheDocument()
  })

  it('re-collapses on the very next scroll after a tap re-expand (manual expand does not stick permanently)', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info' })])

    render(<AlertBar />)

    setScrollY(50)
    fireEvent.scroll(window)
    fireEvent.click(screen.getByTestId('pulse-alert-bar-expand'))
    expect(screen.getByTestId('pulse-alert-bar-timestamp')).toBeInTheDocument()

    fireEvent.scroll(window)

    expect(screen.queryByTestId('pulse-alert-bar-timestamp')).not.toBeInTheDocument()
    expect(screen.getByTestId('pulse-alert-bar-expand')).toBeInTheDocument()
  })
})

describe('AlertBar — multi-alert ticker rotation (AC3, ~3.5s)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('rotates the ticker through all active alerts every ~3.5s, wrapping back to the first', () => {
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'a1', severity: 'info', message: 'First alert message.' }),
      makeAlert({ id: 'a2', severity: 'advisory', message: 'Second alert message.' }),
    ])

    render(<AlertBar />)

    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('First alert message.')
    expect(screen.getByTestId('pulse-alert-bar-chip')).toHaveTextContent('INFO')

    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Second alert message.')
    expect(screen.getByTestId('pulse-alert-bar-chip')).toHaveTextContent('ADVISORY')
    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('data-alert-severity', 'advisory')

    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('First alert message.')
  })

  it('does not rotate (no interval-driven change) when only a single alert is active', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info', message: 'Only alert message.' })])

    render(<AlertBar />)

    act(() => {
      vi.advanceTimersByTime(7000)
    })

    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Only alert message.')
  })
})

describe('AlertBar — multi-alert "+N more" stack (emergency band, AC3)', () => {
  it('shows a "+N more" chip when other alerts are active alongside the emergency, and expands the full stack when tapped', () => {
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'a1', severity: 'emergency', message: 'Evacuate now.' }),
      makeAlert({ id: 'a2', severity: 'info', message: 'Second info alert.' }),
      makeAlert({ id: 'a3', severity: 'advisory', message: 'Third advisory alert.' }),
    ])

    render(<AlertBar />)

    const moreChip = screen.getByTestId('pulse-alert-bar-more-chip')
    expect(moreChip).toHaveTextContent('+2 more')
    expect(moreChip).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('pulse-alert-bar-stack')).not.toBeInTheDocument()

    fireEvent.click(moreChip)

    expect(moreChip).toHaveAttribute('aria-expanded', 'true')
    const stack = screen.getByTestId('pulse-alert-bar-stack')
    expect(within(stack).getAllByTestId('pulse-alert-bar-stack-item')).toHaveLength(2)
    expect(stack).toHaveTextContent('Second info alert.')
    expect(stack).toHaveTextContent('Third advisory alert.')
  })

  it('does not render a "+N more" chip when only the emergency alert is active', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'emergency' })])

    render(<AlertBar />)

    expect(screen.queryByTestId('pulse-alert-bar-more-chip')).not.toBeInTheDocument()
  })
})

describe('AlertBar — persists / never user-dismissable (AC4)', () => {
  it('never renders any dismiss/close affordance anywhere in the host', () => {
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'a1', severity: 'emergency', message: 'Evacuate now.' }),
      makeAlert({ id: 'a2', severity: 'info', message: 'Second alert.' }),
    ])

    render(<AlertBar />)
    fireEvent.click(screen.getByTestId('pulse-alert-bar-more-chip'))

    expect(screen.queryByRole('button', { name: /close|dismiss/i })).not.toBeInTheDocument()
    for (const button of screen.queryAllByRole('button')) {
      expect(button.textContent?.toLowerCase() ?? '').not.toMatch(/close|dismiss/)
      expect(button.getAttribute('aria-label')?.toLowerCase() ?? '').not.toMatch(/close|dismiss/)
    }
  })
})

describe('AlertBar — accessibility: role=status + live-region announce (AC5, NFR-001)', () => {
  it('exposes role="status" with aria-live="polite" and aria-atomic for a non-emergency severity', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'advisory' })])

    render(<AlertBar />)

    const host = screen.getByRole('status')
    expect(host).toHaveAttribute('aria-live', 'polite')
    expect(host).toHaveAttribute('aria-atomic', 'true')
  })

  it('upgrades to aria-live="assertive" for the emergency severity (higher urgency)', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'emergency' })])

    render(<AlertBar />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'assertive')
  })

  it('updates the live region announced text (and upgrades urgency) when a re-render escalates to emergency', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'advisory', message: 'Advisory message.' })])
    const { rerender } = render(<AlertBar />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent('Advisory message.')

    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'emergency', message: 'Emergency message.' })])
    rerender(<AlertBar />)

    const host = screen.getByRole('status')
    expect(host).toHaveAttribute('aria-live', 'assertive')
    expect(host).toHaveTextContent('Emergency message.')
  })
})

describe('AlertBar — scenario time only, never wall-clock (COR-053, WAVE0-REVIEW precedent 18)', () => {
  it('renders the alert timestamp from the fixed alert.scenarioTime via formatScenarioTime, independent of both the real system clock and the exercise clock\'s "now"', () => {
    vi.useFakeTimers()
    // Three deliberately divergent instants: the real (mocked) system clock,
    // the exercise-clock's own "now", and the alert's fixed wire timestamp.
    // A component that leaked either of the first two instead of rendering
    // `alert.scenarioTime` would render a DIFFERENT string below, not
    // coincidentally the same one.
    const systemTime = new Date('1999-12-31T23:59:00Z')
    vi.setSystemTime(systemTime)
    const exerciseNow = new Date('2040-01-01T00:00:00Z')
    setExerciseClock(fixedClock(exerciseNow))

    const alertInstant = '2026-07-16T14:00:00.000Z'
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info', scenarioTime: alertInstant })])

    render(<AlertBar />)

    const expected = formatScenarioTime(alertInstant, 'UTC')
    expect(screen.getByTestId('pulse-alert-bar-timestamp')).toHaveTextContent(expected)
    expect(formatScenarioTime(systemTime, 'UTC')).not.toBe(expected)
    expect(formatScenarioTime(exerciseNow, 'UTC')).not.toBe(expected)
  })
})

describe('AlertBar — no leaked intervals/listeners on unmount', () => {
  it('clears every interval it creates (ticker rotation + scenario-time poll) on unmount', () => {
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'a1', severity: 'info' }),
      makeAlert({ id: 'a2', severity: 'advisory' }),
    ])
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { unmount } = render(<AlertBar />)
    const created = setIntervalSpy.mock.calls.length
    unmount()

    expect(clearIntervalSpy.mock.calls.length).toBe(created)

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('removes its scroll listener on unmount (no leaked listener)', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info' })])
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<AlertBar />)
    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), expect.objectContaining({ passive: true }))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
