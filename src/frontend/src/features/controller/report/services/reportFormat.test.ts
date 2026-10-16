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
  formatStamp,
  groupByHalfHour as groupThreads,
  halfHourOf,
  injectName,
  orderThreads,
  REPORT_PAGE_RULE,
  initialsOf,
  niceMax,
  sourceLabel,
} from './reportFormat'
import { MOCK_REPORT } from './reportMock'

describe('reportFormat', () => {
  it('groups posts under their scenario half-hour in order', () => {
    const groups = groupByHalfHour(MOCK_REPORT.posts)
    expect(groups.map(group => group.label)).toEqual([
      '14 Oct 2026 · 16:00',
      '15 Oct 2026 · 09:00',
      '15 Oct 2026 · 09:30',
      '15 Oct 2026 · 10:00',
      '15 Oct 2026 · 10:30',
    ])
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
    expect(summary).toContain('from 10-14 16:00 to 10-15 11:00')
    expect(summary).toContain('#4 Lookalike says "don\'t boil" at 10-15 09:40')
    // No ref: the title alone, once.
    expect(summary).toContain('Impersonator: brown water at 10-15 09:12')
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
    const sameDay = { bins: bins.slice(0, 1), binMinutes: 5, injectMarkers: [] }
    expect(axisLabelMode(sameDay)).toBe('time')
  })

  // Story 31: dates on multi-day spans (the pure formatting behind every printed time).
  it('formatStamp carries the date only when the report spans days', () => {
    expect(formatStamp('2026-10-15 06:39', false)).toBe('06:39')
    expect(formatStamp('2026-10-15 06:39', true)).toBe('15 Oct 06:39')
    expect(formatStamp('2026-01-05 23:59', true)).toBe('5 Jan 23:59')
    expect(formatStamp('06:39', true)).toBe('06:39')
  })

  it('injectName prints the title once and the ref only when there is one', () => {
    expect(injectName(null, 'Test test')).toBe('Test test')
    expect(injectName('', 'Test test')).toBe('Test test')
    expect(injectName('4', 'Lookalike')).toBe('#4 Lookalike')
    expect(injectName('I-04', 'Lookalike')).toBe('I-04 Lookalike')
  })

  it('the page rule has zero margin', () => {
    expect(REPORT_PAGE_RULE).toMatch(/margin:\s*0\s*;/)
  })

  // Story 31 (DF-47): threads group by the ROOT's time and never trust the given order.
  it('keeps a thread in its root half-hour group, even when given out of order', () => {
    const root = MOCK_REPORT.posts.find(item => item.id === 'p-4')
    const late = MOCK_REPORT.posts.find(item => item.id === 'p-4r')
    expect(root).toBeDefined()
    expect(late?.scenarioAt).toBe('2026-10-15 10:02')
    const shuffled = [...MOCK_REPORT.posts].reverse()
    const group = groupThreads(shuffled).find(item => item.posts.some(post => post.id === 'p-4'))
    expect(group?.label).toBe('15 Oct 2026 · 09:30')
    expect(group?.posts.map(post => post.id)).toContain('p-4r')
    expect(group?.nestedIds.has('p-4r')).toBe(true)
    expect(group?.nestedIds.has('p-4')).toBe(false)
  })

  it('treats a reply to an unlisted parent as a root at its own time, and flattens depth to one level', () => {
    const ordered = orderThreads([...MOCK_REPORT.posts].reverse())
    const flags = new Map(ordered.map(entry => [entry.post.id, entry.nested]))
    expect(flags.get('p-9')).toBe(false) // parent n-2 is not listed
    expect(flags.get('p-3')).toBe(true)
    expect(flags.get('p-3b')).toBe(true) // reply to a reply: still one level
    const ids = ordered.map(entry => entry.post.id)
    expect(ids.indexOf('p-3b')).toBe(ids.indexOf('p-3') + 1) // siblings follow the root in time order
    expect(ids.indexOf('p-2') + 1).toBe(ids.indexOf('p-3'))
  })

  it('never drops a post whose threadRootId names a non-root or forms a cycle', () => {
    const base = MOCK_REPORT.posts[0]
    if (base === undefined) throw new Error('mock has no posts')
    const post = (id: string, threadRootId: string, scenarioAt: string) =>
      ({ ...base, id, threadRootId, depth: threadRootId === id ? 0 : 1, scenarioAt })
    const posts = [
      post('c', 'c', '2026-10-15 09:00'),
      post('b', 'c', '2026-10-15 09:01'),
      post('a', 'b', '2026-10-15 09:02'), // root is b, which is not itself a root
      post('x', 'y', '2026-10-15 09:03'), // x <-> y cycle
      post('y', 'x', '2026-10-15 09:04'),
    ]
    const ordered = orderThreads(posts)
    expect(ordered.map(entry => entry.post.id).sort()).toEqual(['a', 'b', 'c', 'x', 'y'])
    const flags = new Map(ordered.map(entry => [entry.post.id, entry.nested]))
    expect(flags.get('b')).toBe(true)
    expect(flags.get('a')).toBe(false)
    expect(flags.get('x')).toBe(false)
    expect(flags.get('y')).toBe(false)
  })
})
