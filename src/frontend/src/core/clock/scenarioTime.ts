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
 *   (currently mock) exercise clock. Returns a fresh `Date` (callers must
 *   never be able to mutate the clock). Never `Date.now()` / bare `new Date()`.
 * - `formatScenarioTime(instant, timeZone, opts?)` — renders an instant as an
 *   absolute string, a news-style dateline, or a "2h ago" relative string.
 *   Absolute/dateline use `Intl.DateTimeFormat` with the passed-in IANA
 *   `timeZone`; relative is a PURE INSTANT DELTA (see below).
 * - `useScenarioTime(timeZone?, refreshMs?)` — a hook that keeps a single
 *   "now" snapshot live and hands back a `format` callback bound to the zone
 *   and anchored to that one snapshot (so a whole feed renders consistently).
 *
 * Two precedents this module sets, deliberately:
 *  1. Relative age is PURE INSTANT ARITHMETIC on the millisecond delta — never
 *     calendar math (e.g. date-fns `intervalToDuration`), which computes in the
 *     runtime's local zone and would make the SAME two instants render "23h
 *     ago" vs "1d ago" across a DST boundary / in different browsers. The
 *     passed `timeZone` affects absolute/dateline only.
 *  2. There is ONE "now" per render pass — relative rendering takes an injected
 *     reference (`opts.now`, or the hook's snapshot); it does not re-read a
 *     global per row.
 *
 * `timeZone` defaults to UTC — a neutral, obviously-not-a-real-place default so
 * a forgotten zone fails loud (an odd UTC time) rather than quietly rendering a
 * plausible-but-wrong regional time on a COR-053 surface. Real exercises pass
 * their configured zone (COR-030), resolved via `useExerciseContext()` upstream;
 * this module never resolves it itself.
 *
 * Wave-0 decoupling: one of Pulse's three Wave-0 foundation seams (alongside
 * exercise-isolation/10 and telemetry/01). It must NOT import
 * `core/exerciseContext` or `core/telemetry` — it stands alone; wiring happens
 * later, in consumers.
 *
 * Note: `features/evaluator/services/scenarioTime.ts` is a pre-existing,
 * separate local stub for the evaluator surface only. It is NOT modified or
 * imported here; other surfaces are superseded onto this canonical utility
 * later, outside this story.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getExerciseClock, onExerciseClockSwapped } from './exerciseClock'

/**
 * Neutral default zone when a consumer doesn't (yet) supply one. Deliberately
 * UTC: a forgotten `timeZone` renders an obviously-UTC time, not a plausible-
 * but-wrong regional one — a silent wrong-zone default is banned on a COR-053
 * surface. Real exercises resolve their configured zone (COR-030) and pass it in.
 */
export const DEFAULT_SCENARIO_TIME_ZONE = 'UTC'

/**
 * A concrete regional zone for standalone/demo/test use where a realistic
 * rendering is wanted. NOT the production default — real call sites pass the
 * exercise's configured zone explicitly.
 */
export const MOCK_SCENARIO_TIME_ZONE = 'America/New_York'

/** Which rendering `formatScenarioTime` should produce. */
export type ScenarioTimeFormat = 'absolute' | 'dateline' | 'relative'

export interface FormatScenarioTimeOptions {
  /** Which rendering to produce. Defaults to `'absolute'`. */
  format?: ScenarioTimeFormat
  /** Locale passed to `Intl.DateTimeFormat`. Defaults to `'en-US'`. */
  locale?: string
  /**
   * Reference "now" for `'relative'` rendering. Supply it (e.g. from
   * `useScenarioTime().now`) so every row in one render pass is anchored to a
   * SINGLE snapshot; defaults to `scenarioNow()` when omitted.
   */
  now?: Date | string | number
}

/**
 * Returned for an unparseable instant. Renders nothing rather than throwing a
 * `RangeError` into a participant tree (Intl throws on an Invalid Date) or
 * emitting a nonsense relative string.
 */
const INVALID_INSTANT = ''

/**
 * The current scenario-time instant, as a fresh `Date`.
 *
 * Sourced from the exercise clock (`exerciseClock.ts`) — a Wave-0 mock today,
 * the real native/Cadence-linked provider once story 01 lands. Never reads
 * wall-clock directly; all relative-time math is computed against this value,
 * not `Date.now()`.
 */
export function scenarioNow(): Date {
  return new Date(getExerciseClock().scenarioNow().getTime())
}

