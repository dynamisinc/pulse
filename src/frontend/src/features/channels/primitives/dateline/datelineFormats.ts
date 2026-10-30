/**
 * features/channels/primitives/dateline/datelineFormats.ts
 * ---------------------------------------------------------------------------
 * The dateline FORMAT REGISTRY (channels-foundation 14; COR-053 / XC-008, news FU-3c).
 *
 * A skin names its dateline format (`OutletSkinTokens.dateline.format`); this registry
 * maps that name to a function. The built-ins are `standard`, `relative` and `compact`;
 * a channel registers its own from its folder (news's `wire`) with
 * `registerDatelineFormat(name, fn)`, so no channel forks `ScenarioDateline`.
 *
 * THE RULE THIS MODULE ENFORCES BY SHAPE: a format function receives ONLY a
 * `ScenarioTimeFormatter`: an object of pre-bound renderings of ONE scenario-time
 * instant, already in the exercise time zone. It never receives a `Date`, an epoch or
 * a zone, so a registered format cannot reach wall-clock time or render in the
 * browser's zone. Every rendering goes through `formatScenarioTime` from `@/core/clock`
 * or through an `Intl.DateTimeFormat` that is pinned to the exercise zone here.
 *
 * Wall-clock is banned in this folder: no `Date.now`, no `new Date`, no
 * `toLocale*` (pinned by `primitives.static.test.ts`).
 */

import { formatScenarioTime } from '@/core/clock'

/**
 * Pre-bound renderings of one scenario-time instant in the exercise time zone. Every
 * method returns '' for an unparseable instant, so a bad wire value renders nothing
 * instead of throwing into a participant tree.
 */
export interface ScenarioTimeFormatter {
  /** "Oct 29, 2026, 2:32 PM". */
  readonly absolute: () => string
  /** News-style dateline, "OCT 29, 2026". */
  readonly dateline: () => string
  /** "2h ago" against the shared scenario-time "now" (never `Date.now()`). */
  readonly relative: () => string
  /** Time of day, "2:32 PM". */
  readonly time: () => string
  /** "Oct 29". */
  readonly shortDate: () => string
  /** The zone's short name, "EDT". */
  readonly zoneName: () => string
}

/** A dateline format: scenario-time renderings in, participant-visible text out. */
export type DatelineFormat = (t: ScenarioTimeFormatter) => string

/** The format used when a skin names none, or names one nobody registered. */
export const DEFAULT_DATELINE_FORMAT = 'standard'

const standard: DatelineFormat = t => t.absolute()

const BUILT_INS: Readonly<Record<string, DatelineFormat>> = {
  standard,
  relative: t => t.relative(),
  compact: t => joinParts(t.shortDate(), t.time()),
}

const registry = new Map<string, DatelineFormat>(Object.entries(BUILT_INS))

/**
 * Registers a dateline format under `name`, as a module side effect of a channel's own
 * import (`registerDatelineFormat('wire', t => ...)`). A built-in name cannot be
 * replaced, and registering the same name twice with a different function throws in dev
 * (two channels claiming one name is a bug); re-registering the same function is a no-op,
 * so HMR re-evaluation is safe.
 */
export function registerDatelineFormat(name: string, format: DatelineFormat): void {
  if (name.trim() === '') throw new Error('registerDatelineFormat: name must be non-empty')
  if (Object.hasOwn(BUILT_INS, name)) {
    throw new Error(`registerDatelineFormat: "${name}" is a built-in format and cannot be replaced`)
  }
  const existing = registry.get(name)
  if (existing !== undefined && existing !== format && import.meta.env.DEV) {
    throw new Error(`registerDatelineFormat: "${name}" is already registered`)
  }
  registry.set(name, format)
}

/**
 * The format registered under `name`, or the default (`standard`) when the name is
 * missing or unknown. An unknown name warns once in dev: a skin token naming a format
 * whose channel never registered it is a wiring bug, but a participant still gets a
 * dateline.
 */
export function resolveDatelineFormat(name: string | null | undefined): DatelineFormat {
  if (name === null || name === undefined || name === '') return standard
  const format = registry.get(name)
  if (format !== undefined) return format
  if (import.meta.env.DEV && !warnedUnknown.has(name)) {
    warnedUnknown.add(name)
    console.warn(`ScenarioDateline: unknown dateline format "${name}", using "standard"`)
  }
  return standard
}

const warnedUnknown = new Set<string>()

/** Whether `name` is registered (built-in or channel). */
export function hasDatelineFormat(name: string): boolean {
  return registry.has(name)
}

/** TEST-ONLY: drops channel registrations, keeping the built-ins. */
export function resetDatelineFormatsForTests(): void {
  registry.clear()
  for (const [name, format] of Object.entries(BUILT_INS)) registry.set(name, format)
  warnedUnknown.clear()
}

/**
 * Builds the formatter for `instant` in `timeZone`. `relative` is supplied by the caller
 * (the component reads it off the shared scenario-time ticker), so this module never
 * reads a "now" of its own.
 */
export function createScenarioTimeFormatter(
  instant: string,
  timeZone: string,
  relative: () => string,
): ScenarioTimeFormatter {
  const epoch = Date.parse(instant)
  const valid = Number.isFinite(epoch)
  const pinned = (key: PinnedKey) => (valid ? pinnedFormatter(key, timeZone)(epoch) : '')
  return {
    absolute: () => formatScenarioTime(instant, timeZone, { format: 'absolute' }),
    dateline: () => formatScenarioTime(instant, timeZone, { format: 'dateline' }),
    relative: () => (valid ? relative() : ''),
    time: () => pinned('time'),
    shortDate: () => pinned('shortDate'),
    zoneName: () => pinned('zoneName'),
  }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

type PinnedKey = 'time' | 'shortDate' | 'zoneName'

const PINNED_OPTIONS: Readonly<Record<PinnedKey, Intl.DateTimeFormatOptions>> = {
  time: { hour: 'numeric', minute: '2-digit' },
  shortDate: { month: 'short', day: 'numeric' },
  zoneName: { timeZoneName: 'short', hour: 'numeric' },
}

/** `Intl.DateTimeFormat` construction is expensive; one per key + zone. */
const pinnedCache = new Map<string, (epoch: number) => string>()

function pinnedFormatter(key: PinnedKey, timeZone: string): (epoch: number) => string {
  const cacheKey = `${key}|${timeZone}`
  let format = pinnedCache.get(cacheKey)
  if (format === undefined) {
    // The zone is ALWAYS passed explicitly: never the browser's zone (COR-053). An invalid
    // zone throws a RangeError here; render nothing rather than crash the participant tree.
    let intl: Intl.DateTimeFormat | undefined
    try {
      intl = new Intl.DateTimeFormat('en-US', { ...PINNED_OPTIONS[key], timeZone })
    } catch {
      intl = undefined
    }
    const pinned = intl
    format = pinned === undefined
      ? () => ''
      : key === 'zoneName'
        ? epoch => pinned.formatToParts(epoch).find(part => part.type === 'timeZoneName')?.value ?? ''
        : epoch => pinned.format(epoch)
    pinnedCache.set(cacheKey, format)
  }
  return format
}

function joinParts(...parts: readonly string[]): string {
  return parts.filter(part => part !== '').join(' · ')
}
