/**
 * features/controller/report/services/reportFilters.ts
 * ---------------------------------------------------------------------------
 * Pure helpers for the post-record filters (demo-feedback story 30, DF-44): the defaults, the
 * canonical source order, the scenario-time text validation, and the one-line statement of the
 * active filters that is printed above the record.
 *
 * Times are exercise-zone "yyyy-MM-dd HH:mm" STRINGS. Nothing here converts a time zone; ordering
 * is plain string comparison, which is correct for that fixed-width format.
 */

import type { ReportFilters, ReportSourceKey } from '../types/report'

/** Canonical order; also the order sources are sent and spoken in. */
export const SOURCE_ORDER: readonly ReportSourceKey[] = ['participant', 'scripted', 'engine', 'noise']

/** Checkbox labels (also the words in the printed statement, lower-cased). */
export const SOURCE_LABELS: Record<ReportSourceKey, string> = {
  participant: 'Participant',
  scripted: 'Scripted inject',
  engine: 'Engine',
  noise: 'Background noise',
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  sources: ['participant', 'scripted', 'engine'],
  from: null,
  to: null,
}

/** Sources in canonical order, de-duplicated. */
export function orderedSources(sources: readonly ReportSourceKey[]): ReportSourceKey[] {
  return SOURCE_ORDER.filter(key => sources.includes(key))
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/

/** True for a real calendar date-time written "yyyy-MM-dd HH:mm". */
export function isValidStamp(text: string): boolean {
  const match = STAMP.exec(text)
  if (match === null) return false
  const [, y = '', mo = '', d = '', h = '', mi = ''] = match
  const month = Number(mo)
  const day = Number(d)
  if (Number(h) > 23 || Number(mi) > 59 || month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(Number(y), month, 0)).getUTCDate()
  return day <= daysInMonth
}

export type TimeFieldResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly message: string }

/**
 * Validates one From/To entry. Empty is fine (no bound). Otherwise it must be a real
 * "yyyy-MM-dd HH:mm" inside the exercise window (when the window is known).
 */
export function parseTimeField(
  raw: string,
  windowStart: string | null,
  windowEnd: string | null,
): TimeFieldResult {
  const text = raw.trim()
  if (text === '') return { ok: true, value: null }
  if (!isValidStamp(text)) {
    return { ok: false, message: 'Use the format yyyy-MM-dd HH:mm, for example 2026-10-15 09:30.' }
  }
  // The lower bound is the start of the exercise's first scenario DAY, so a whole-day window
  // (the "Latest scenario day" preset on a one-day exercise) is always accepted.
  const earliest = earliestStamp(windowStart)
  if (earliest !== null && text < earliest) {
    return {
      ok: false,
      message: `Must be ${earliest} or later (the exercise starts on ${earliest.slice(0, 10)}).`,
    }
  }
  if (windowEnd !== null && text > windowEnd) {
    return { ok: false, message: `Must be ${windowEnd} or earlier (the exercise ends then).` }
  }
  return { ok: true, value: text }
}

/** "participant, scripted inject and engine". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`
}

/** "10-15 09:00" from "2026-10-15 09:00". */
function shortStamp(stamp: string): string {
  return stamp.slice(5)
}

/**
 * The printed one-liner, e.g. "Showing participant, scripted inject and engine posts,
 * 10-15 09:00 – 10-15 10:00" or "… posts for the whole exercise".
 */
export function describeFilters(filters: ReportFilters): string {
  const sources = joinWords(
    orderedSources(filters.sources).map(key => SOURCE_LABELS[key].toLowerCase()),
  )
  const head = `Showing ${sources} posts`
  if (filters.from !== null && filters.to !== null) {
    return `${head}, ${shortStamp(filters.from)} – ${shortStamp(filters.to)}`
  }
  if (filters.from !== null) return `${head}, from ${shortStamp(filters.from)}`
  if (filters.to !== null) return `${head}, up to ${shortStamp(filters.to)}`
  return `${head} for the whole exercise`
}

/**
 * A wire stamp ("yyyy-MM-dd HH:mm") as a `datetime-local` value ("yyyy-MM-ddTHH:mm"), and back.
 * Both are exercise-zone wall times: the input carries no zone, so nothing is converted.
 */
export function toInputValue(stamp: string): string {
  return stamp.replace(' ', 'T')
}

export function fromInputValue(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

/** The earliest value the From/To pickers offer: 00:00 of the exercise's first scenario day. */
export function earliestStamp(windowStart: string | null): string | null {
  return windowStart === null ? null : `${windowStart.slice(0, 10)} 00:00`
}
