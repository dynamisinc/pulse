/**
 * features/participant-shell/components/AlertBar/AlertBar.mobile.test.tsx
 * ---------------------------------------------------------------------------
 * Regression tests for two alert-bar defects found capturing the user guide
 * at a 390x844 phone viewport (PRT-010/012, D0 §4.6 mobile-first, NFR-001):
 *
 *  1. MOBILE LAYOUT — the one-line ticker squeezed the message to ~3
 *     ellipsized characters ("Boi…"). The row must now WRAP and the message
 *     must never be ellipsized, so the full text stays readable.
 *  2. DETAILS LINK — "Details →" pointed at `/alerts`, which had no route
 *     (the social `/:handle` route rendered "This account doesn't exist").
 *     The link must target `ALERTS_PATH` and, inside a router, navigate there
 *     client-side.
 *
 * jsdom performs no layout, so (1) asserts the CSS contract that produces
 * wrapping (flex-wrap, white-space, no text-overflow) rather than measured
 * pixel widths; the guide screenshot at 390px is the visual check.
 *
 * `useAlerts` and `useExerciseContext` are mocked at the module boundary,
 * exactly as `AlertBar.test.tsx` does; the clock is NOT mocked (scenario time
 * is rendered by the real `useScenarioTime`).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { AlertBar } from './AlertBar'
import { ALERTS_PATH } from './alertsRoute'
import { useAlerts } from './useAlerts'
import type { Alert } from './alertTypes'

vi.mock('./useAlerts', () => ({
  useAlerts: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alert-bar-mobile-0001',
    exerciseName: 'Alert Bar Mobile Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockUseAlerts = vi.mocked(useAlerts)

/** A realistic EAS-length message — far longer than fits on one 390px line. */
const LONG_MESSAGE =
  'Boil water advisory in effect for Zones 2 and 3 until further notice. Use bottled water.'

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    severity: 'advisory',
    message: LONG_MESSAGE,
    scenarioTime: '2026-07-16T14:00:00.000Z',
    ...overrides,
  }
}

function setScrollY(value: number): void {
  Object.defineProperty(window, 'scrollY', { value, configurable: true })
}

beforeEach(() => {
  mockUseAlerts.mockReset()
  setExerciseClock({ scenarioNow: () => new Date('2026-07-16T14:05:00.000Z') })
})

afterEach(() => {
  setScrollY(0)
  resetExerciseClock()
})

describe('AlertBar — mobile layout (390px readability)', () => {
  it.each(['info', 'advisory', 'emergency'] as const)(
    '%s: the row wraps and the message is never ellipsized',
    severity => {
      mockUseAlerts.mockReturnValue([makeAlert({ severity })])
      render(<AlertBar />)

      const message = screen.getByTestId('pulse-alert-bar-message')
      // The FULL text is rendered — nothing is cut in the DOM.
      expect(message).toHaveTextContent(LONG_MESSAGE)
      // It is allowed to wrap and is not truncated with an ellipsis.
      expect(message.style.whiteSpace).toBe('normal')
      expect(message.style.textOverflow).toBe('')
      expect(message.style.overflowWrap).toBe('anywhere')

      // Its row wraps, so the fixed-width timestamp + link drop to a second
      // line on a phone instead of squeezing the message.
      const row = message.parentElement
      expect(row?.style.flexWrap).toBe('wrap')
    },
  )

  it('keeps the severity chip intact (icon + LABEL, never squeezed) beside the wrapped message', () => {
    mockUseAlerts.mockReturnValue([makeAlert()])
    render(<AlertBar />)

    const chip = screen.getByTestId('pulse-alert-bar-chip')
    expect(chip).toHaveTextContent('ADVISORY')
    expect(chip.querySelector('svg')).not.toBeNull()
    expect(chip.style.flexShrink).toBe('0')
    expect(chip.style.whiteSpace).toBe('nowrap')
  })

  it('collapsed (scrolled) ticker clamps to two lines but keeps the full text for assistive tech', () => {
    mockUseAlerts.mockReturnValue([makeAlert()])
    render(<AlertBar />)

    setScrollY(200)
    fireEvent.scroll(window)

    const expand = screen.getByTestId('pulse-alert-bar-expand')
    expect(expand).toHaveAccessibleName(`ADVISORY alert: ${LONG_MESSAGE}. Tap for details.`)
    // The compact strip spans the bar so its contents have room to wrap.
    expect(expand.style.width).toBe('100%')

    const message = screen.getByTestId('pulse-alert-bar-message')
    expect(message).toHaveTextContent(LONG_MESSAGE)
    expect(message.style.whiteSpace).toBe('normal')
    expect(message.style.webkitLineClamp).toBe('2')
  })
})

describe('AlertBar — Details link target (PRT-012)', () => {
  it('outside a router, renders a plain anchor to the alerts route', () => {
    mockUseAlerts.mockReturnValue([makeAlert()])
    render(<AlertBar />)

    const details = screen.getByTestId('pulse-alert-bar-details')
    expect(ALERTS_PATH).toBe('/alerts')
    expect(details).toHaveAttribute('href', ALERTS_PATH)
  })

  it.each(['advisory', 'emergency'] as const)(
    '%s: inside a router, "Details →" navigates client-side to the alerts route',
    async severity => {
      mockUseAlerts.mockReturnValue([makeAlert({ severity })])
      render(
        <MemoryRouter initialEntries={['/home']}>
          <AlertBar />
          <Routes>
            <Route path="/home" element={<p>home view</p>} />
            <Route path={ALERTS_PATH} element={<p>alerts view</p>} />
            <Route path="/:handle" element={<p>profile view</p>} />
          </Routes>
        </MemoryRouter>,
      )

      const details = screen.getByRole('link', { name: 'Details →' })
      expect(details).toHaveAttribute('href', ALERTS_PATH)

      fireEvent.click(details)

      expect(await screen.findByText('alerts view')).toBeInTheDocument()
      expect(screen.queryByText('profile view')).not.toBeInTheDocument()
    },
  )
})

describe('AlertBar — touch targets on phones (mobile-tablet 05, gap G1)', () => {
  it('gives "Details →" and "+N more" the coarse-pointer hit-area class, with its stylesheet outside the live region', () => {
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'e1', severity: 'emergency' }),
      makeAlert({ id: 'a2', severity: 'advisory' }),
    ])
    const { container } = render(
      <MemoryRouter>
        <AlertBar />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('pulse-alert-bar-details')).toHaveClass('pulse-alert-bar-hit')
    expect(screen.getByTestId('pulse-alert-bar-more-chip')).toHaveClass('pulse-alert-bar-hit')

    const style = container.querySelector('style')
    expect(style?.textContent).toMatch(/\.pulse-alert-bar-hit\s*\{[^}]*min-height:\s*44px/)
    // Never inside role="status": a stylesheet must not join an announcement.
    expect(screen.getByTestId('pulse-alert-bar').contains(style)).toBe(false)
  })

  it('gives the ticker "Details →" the same hit-area class', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ severity: 'info' })])
    render(<AlertBar />)

    expect(screen.getByTestId('pulse-alert-bar-details')).toHaveClass('pulse-alert-bar-hit')
  })
})
