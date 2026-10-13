/**
 * features/participantAdmin/components/people/rosterDisplay.ts
 * ---------------------------------------------------------------------------
 * Pure display logic for the staff roster table (feature: easy-login, story 10):
 * how a row's link state is named, how the list is filtered and sorted, what the
 * summary line counts, and how an instant is shown in the exercise time zone.
 *
 * Kept free of React so every rule is unit-tested directly and the components
 * only render decisions made here.
 *
 * ## Time (staff world)
 * Last sign-in and link-issued instants are REAL wall-clock instants, shown in
 * the EXERCISE time zone with the zone NAMED ("Oct 13, 9:05 AM EDT"). The
 * scenario-time-only rule (COR-053) binds the participant world, not this
 * screen; a controller triaging logins needs the real time a person signed in.
 *
 * ## What the summary counts
 * "N participants · M signed in · K with no link". *Signed in* means the person
 * has signed in at least once (`lastSignInAt` is present) — the triage number,
 * "who still has not made it in". It is not "has a live session right now"
 * (that is the Sessions column). *With no link* is `link.status === 'none'`.
 *
 * World: STAFF. No UI.
 */

import type { RosterEntryDto } from '../../types'

/** The link states the table names. `needsReissue` is an ACTIVE link whose token is lost. */
export type LinkDisplayState = 'active' | 'needsReissue' | 'revoked' | 'none'

/** How a row's link is named (text + icon in the UI, never colour alone). */
export function linkDisplayState(entry: RosterEntryDto): LinkDisplayState {
  if (entry.link.status === 'active' && entry.link.needsReissue === true) return 'needsReissue'
  return entry.link.status
}

/** The visible label for each link state. */
export const LINK_STATE_LABEL: Readonly<Record<LinkDisplayState, string>> = {
  active: 'Active',
  needsReissue: 'Needs reissue',
  revoked: 'Revoked',
  none: 'None',
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/** Case-insensitive substring match on name, agency and sign-in name. Blank = everyone. */
export function filterRoster(
  entries: readonly RosterEntryDto[],
  query: string,
): readonly RosterEntryDto[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return entries
  return entries.filter(entry =>
    entry.name.toLowerCase().includes(needle)
    || (entry.agency ?? '').toLowerCase().includes(needle)
    || entry.signInName.toLowerCase().includes(needle),
  )
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type RosterSortKey =
  | 'name'
  | 'agency'
  | 'role'
  | 'signInName'
  | 'persona'
  | 'link'
  | 'lastSignIn'
  | 'sessions'
  | 'access'

export type SortDirection = 'asc' | 'desc'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** A comparable value for one column; `undefined` = "has no value" (sorts last either way). */
function sortValue(entry: RosterEntryDto, key: RosterSortKey): string | number | undefined {
  switch (key) {
    case 'name': return entry.name
    case 'agency': return entry.agency
    case 'role': return entry.role
    case 'signInName': return entry.signInName
    case 'persona': return entry.persona?.handle
    case 'link': return LINK_STATE_LABEL[linkDisplayState(entry)]
    case 'lastSignIn': {
      if (entry.lastSignInAt === undefined) return undefined
      const time = Date.parse(entry.lastSignInAt)
      return Number.isNaN(time) ? undefined : time
    }
    case 'sessions': return entry.liveSessions
    case 'access': return entry.access
  }
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/**
 * A sorted copy. Rows with no value in the column always sort LAST, in either
 * direction (a blank agency is not "smallest" or "largest"). Ties fall back to
 * name, then id, so the order is stable between refetches.
 */
export function sortRoster(
  entries: readonly RosterEntryDto[],
  key: RosterSortKey,
  direction: SortDirection,
): RosterEntryDto[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...entries].sort((left, right) => {
    const a = sortValue(left, key)
    const b = sortValue(right, key)
    if (a === undefined && b !== undefined) return 1
    if (a !== undefined && b === undefined) return -1
    if (a !== undefined && b !== undefined) {
      const byColumn = compareValues(a, b)
      if (byColumn !== 0) return byColumn * sign
    }
    return collator.compare(left.name, right.name) || collator.compare(left.id, right.id)
  })
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface RosterSummary {
  readonly total: number
  /** Has signed in at least once. */
  readonly signedIn: number
  /** Link status `none` (never issued). */
  readonly noLink: number
}

export function summarizeRoster(entries: readonly RosterEntryDto[]): RosterSummary {
  return {
    total: entries.length,
    signedIn: entries.filter(entry => entry.lastSignInAt !== undefined).length,
    noLink: entries.filter(entry => entry.link.status === 'none').length,
  }
}

/** "42 participants · 38 signed in · 3 with no link" (singular for exactly one). */
export function formatSummary(summary: RosterSummary): string {
  const people = `${summary.total} participant${summary.total === 1 ? '' : 's'}`
  return `${people} · ${summary.signedIn} signed in · ${summary.noLink} with no link`
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

function buildFormatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone })
  } catch {
    // An unrecognised IANA zone must not blank the screen. Fall back to UTC,
    // which the label ("UTC") then names honestly.
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

/**
 * An instant in the exercise time zone WITH the zone named ("Oct 13, 9:05 AM
 * EDT"), or `undefined` when the value is not a parseable instant (never a
 * plausible-looking wrong date).
 */
export function formatInstant(iso: string, timeZone: string): string | undefined {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return undefined
  let formatter = formatterCache.get(timeZone)
  if (formatter === undefined) {
    formatter = buildFormatter(timeZone)
    formatterCache.set(timeZone, formatter)
  }
  return formatter.format(new Date(time))
}

/** "1 session ended." / "2 sessions ended." / "No live sessions to end." */
export function describeSessionsEnded(count: number): string {
  if (count <= 0) return 'No live sessions to end.'
  return count === 1 ? '1 session ended.' : `${count} sessions ended.`
}
