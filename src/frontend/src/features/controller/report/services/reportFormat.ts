/**
 * features/controller/report/services/reportFormat.ts
 * ---------------------------------------------------------------------------
 * Pure presentation helpers for the printed exercise report (story 29): labels, grouping by
 * scenario half-hour, chart scaling, durations. No React, no clock, no time-zone conversion:
 * the server sends exercise-zone scenario times already formatted ("yyyy-MM-dd HH:mm" / "HH:mm")
 * and these helpers only slice and group those strings.
 */

import type { ExerciseReport, ReportPost, ReportSource } from '../types/report'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The "HH:mm" of a "yyyy-MM-dd HH:mm" string (or the string itself when already "HH:mm"). */
export function timeOf(scenarioAt: string): string {
  const space = scenarioAt.indexOf(' ')
  return space >= 0 ? scenarioAt.slice(space + 1) : scenarioAt
}

/** The "yyyy-MM-dd" of a "yyyy-MM-dd HH:mm" string. */
export function dateOf(scenarioAt: string): string {
  return scenarioAt.slice(0, 10)
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (match === null) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** "15 Oct 2026" from "yyyy-MM-dd" (or an ISO string; read as written, never converted). */
export function formatDay(ymd: string): string {
  const parts = parseYmd(ymd)
  const month = parts === null ? undefined : MONTHS[parts.m - 1]
  return parts === null || month === undefined ? ymd : `${parts.d} ${month} ${parts.y}`
}

/** "Thu 15 Oct 2026" from "yyyy-MM-dd". */
export function formatDayWithWeekday(ymd: string): string {
  const parts = parseYmd(ymd)
  if (parts === null) return ymd
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay()]
  return `${weekday ?? ''} ${formatDay(ymd)}`.trim()
}

/** "Eastern Time" for an IANA zone id; the id itself when the runtime cannot name it. */
export function zoneName(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date(0))
    return parts.find(part => part.type === 'timeZoneName')?.value ?? timeZone
  } catch {
    return timeZone
  }
}

/** "09:00 – 11:00 (Eastern Time)"; full date-times when the window crosses a day. */
export function formatWindow(
  start: string | null,
  end: string | null,
  timeZone: string,
): string {
  if (start === null && end === null) return 'Not scheduled'
  const zone = ` (${zoneName(timeZone)})`
  if (start === null || end === null) return `${timeOf(start ?? end ?? '')}${zone}`
  if (dateOf(start) === dateOf(end)) return `${timeOf(start)} – ${timeOf(end)}${zone}`
  return `${start} – ${end}${zone}`
}

/** The half-hour a "HH:mm" time falls in: "09:40" -> "09:30". */
export function halfHourOf(time: string): string {
  const [hh = '00', mm = '00'] = time.split(':')
  return `${hh}:${Number(mm) >= 30 ? '30' : '00'}`
}

export interface PostGroup {
  readonly key: string
  readonly label: string
  readonly posts: readonly ReportPost[]
}

/**
 * Groups posts (already in scenario order) under their scenario half-hour. A run that crosses
 * midnight keeps separate groups per day (the label then carries the date).
 */
export function groupByHalfHour(posts: readonly ReportPost[]): PostGroup[] {
  const groups: { key: string; label: string; posts: ReportPost[] }[] = []
  const days = new Set(posts.map(post => dateOf(post.scenarioAt)))
  for (const post of posts) {
    const half = halfHourOf(timeOf(post.scenarioAt))
    const day = dateOf(post.scenarioAt)
    const key = `${day} ${half}`
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === key) {
      last.posts.push(post)
    } else {
      groups.push({ key, label: days.size > 1 ? `${formatDay(day)} · ${half}` : half, posts: [post] })
    }
  }
  return groups
}

/** m:ss, e.g. 15 -> "0:15", 125 -> "2:05". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "#4" for a bare number, otherwise the ref as written ("I-04"). */
export function refLabel(ref: string): string {
  return /^\d+$/.test(ref) ? `#${ref}` : ref
}

/** Up to two initials of a display name; "?" when there is none. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 0)
  const letters = words.length === 1
    ? Array.from(words[0] ?? '').slice(0, 2)
    : words.slice(0, 2).map(word => Array.from(word)[0] ?? '')
  const text = letters.join('').toUpperCase()
  return text.length > 0 ? text : '?'
}

/** A stable avatar background for a handle, from a fixed palette (dark enough for white text). */
const AVATAR_COLORS = [
  '#2f6f9f', '#4b7f52', '#9a6b4f', '#6a5a8c', '#6d6d6d', '#8a3b3b', '#3a6a93', '#7a5c1e',
]
export function avatarColor(handle: string): string {
  let hash = 0
  for (const char of handle) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#6d6d6d'
}

/** The label of a post's source, in words (never color-only). */
export function sourceLabel(source: ReportSource, postedBy: string | null): string {
  const by = postedBy !== null && postedBy.length > 0 ? postedBy : null
  switch (source) {
    case 'participant':
      return by !== null ? `Participant · posted by ${by}` : 'Participant'
    case 'controller-as-persona':
      return by !== null ? `Controller as persona · ${by}` : 'Controller as persona'
    case 'scripted':
      return 'Scripted inject'
    case 'engine':
      return 'Engine'
    case 'noise':
      return 'White noise'
  }
}

export type SeriesKey = 'participant' | 'scripted' | 'engine' | 'noise'

/** Which chart/legend series a source belongs to. */
export function seriesOf(source: ReportSource): SeriesKey {
  return source === 'controller-as-persona' ? 'participant' : source
}

/** A y-axis maximum at or above `max`: even numbers up to 12, then steps of 5 / 10 / 50. */
export function niceMax(max: number): number {
  if (max <= 2) return 2
  if (max <= 12) return Math.ceil(max / 2) * 2
  const step = max <= 50 ? 5 : max <= 100 ? 10 : 50
  return Math.ceil(max / step) * step
}

/** "HH:mm" plus `minutes`, wrapping at midnight. */
export function addMinutes(time: string, minutes: number): string {
  const [hh = '0', mm = '0'] = time.split(':')
  const total = (((Number(hh) * 60 + Number(mm) + minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** The page rule: US Letter portrait. Injected only while the report page is mounted. */
export const REPORT_PAGE_RULE = '@page { size: letter portrait; margin: 0.6in 0.55in; }'

/** Marks the injected `@page` style (found, and asserted on, by tests). */
export const REPORT_PAGE_STYLE_ATTR = 'data-exercise-report-page'

/** The text equivalent of the chart (also the SVG's accessible name). */
export function chartSummary(activity: ExerciseReport['activity']): string {
  const { bins, injectMarkers, binMinutes } = activity
  const first = bins[0]
  const last = bins[bins.length - 1]
  if (first === undefined || last === undefined) return 'No activity to chart.'
  let peak = first
  let peakTotal = -1
  for (const bin of bins) {
    const total = bin.participant + bin.scripted + bin.engine + bin.noise
    if (total > peakTotal) {
      peak = bin
      peakTotal = total
    }
  }
  const markers = injectMarkers.length > 0
    ? ` Key injects: ${injectMarkers.map(m => `${refLabel(m.ref)} ${m.title} at ${timeOf(m.at)}`).join('; ')}.`
    : ''
  return (
    `Posts per ${binMinutes === 5 ? 'five' : binMinutes} minutes from ${timeOf(first.start)} to ` +
    `${addMinutes(timeOf(last.start), binMinutes)}, stacked by source. ` +
    `Busiest: ${peakTotal} posts starting ${timeOf(peak.start)}.${markers}`
  )
}
