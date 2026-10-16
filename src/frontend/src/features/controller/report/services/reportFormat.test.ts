/**
 * features/controller/report/services/reportFormat.test.ts
 * ---------------------------------------------------------------------------
 * The pure helpers behind the printed report: grouping by half-hour, durations, y-axis rounding,
 * initials, source labels. No clock, no time-zone conversion anywhere.
 */
import { describe, expect, it } from 'vitest'
import {
  chartSummary,
  formatDuration,
  groupByHalfHour,
  halfHourOf,
  initialsOf,
  niceMax,
  sourceLabel,
} from './reportFormat'
import { MOCK_REPORT } from './reportMock'

describe('reportFormat', () => {
  it('groups posts under their scenario half-hour in order', () => {
    const groups = groupByHalfHour(MOCK_REPORT.posts)
    expect(groups.map(group => group.label)).toEqual(['09:00', '09:30', '10:00'])
    expect(groups.flatMap(group => group.posts)).toHaveLength(MOCK_REPORT.posts.length)
    expect(halfHourOf('10:29')).toBe('10:00')
    expect(halfHourOf('10:30')).toBe('10:30')
  })

  it('formats durations as m:ss', () => {
    expect(formatDuration(15)).toBe('0:15')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('rounds the y-axis maximum up', () => {
    expect(niceMax(11)).toBe(12)
    expect(niceMax(1)).toBe(2)
    expect(niceMax(13)).toBe(15)
    expect(niceMax(61)).toBe(70)
  })

  it('makes initials and source labels', () => {
    expect(initialsOf('Kestrel County EM')).toBe('KC')
    expect(initialsOf('')).toBe('?')
    expect(sourceLabel('participant', 'R. Okafor')).toBe('Participant · posted by R. Okafor')
    expect(sourceLabel('noise', null)).toBe('White noise')
    expect(sourceLabel('scripted', null)).toBe('Scripted inject')
  })

  it('summarizes the chart in words', () => {
    const summary = chartSummary(MOCK_REPORT.activity)
    expect(summary).toContain('from 09:00 to 11:00')
    expect(summary).toContain('#4 Lookalike rumor at 09:40')
  })
})
