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
  /** Ids of the posts in this group that print indented under their thread root (DF-47). */
  readonly nestedIds: ReadonlySet<string>
}

/**
 * Orders posts into threads (DF-47): roots by scenario time (ties keep the given order), each
 * followed by its listed descendants by scenario time. A post is NESTED only when its thread
 * root is really in the list, is not itself and is a root (one indent level at any depth); any
 * other post is treated as its own root and prints at its own time, so no post is ever dropped.
 * This does not trust the server's order: it re-derives the thread order from `threadRootId`.
 */
export function orderThreads(
  posts: readonly ReportPost[],
): { post: ReportPost; nested: boolean }[] {
  const byId = new Map(posts.map(post => [post.id, post]))
  const indexOf = new Map(posts.map((post, index) => [post.id, index]))
  const byTime = (a: ReportPost, b: ReportPost) =>
    a.scenarioAt.localeCompare(b.scenarioAt) || (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0)
  // Nested only under a listed post that is itself a root, so a malformed chain or cycle can
  // never hide a post: it prints as a root instead.
  const isNested = (post: ReportPost) => {
    const root = byId.get(post.threadRootId)
    return post.threadRootId !== post.id && root !== undefined && root.threadRootId === root.id
  }

  const children = new Map<string, ReportPost[]>()
  const roots: ReportPost[] = []
  for (const post of posts) {
    if (isNested(post)) {
      const list = children.get(post.threadRootId) ?? []
      list.push(post)
      children.set(post.threadRootId, list)
    } else {
      roots.push(post)
    }
  }
  roots.sort(byTime)
  const ordered: { post: ReportPost; nested: boolean }[] = []
  for (const root of roots) {
    ordered.push({ post: root, nested: false })
    for (const child of (children.get(root.id) ?? []).sort(byTime)) {
      ordered.push({ post: child, nested: true })
    }
  }
  return ordered
}

/**
 * Groups posts under their scenario half-hour. A thread stays whole in its ROOT's group (a reply
 * never moves the thread). A run that crosses midnight keeps separate groups per day (the label
 * then carries the date).
 */
export function groupByHalfHour(posts: readonly ReportPost[]): PostGroup[] {
  const groups: { key: string; label: string; posts: ReportPost[]; nestedIds: Set<string> }[] = []
  const days = new Set(posts.map(post => dateOf(post.scenarioAt)))
  const rootAt = new Map(posts.map(post => [post.id, post.scenarioAt]))
  for (const { post, nested } of orderThreads(posts)) {
    const at = nested ? rootAt.get(post.threadRootId) ?? post.scenarioAt : post.scenarioAt
    const half = halfHourOf(timeOf(at))
    const day = dateOf(at)
    const key = `${day} ${half}`
    let group = groups[groups.length - 1]
    if (group === undefined || group.key !== key) {
      group = {
        key,
        label: days.size > 1 ? `${formatDay(day)} · ${half}` : half,
        posts: [],
        nestedIds: new Set<string>(),
      }
      groups.push(group)
    }
    group.posts.push(post)
    if (nested) group.nestedIds.add(post.id)
  }
  return groups
}

/** m:ss, e.g. 15 -> "0:15", 125 -> "2:05". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A printed scenario time. On a multi-day report (`spansMultipleDays`) it carries its date,
 * "15 Oct 06:39" (the year is the header's job); otherwise just "06:39". Read as written.
 */
export function formatStamp(stamp: string, spansMultipleDays: boolean): string {
  if (!spansMultipleDays) return timeOf(stamp)
  const parts = parseYmd(stamp)
  const month = parts === null ? undefined : MONTHS[parts.m - 1]
  if (parts === null || month === undefined) return stamp
  return `${parts.d} ${month} ${timeOf(stamp)}`
}

/** An inject's printed name: the MSEL ref before the title only when there is one. */
export function injectName(ref: string | null, title: string): string {
  return ref !== null && ref.length > 0 ? `${refLabel(ref)} ${title}` : title
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

/**
 * The page rule: US Letter portrait, ZERO page margin (DF-46: Chromium and Edge drop the browser's
 * header and footer when the margin is 0; the sheet draws its own 0.5in margin in print CSS).
 * Injected only while the report page is mounted.
 */
export const REPORT_PAGE_RULE = '@page { size: letter portrait; margin: 0; }'

/** Marks the injected `@page` style (found, and asserted on, by tests). */
export const REPORT_PAGE_STYLE_ATTR = 'data-exercise-report-page'

/** The width of a chart bin in words: 5 -> "5 scenario minutes", 120 -> "2 scenario hours". */
export function binWidthLabel(minutes: number): string {
  const unit = (count: number, name: string) =>
    count === 1 ? `scenario ${name}` : `${count} scenario ${name}s`
  if (minutes >= 1440 && minutes % 1440 === 0) return unit(minutes / 1440, 'day')
  if (minutes >= 60 && minutes % 60 === 0) return unit(minutes / 60, 'hour')
  return unit(minutes, 'minute')
}

/** "yyyy-MM-dd HH:mm" plus `minutes` (calendar arithmetic on the written value, no zones). */
export function addMinutesToStamp(stamp: string, minutes: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(stamp)
  if (match === null) return stamp
  const [, y = '0', mo = '1', d = '1', h = '0', mi = '0'] = match
  const moved = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi) + minutes),
  )
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())} ` +
    `${pad(moved.getUTCHours())}:${pad(moved.getUTCMinutes())}`
}

/** How chart times are labeled: "time" (HH:mm), "dateTime" (MM-dd HH:mm) or "date" (MM-dd). */
export type AxisLabelMode = 'time' | 'dateTime' | 'date'

/** Date and time when the bins span dates; date only when a bin is a day or wider. */
export function axisLabelMode(
  activity: Pick<ExerciseReport['activity'], 'bins' | 'binMinutes'>,
): AxisLabelMode {
  const first = activity.bins[0]
  const last = activity.bins[activity.bins.length - 1]
  if (first === undefined || last === undefined) return 'time'
  if (activity.binMinutes >= 1440) return 'date'
  return dateOf(first.start) !== dateOf(last.start) ? 'dateTime' : 'time'
}

/** One axis label from a "yyyy-MM-dd HH:mm" stamp: "09:00", "10-15 09:00" or "10-15". */
export function axisLabel(stamp: string, mode: AxisLabelMode): string {
  if (mode === 'date') return stamp.slice(5, 10)
  if (mode === 'dateTime') return `${stamp.slice(5, 10)} ${timeOf(stamp)}`
  return timeOf(stamp)
}

/** The text equivalent of the chart (also the SVG's accessible name). */
export function chartSummary(activity: ExerciseReport['activity']): string {
  const { bins, injectMarkers, binMinutes } = activity
  const first = bins[0]
  const last = bins[bins.length - 1]
  if (first === undefined || last === undefined) return 'No activity to chart.'
  const mode = axisLabelMode(activity)
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
    ? ` Key injects: ${injectMarkers.map(m => `${injectName(m.ref, m.title)} at ${axisLabel(m.at, mode === 'date' ? 'dateTime' : mode)}`).join('; ')}.`
    : ''
  return (
    `Posts per ${binWidthLabel(binMinutes)} from ${axisLabel(first.start, mode)} to ` +
    `${axisLabel(addMinutesToStamp(last.start, binMinutes), mode)}, stacked by source. ` +
    `Busiest: ${peakTotal} posts starting ${axisLabel(peak.start, mode)}.${markers}`
  )
}
