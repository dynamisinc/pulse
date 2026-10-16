/**
 * features/participant-shell/components/AlertBar/AlertsHistory.test.tsx
 * ---------------------------------------------------------------------------
 * The `/alerts` "Details" view content (PRT-012): every active alert, most
 * severe first, each with a severity chip (icon + LABEL — never color-only,
 * NFR-001), the FULL message, and its scenario time (COR-053 — the real
 * `useScenarioTime` against an injected exercise clock, never wall-clock).
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatScenarioTime, resetExerciseClock, setExerciseClock } from '@/core/clock'
import { AlertsHistory } from './AlertsHistory'
import { sortAlertsForHistory } from './sortAlertsForHistory'
import { useAlerts } from './useAlerts'
import type { Alert } from './alertTypes'

vi.mock('./useAlerts', () => ({
  useAlerts: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alerts-history-0001',
    exerciseName: 'Alerts History Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockUseAlerts = vi.mocked(useAlerts)

function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    id: 'alert',
    severity: 'info',
    message: 'Message.',
    scenarioTime: '2026-07-16T14:00:00.000Z',
    ...overrides,
  }
}

const INFO_OLD = makeAlert({ id: 'info-old', severity: 'info', message: 'Cooling centers open.', scenarioTime: '2026-07-16T12:00:00.000Z' })
const INFO_NEW = makeAlert({ id: 'info-new', severity: 'info', message: 'Library hours extended.', scenarioTime: '2026-07-16T13:00:00.000Z' })
const ADVISORY = makeAlert({ id: 'adv', severity: 'advisory', message: 'Boil water advisory for Zones 2 and 3.', scenarioTime: '2026-07-16T11:00:00.000Z' })
const EMERGENCY = makeAlert({ id: 'emg', severity: 'emergency', message: 'Evacuate low-lying areas now.', scenarioTime: '2026-07-16T10:00:00.000Z' })

beforeEach(() => {
  mockUseAlerts.mockReset()
  setExerciseClock({ scenarioNow: () => new Date('2026-07-16T14:30:00.000Z') })
})

afterEach(() => {
  resetExerciseClock()
})

describe('sortAlertsForHistory', () => {
  it('orders most severe first, then newest first within a severity', () => {
    const sorted = sortAlertsForHistory([INFO_OLD, ADVISORY, INFO_NEW, EMERGENCY])
    expect(sorted.map(alert => alert.id)).toEqual(['emg', 'adv', 'info-new', 'info-old'])
  })

  it('does not mutate its input (the React Query cache)', () => {
    const input = [INFO_OLD, EMERGENCY]
    sortAlertsForHistory(input)
    expect(input.map(alert => alert.id)).toEqual(['info-old', 'emg'])
  })
})

describe('AlertsHistory', () => {
  it('renders an "Alerts" heading and an empty state when no alert is active', () => {
    mockUseAlerts.mockReturnValue([])
    render(<AlertsHistory />)

    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument()
    expect(screen.getByTestId('pulse-alerts-history-empty')).toHaveTextContent('No active alerts.')
    expect(screen.queryAllByTestId('pulse-alerts-history-item')).toHaveLength(0)
  })

  it('lists every active alert, most severe first, with chip label + icon, full message, and scenario time', () => {
    mockUseAlerts.mockReturnValue([INFO_NEW, EMERGENCY, ADVISORY])
    render(<AlertsHistory />)

    const items = screen.getAllByTestId('pulse-alerts-history-item')
    expect(items).toHaveLength(3)

    const expected = [EMERGENCY, ADVISORY, INFO_NEW]
    const labels = ['EMERGENCY', 'ADVISORY', 'INFO']
    items.forEach((item, index) => {
      const alert = expected[index]
      if (alert === undefined) throw new Error('missing expected alert')
      const chip = within(item).getByTestId('pulse-alert-bar-chip')
      // Severity is icon + LABEL text, never color alone (NFR-001).
      expect(chip).toHaveTextContent(labels[index] ?? '')
      expect(chip.querySelector('svg')).not.toBeNull()
      expect(item).toHaveTextContent(alert.message)
      // Scenario time (COR-053), via the real formatter in the exercise zone.
      const time = within(item).getByText(formatScenarioTime(alert.scenarioTime, 'UTC'))
      expect(time.tagName).toBe('TIME')
      expect(time).toHaveAttribute('dateTime', alert.scenarioTime)
    })
  })
})