/**
 * Formats `instant` as participant-visible scenario time.
 *
 * @param instant  The scenario-time instant to render (`Date`, ISO string, or
 *   epoch ms). An unparseable value renders as an empty string, never a throw.
 * @param timeZone IANA time zone to render in. Explicit argument — defaults to
 *   {@link DEFAULT_SCENARIO_TIME_ZONE} (UTC). This module never resolves it.
 * @param opts     `format` (default `'absolute'`), `locale` (default `'en-US'`),
 *   and `now` (relative reference instant; default `scenarioNow()`).
 *
 * Renderings:
 * - `'absolute'` — a localized date + time, e.g. "Jul 16, 2026, 2:30 PM".
 * - `'dateline'` — a news-style dateline, e.g. "JUL 16, 2026".
 * - `'relative'` — an elapsed string against `now`, e.g. "2h ago" / "in 2h".
 *   Units emitted: `m` (1–59), `h` (1–23), `d` (1–7); beyond ~7 days it falls
 *   back to an absolute rendering so old backdated content never reads "168h
 *   ago". Values truncate (59m40s → "59m"). Pure instant arithmetic — TZ/DST
 *   independent.
 */
export function formatScenarioTime(
  instant: Date | string | number,
  timeZone: string = DEFAULT_SCENARIO_TIME_ZONE,
  opts: FormatScenarioTimeOptions = {},
): string {
  const date = toDate(instant)
  if (Number.isNaN(date.getTime())) return INVALID_INSTANT

  const { format = 'absolute', locale = 'en-US' } = opts

  switch (format) {
    case 'dateline':
      return formatDateline(date, timeZone, locale)
    case 'relative':
      return formatRelative(date, timeZone, locale, opts.now)
    case 'absolute':
    default:
      return formatAbsolute(date, timeZone, locale)
  }
}

export interface UseScenarioTimeResult {
  /** The current scenario-time instant; refreshed as the clock advances. */
  now: Date
  /**
   * Formats `instant` per {@link formatScenarioTime}, bound to this hook's
   * `timeZone` and anchored to this hook's `now` snapshot for relative
   * rendering (so every row in one pass agrees). Pass `opts.now` to override.
   */
  format: (instant: Date | string | number, opts?: FormatScenarioTimeOptions) => string
}

/** Default interval, in ms, on which `useScenarioTime` re-reads `scenarioNow()`. */
const DEFAULT_REFRESH_MS = 30_000

/**
 * Component-facing wrapper around the scenario-time utility.
 *
 * Keeps a single `now` snapshot live — re-reading `scenarioNow()` on an
 * interval AND (if the clock supports it) on a clock change-notification, so a
 * Director time-jump / pause propagates promptly rather than after the next
 * poll. Only re-renders when the scenario instant actually changes (a paused
 * clock must not thrash a 120-posts/min feed, NFR-002). The returned `format`
 * anchors relative rendering to this one snapshot.
 *
 * @param timeZone  IANA zone to format in. Defaults to
 *   {@link DEFAULT_SCENARIO_TIME_ZONE}; real callers pass the exercise's zone.
 * @param refreshMs Poll interval, in ms. Defaults to {@link DEFAULT_REFRESH_MS}.
 */
export function useScenarioTime(
  timeZone: string = DEFAULT_SCENARIO_TIME_ZONE,
  refreshMs: number = DEFAULT_REFRESH_MS,
): UseScenarioTimeResult {
  const [now, setNow] = useState<Date>(() => scenarioNow())

  useEffect(() => {
    const tick = () => {
      const next = scenarioNow()
      setNow(prev => (prev.getTime() === next.getTime() ? prev : next))
    }
    const id = setInterval(tick, refreshMs)
    // Prompt propagation of jumps/pause when the clock supports it (story 01);
    // the mock has no subscribe, so this is a no-op there and polling carries.
    const unsubscribe = getExerciseClock().subscribe?.(tick)
    return () => {
      clearInterval(id)
      unsubscribe?.()
    }
  }, [refreshMs])

  const format = useCallback(
    (instant: Date | string | number, opts?: FormatScenarioTimeOptions) =>
      formatScenarioTime(instant, timeZone, { ...opts, now: opts?.now ?? now }),
    [timeZone, now],
  )

  return { now, format }
}

// -----------------------------------------------------------------------------
// Shared relative-time ticker (burst legibility, NFR-002 / SOC-071)
// -----------------------------------------------------------------------------
//
// `useScenarioTime` gives every caller its OWN 30 s interval and re-renders the
// caller on every tick. For a feed of hundreds of rows that is hundreds of timers
// and hundreds of component re-renders per tick, a long task on a phone. The ticker
// below is ONE interval (plus one clock subscription) shared by every
// `useRelativeScenarioTime` caller, holding the same kind of `now` snapshot
// `useScenarioTime` holds. Each caller subscribes with a snapshot that is the
// formatted STRING, so React re-renders a row only when its text actually changes
// ("2m ago" -> "3m ago"), not on every tick.

let sharedNow: Date | undefined
const sharedListeners = new Set<() => void>()
let sharedStop: (() => void) | undefined

function sharedTick(): void {
  const next = scenarioNow()
  if (sharedNow !== undefined && sharedNow.getTime() === next.getTime()) return
  sharedNow = next
  for (const listener of Array.from(sharedListeners)) listener()
}

