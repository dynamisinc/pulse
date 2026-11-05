/**
 * features/participant-shell/components/AlertBar/AlertsHistory.test.tsx
 * ---------------------------------------------------------------------------
 * The `/alerts` history view (PRT-012; channels-foundation story 11): every
 * alert from `GET /alerts/history`, REVERSE-CHRONOLOGICAL as the server sends
 * it, each with a severity chip (icon + LABEL — never color-only, NFR-001),
 * the message verbatim (WX-011), its scenario time (COR-053 — the real
 * `useScenarioTime` against an injected exercise clock), and "Details →" to
 * its source item when it has one. The data hook is mocked at the module
 * boundary; `useAlerts.live.test.tsx` covers the read itself.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatScenarioTime, resetExerciseClock, setExerciseClock } from '@/core/clock'
import { AlertsHistory } from './AlertsHistory'
import { useAlertsHistory, type AlertsHistoryResult } from './useAlertsHistory'
import type { Alert } from './alertTypes'

vi.mock('./useAlertsHistory', () => ({
  useAlertsHistory: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alerts-history-0001',
    exerciseName: 'Alerts History Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockUseAlertsHistory = vi.mocked(useAlertsHistory)

function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    id: 'alert',
    severity: 'info',
    message: 'Message.',
    scenarioTime: '2026-07-16T14:00:00.000Z',
    ...overrides,
  }
}

function history(overrides: Partial<AlertsHistoryResult> = {}): AlertsHistoryResult {
  return {
    alerts: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    ...overrides,
  }
}

// Server order: newest first, whatever the severity.
const INFO_NEW = makeAlert({
  id: 'info-new',
  severity: 'info',
  message: 'Library hours extended.',
  scenarioTime: '2026-07-16T13:00:00.000Z',
})
const ADVISORY = makeAlert({
  id: 'adv',
  severity: 'advisory',
  message: 'Boil water advisory for Zones 2 and 3.',
  scenarioTime: '2026-07-16T11:00:00.000Z',
})
const EMERGENCY = makeAlert({
  id: 'emg',
  severity: 'emergency',
  message: 'Tornado Warning for the northern county until 3:15 PM',
  scenarioTime: '2026-07-16T10:00:00.000Z',
  href: '/weather/nws-metro/tornado-warning-0412',
})

beforeEach(() => {
  mockUseAlertsHistory.mockReset()
  setExerciseClock({ scenarioNow: () => new Date('2026-07-16T14:30:00.000Z') })
})

afterEach(() => {
  resetExerciseClock()
})

describe('AlertsHistory', () => {
  it('renders an "Alerts" heading and an empty state when no alert was ever issued', () => {
    mockUseAlertsHistory.mockReturnValue(history())
    render(<AlertsHistory />)

    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument()
    expect(screen.getByTestId('pulse-alerts-history-empty')).toHaveTextContent('No alerts have been issued.')
    expect(screen.queryAllByTestId('pulse-alerts-history-item')).toHaveLength(0)
  })

  it('shows a loading line while the first page is in flight, and never an alert', () => {
    mockUseAlertsHistory.mockReturnValue(history({ isLoading: true }))
    render(<AlertsHistory />)

    expect(screen.getByTestId('pulse-alerts-history-loading')).toBeInTheDocument()
    expect(screen.getByTestId('pulse-alerts-history')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryAllByTestId('pulse-alerts-history-item')).toHaveLength(0)
  })

  it('fails closed to a plain error line (no alerts) when the history read fails', () => {
    mockUseAlertsHistory.mockReturnValue(history({ isError: true }))
    render(<AlertsHistory />)

    expect(screen.getByTestId('pulse-alerts-history-error')).toBeInTheDocument()
    expect(screen.queryAllByTestId('pulse-alerts-history-item')).toHaveLength(0)
  })

  it('lists reverse-chron in the server order, with chip label + icon, the verbatim message, and scenario time', () => {
    mockUseAlertsHistory.mockReturnValue(history({ alerts: [INFO_NEW, ADVISORY, EMERGENCY] }))
    render(<AlertsHistory />)

    const items = screen.getAllByTestId('pulse-alerts-history-item')
    expect(items).toHaveLength(3)

    const expected = [INFO_NEW, ADVISORY, EMERGENCY]
    const labels = ['INFO', 'ADVISORY', 'EMERGENCY']
    items.forEach((item, index) => {
      const alert = expected[index]
      if (alert === undefined) throw new Error('missing expected alert')
      const chip = within(item).getByTestId('pulse-alert-bar-chip')
      // Severity is icon + LABEL text, never color alone (NFR-001).
      expect(chip).toHaveTextContent(labels[index] ?? '')
      expect(chip.querySelector('svg')).not.toBeNull()
      // Verbatim (WX-011): the exact headline, nothing rewritten.
      expect(within(item).getByText(alert.message).textContent).toBe(alert.message)
      // Scenario time (COR-053), via the real formatter in the exercise zone.
      const time = within(item).getByText(formatScenarioTime(alert.scenarioTime, 'UTC'))
      expect(time.tagName).toBe('TIME')
      expect(time).toHaveAttribute('dateTime', alert.scenarioTime)
    })
  })

  it('links an alert with an href straight to its source item, and gives an alert without one no link', () => {
    mockUseAlertsHistory.mockReturnValue(history({ alerts: [ADVISORY, EMERGENCY] }))
    render(<AlertsHistory />)

    const [advisoryItem, emergencyItem] = screen.getAllByTestId('pulse-alerts-history-item')
    if (advisoryItem === undefined || emergencyItem === undefined) throw new Error('missing items')
    expect(within(advisoryItem).queryByTestId('pulse-alerts-history-details')).toBeNull()
    expect(within(emergencyItem).getByTestId('pulse-alerts-history-details')).toHaveAttribute(
      'href',
      '/weather/nws-metro/tornado-warning-0412',
    )
  })

  it('offers "Show older alerts" while an older page exists, and loads it on activation', async () => {
    const loadMore = vi.fn()
    mockUseAlertsHistory.mockReturnValue(history({ alerts: [INFO_NEW], hasMore: true, loadMore }))
    render(<AlertsHistory />)

    await userEvent.click(screen.getByTestId('pulse-alerts-history-more'))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('offers no "Show older alerts" on the last page', () => {
    mockUseAlertsHistory.mockReturnValue(history({ alerts: [INFO_NEW] }))
    render(<AlertsHistory />)

    expect(screen.queryByTestId('pulse-alerts-history-more')).toBeNull()
  })
})
