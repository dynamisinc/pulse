/**
 * core/clock/scenarioTime.ts
 * ---------------------------------------------------------------------------
 * Canonical scenario-time utility (COR-053; feature: exercise-clock, story
 * 04 — docs/features/exercise-clock/04-scenario-time-participant-visible.md).
 *
 * The cross-cutting rule the whole product obeys: scenario time is the
 * ONLY participant-visible time. Post timestamps, "2h ago" relative
 * strings, article datelines, weather products, portal datelines — every
 * in-fiction surface renders through this utility. Wall-clock time is
 * telemetry-only and must never leak into the fiction.
 *
 * Exports:
 * - `scenarioNow()` — the current scenario-time instant, read from the
 *   (currently mock) exercise clock in `exerciseClock.ts`. Never
 *   `Date.now()` / unadorned `new Date()`.
 * - `formatScenarioTime(instant, timeZone, opts?)` — renders an instant as
 *   an absolute string, a news-style dateline, or a "2h ago" relative
 *   string, using `Intl.DateTimeFormat` with the passed-in IANA `timeZone`
 *   for TZ-correct absolute/dateline rendering. Relative strings are always
 *   computed against `scenarioNow()`.
 * - `useScenarioTime(timeZone?, refreshMs?)` — a hook wrapping the utility
 *   for component consumption; re-reads `scenarioNow()` on an interval so
 *   "2h ago" strings stay live, and returns a `format` callback bound to
 *   the given time zone.
 *
 * `timeZone` is an explicit argument everywhere in this module (default: a
 * mock IANA zone, for standalone use and tests). This module does NOT import
 * or reach into `core/exerciseContext` to resolve the exercise's real time
 * zone — that wiring happens in consumers (the shell mount contract,
 * `PostCard`, etc.), which read `timeZone` from `useExerciseContext()` and
 * pass it in here.
 *
 * Wave-0 decoupling: this is one of Pulse's three Wave-0 foundation seams
 * (alongside exercise-isolation/10 and telemetry/01). It must NOT import
 * `core/exerciseContext` or `core/telemetry` (or anything from another
 * seam) — it stands alone; wiring happens later, in consumers.
 *
 * Note: `features/evaluator/services/scenarioTime.ts` is a pre-existing,
 * separate local stub for the evaluator surface only. It is NOT modified or
 * imported by this module; other surfaces are superseded onto this
 * canonical utility later, outside this story.
 */

import { useCallback, useEffect, useState } from 'react'
import { intervalToDuration } from 'date-fns'
import type { Duration } from 'date-fns'
import { getExerciseClock } from './exerciseClock'

/**
 * Default IANA time zone used when a consumer doesn't (yet) supply one —
 * e.g. standalone use, Storybook, or unit tests. Real exercises resolve
 * their configured zone (COR-030) via `useExerciseContext()` and pass it
 * into `formatScenarioTime` / `useScenarioTime` explicitly.
 */
export const MOCK_SCENARIO_TIME_ZONE = 'America/New_York'

/** Which rendering `formatScenarioTime` should produce. */
export type ScenarioTimeFormat = 'absolute' | 'dateline' | 'relative'

export interface FormatScenarioTimeOptions {
  /** Which rendering to produce. Defaults to `'absolute'`. */
  format?: ScenarioTimeFormat
  /** Locale passed to `Intl.DateTimeFormat`. Defaults to `'en-US'`. */
  locale?: string
}

/**
 * The current scenario-time instant.
 *
 * Sourced from the exercise clock (`exerciseClock.ts`) — a Wave-0 mock
 * today, the real native/Cadence-linked provider once story 01 lands.
 * Never reads wall-clock directly; all relative-time math in this module is
 * computed against this value, not `Date.now()`.
 */
export function scenarioNow(): Date {
  return getExerciseClock().scenarioNow()
}

/**
 * Formats `instant` as participant-visible scenario time.
 *
 * @param instant  The scenario-time instant to render (`Date`, ISO string,
 *   or epoch ms).
 * @param timeZone IANA time zone to render in (e.g. the exercise's
 *   configured zone, COR-030). Explicit argument — defaults to
 *   {@link MOCK_SCENARIO_TIME_ZONE} for standalone/test use. This module
 *   never resolves it itself.
 * @param opts     Rendering options — `format` (default `'absolute'`) and
 *   `locale` (default `'en-US'`).
 *
 * Renderings:
 * - `'absolute'` — a localized date + time string, e.g. "Jul 16, 2026, 2:30 PM".
 * - `'dateline'` — a news-style dateline, e.g. "JUL 16, 2026".
 * - `'relative'` — an elapsed string against `scenarioNow()`, e.g. "2h ago"
 *   / "in 2h"; falls back to an absolute rendering once the gap exceeds
 *   roughly 7 days, so old backdated content never renders an absurd
 *   "168h ago".
 */