/** Wires the interval, the ACTIVE clock's change-notification, visibility and clock swaps. */
function sharedStart(): () => void {
  let unsubscribeClock = getExerciseClock().subscribe?.(sharedTick)
  const id = setInterval(sharedTick, DEFAULT_REFRESH_MS)
  // A backgrounded tab throttles timers: catch up the moment it is visible again.
  const onVisible = () => {
    if (document.visibilityState === 'visible') sharedTick()
  }
  document.addEventListener('visibilitychange', onVisible)
  // The exercise clock object itself was replaced: follow the new one.
  const stopSwap = onExerciseClockSwapped(() => {
    unsubscribeClock?.()
    unsubscribeClock = getExerciseClock().subscribe?.(sharedTick)
    sharedTick()
  })
  return () => {
    clearInterval(id)
    unsubscribeClock?.()
    document.removeEventListener('visibilitychange', onVisible)
    stopSwap()
  }
}

function sharedSubscribe(listener: () => void): () => void {
  sharedListeners.add(listener)
  if (sharedListeners.size === 1) {
    sharedStop = sharedStart()
    // The first subscriber's snapshot may predate this moment: refresh and notify.
    sharedNow = undefined
    sharedTick()
  } else {
    // Seed from the live clock, not a possibly-stale snapshot. Re-broadcast only when
    // the minute moved (a per-subscriber ms difference would make N mounts cost N^2
    // snapshot reads); within a minute the relative strings cannot differ.
    const fresh = scenarioNow().getTime()
    const minuteMoved = sharedNow === undefined
      || Math.floor(fresh / 60_000) !== Math.floor(sharedNow.getTime() / 60_000)
    if (minuteMoved) sharedTick()
  }
  return () => {
    sharedListeners.delete(listener)
    if (sharedListeners.size === 0) {
      sharedStop?.()
      sharedStop = undefined
    }
  }
}

function sharedSnapshot(): Date {
  // While subscribed the tick owns the snapshot. With nobody subscribed it can be
  // stale (or from a previous clock), so read the clock. It is deliberately NOT cached
  // for a tick: React calls getSnapshot twice per render and a cached value would need
  // its own invalidation; two reads can only differ if a whole-minute boundary falls
  // between them (microseconds apart), and the render is then re-run by React.
  if (sharedListeners.size === 0 || sharedNow === undefined) sharedNow = scenarioNow()
  return sharedNow
}

/**
 * The `'relative'` rendering of `instant` ("2m ago"), kept current on the shared
 * ticker above. Same text as `useScenarioTime(timeZone).format(instant, { format:
 * 'relative' })`, but the component re-renders ONLY when that text changes.
 */
export function useRelativeScenarioTime(
  instant: Date | string | number,
  timeZone: string = DEFAULT_SCENARIO_TIME_ZONE,
): string {
  const getSnapshot = useCallback(
    () => formatScenarioTime(instant, timeZone, { format: 'relative', now: sharedSnapshot() }),
    [instant, timeZone],
  )
  return useSyncExternalStore(sharedSubscribe, getSnapshot, getSnapshot)
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function toDate(instant: Date | string | number): Date {
  return instant instanceof Date ? instant : new Date(instant)
}

/** `Intl.DateTimeFormat` construction is expensive; one per locale + zone is enough. */
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>()

function formatAbsolute(date: Date, timeZone: string, locale: string): string {
  const key = `${locale}|${timeZone}`
  let formatter = absoluteFormatters.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    absoluteFormatters.set(key, formatter)
  }
  return formatter.format(date)
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

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function formatRelative(
  date: Date,
  timeZone: string,
  locale: string,
  now: Date | string | number | undefined,
): string {
  const reference = now === undefined ? scenarioNow() : toDate(now)
  if (Number.isNaN(reference.getTime())) {
    // Bad reference — fall back to an absolute rendering rather than lie.
    return formatAbsolute(date, timeZone, locale)
  }

  const diffMs = reference.getTime() - date.getTime()
  const absMs = Math.abs(diffMs)

  if (absMs > RELATIVE_FALLBACK_MS) {
    return formatAbsolute(date, timeZone, locale)
  }
  if (absMs < JUST_NOW_THRESHOLD_MS) {
    return 'just now'
  }

  // Pure instant arithmetic — TZ/DST-independent by construction. Units
  // emitted: m (1-59), h (1-23), d (1-7 up to the fallback). Truncates.
  const { unit, value } = relativeUnit(absMs)
  return diffMs >= 0 ? `${value}${unit} ago` : `in ${value}${unit}`
}

/** Reduces a positive millisecond gap to its single largest whole unit (d/h/m). */
function relativeUnit(absMs: number): { unit: string; value: number } {
  if (absMs >= DAY_MS) return { unit: 'd', value: Math.floor(absMs / DAY_MS) }
  if (absMs >= HOUR_MS) return { unit: 'h', value: Math.floor(absMs / HOUR_MS) }
  return { unit: 'm', value: Math.floor(absMs / MINUTE_MS) }
}
