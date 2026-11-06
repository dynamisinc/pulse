/**
 * features/participant-shell/components/AlertBar/sortAlerts.test.ts
 * ---------------------------------------------------------------------------
 * The active set's ONE order (weather FU-5, D4-010 #7): most severe first,
 * then newest first, then by id.
 */
import { describe, expect, it } from 'vitest'
import { sortAlertsBySeverityThenRecency } from './sortAlerts'
import type { Alert } from './alertTypes'

function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    id: 'alert',
    severity: 'info',
    message: 'Message.',
    scenarioTime: '2026-07-16T14:00:00.000Z',
    ...overrides,
  }
}

const INFO_OLD = makeAlert({ id: 'info-old', scenarioTime: '2026-07-16T12:00:00.000Z' })
const INFO_NEW = makeAlert({ id: 'info-new', scenarioTime: '2026-07-16T13:00:00.000Z' })
const ADVISORY = makeAlert({ id: 'adv', severity: 'advisory', scenarioTime: '2026-07-16T11:00:00.000Z' })
const EMERGENCY = makeAlert({ id: 'emg', severity: 'emergency', scenarioTime: '2026-07-16T10:00:00.000Z' })

describe('sortAlertsBySeverityThenRecency', () => {
  it('orders most severe first, then newest first within a severity', () => {
    const sorted = sortAlertsBySeverityThenRecency([INFO_OLD, ADVISORY, INFO_NEW, EMERGENCY])
    expect(sorted.map(alert => alert.id)).toEqual(['emg', 'adv', 'info-new', 'info-old'])
  })

  it('breaks a tie at the same scenario instant by id, so pushes never swap two alerts', () => {
    const b = makeAlert({ id: 'b' })
    const a = makeAlert({ id: 'a' })
    expect(sortAlertsBySeverityThenRecency([b, a]).map(alert => alert.id)).toEqual(['a', 'b'])
    expect(sortAlertsBySeverityThenRecency([a, b]).map(alert => alert.id)).toEqual(['a', 'b'])
  })

  it('does not mutate its input (the React Query cache)', () => {
    const input = [INFO_OLD, EMERGENCY]
    sortAlertsBySeverityThenRecency(input)
    expect(input.map(alert => alert.id)).toEqual(['info-old', 'emg'])
  })
})