export function formatScenarioTime(
  instant: Date | string | number,
  timeZone: string = MOCK_SCENARIO_TIME_ZONE,
  opts: FormatScenarioTimeOptions = {},
): string {
  const date = toDate(instant)
  const { format = 'absolute', locale = 'en-US' } = opts

  switch (format) {
    case 'dateline':
      return formatDateline(date, timeZone, locale)
    case 'relative':
      return formatRelative(date, timeZone, locale)
    case 'absolute':
    default:
      return formatAbsolute(date, timeZone, locale)
  }
}

export interface UseScenarioTimeResult {
  /** The current scenario-time instant; refreshed every `refreshMs`. */
  now: Date
  /**
   * Formats `instant` per {@link formatScenarioTime}, bound to this hook's
   * `timeZone`.
   */
  format: (instant: Date | string | number, opts?: FormatScenarioTimeOptions) => string
}

/** Default interval, in ms, on which `useScenarioTime` re-reads `scenarioNow()`. */
const DEFAULT_REFRESH_MS = 30_000

/**
 * Component-facing wrapper around the scenario-time utility.
 *
 * Re-reads `scenarioNow()` on `refreshMs` so live "2h ago" strings stay
 * current, and returns a `format` callback pre-bound to `timeZone` so
 * callers don't have to thread it through every call site.
 *
 * @param timeZone  IANA time zone to format in. Defaults to
 *   {@link MOCK_SCENARIO_TIME_ZONE}; real callers pass the exercise's
 *   configured zone (resolved from `useExerciseContext()` upstream — this
 *   hook does not resolve it itself).
 * @param refreshMs How often to re-read `scenarioNow()`, in ms. Defaults to
 *   {@link DEFAULT_REFRESH_MS}.
 */
export function useScenarioTime(
  timeZone: string = MOCK_SCENARIO_TIME_ZONE,
  refreshMs: number = DEFAULT_REFRESH_MS,
): UseScenarioTimeResult {
  const [now, setNow] = useState<Date>(() => scenarioNow())

  useEffect(() => {
    const id = setInterval(() => setNow(scenarioNow()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  const format = useCallback(
    (instant: Date | string | number, opts?: FormatScenarioTimeOptions) =>
      formatScenarioTime(instant, timeZone, opts),
    [timeZone],
  )

  return { now, format }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function toDate(instant: Date | string | number): Date {
  return instant instanceof Date ? instant : new Date(instant)
}

function formatAbsolute(date: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDateline(date: Date, timeZone: string, locale: string): string {
  // News-style dateline, e.g. "JUL 16, 2026".
  const rendered = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
  return rendered.toUpperCase()
}

/** Gap beyond which `'relative'` falls back to an absolute rendering (~7 days). */
const RELATIVE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000

/** Gap below which `'relative'` renders as "just now" rather than "0m ago". */
const JUST_NOW_THRESHOLD_MS = 60 * 1000

function formatRelative(date: Date, timeZone: string, locale: string): string {
  const now = scenarioNow()
  const diffMs = now.getTime() - date.getTime()
  const absMs = Math.abs(diffMs)

  if (absMs > RELATIVE_FALLBACK_MS) {
    return formatAbsolute(date, timeZone, locale)
  }

  if (absMs < JUST_NOW_THRESHOLD_MS) {
    return 'just now'
  }

  const isPast = diffMs >= 0
  const duration = isPast
    ? intervalToDuration({ start: date, end: now })
    : intervalToDuration({ start: now, end: date })
  const { unit, value } = largestUnit(duration)

  return isPast ? `${value}${unit} ago` : `in ${value}${unit}`
}

interface UnitValue {
  unit: string
  value: number
}

/** Reduces a date-fns `Duration` to its single largest non-zero unit. */
function largestUnit(duration: Duration): UnitValue {
  if (duration.years) return { unit: 'y', value: duration.years }
  if (duration.months) return { unit: 'mo', value: duration.months }
  if (duration.days) return { unit: 'd', value: duration.days }
  if (duration.hours) return { unit: 'h', value: duration.hours }
  if (duration.minutes) return { unit: 'm', value: duration.minutes }
  return { unit: 's', value: duration.seconds ?? 0 }
}
