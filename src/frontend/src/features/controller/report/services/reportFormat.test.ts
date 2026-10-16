/**
 * features/controller/report/services/reportFormat.test.ts
 * ---------------------------------------------------------------------------
 * The pure helpers behind the printed report: grouping by half-hour, durations, y-axis rounding,
 * initials, source labels. No clock, no time-zone conversion anywhere.
 */
import { describe, expect, it } from 'vitest'
import {
  addMinutesToStamp,
  axisLabel,
  axisLabelMode,
  binWidthLabel,
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

  it('words the bin width', () => {
    expect(binWidthLabel(5)).toBe('5 scenario minutes')
    expect(binWidthLabel(60)).toBe('scenario hour')
    expect(binWidthLabel(120)).toBe('2 scenario hours')
    expect(binWidthLabel(1440)).toBe('scenario day')
    expect(binWidthLabel(2880)).toBe('2 scenario days')
  })

  it('labels a multi-day chart with dates', () => {
    const bins = ['2026-10-15 09:00', '2026-10-15 21:00', '2026-10-16 09:00'].map(start => (
      { start, participant: 1, scripted: 0, engine: 0, noise: 0 }
    ))
    const hourly = { bins, binMinutes: 720, injectMarkers: [] }
    expect(axisLabelMode(hourly)).toBe('dateTime')
    expect(axisLabel('2026-10-15 09:00', 'dateTime')).toBe('10-15 09:00')
    expect(addMinutesToStamp('2026-10-16 21:00', 720)).toBe('2026-10-17 09:00')
    expect(chartSummary(hourly)).toContain('Posts per 12 scenario hours from 10-15 09:00 to 10-16 21:00')

    const daily = { bins, binMinutes: 1440, injectMarkers: [] }
    expect(axisLabelMode(daily)).toBe('date')
    expect(axisLabel('2026-10-15 00:00', 'date')).toBe('10-15')
    expect(chartSummary(daily)).toContain('Posts per scenario day from 10-15 to 10-17')
    // A same-day, short chart keeps plain HH:mm.
    expect(axisLabelMode(MOCK_REPORT.activity)).toBe('time')
  })
})
