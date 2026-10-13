/**
 * features/participantAdmin/email/emailLinksFormat.ts
 * ---------------------------------------------------------------------------
 * Pure helpers for "Email links" (easy-login story 13): the button label, the
 * client-side estimate of who can be emailed, and the result summary. Kept out of
 * the `.tsx` so the component file exports only components, and so these rules are
 * unit-testable without rendering.
 *
 * World: STAFF. No React, no theme. Nothing here touches a clock.
 */
import type { RosterEntryDto } from '../types'
import type { RosterEmailResultDto, RosterEmailStatus } from './types'

/** The server's cap: one request emails at most this many people. */
export const MAX_EMAILS_PER_REQUEST = 100

/** The confirm text the story fixes, verbatim. */
export const EMAIL_LINKS_WARNING =
  "This emails each person a personal sign-in link. An emailed link can't be recalled; reissue it to cancel it."

/**
 * The ids worth sending: blank and whitespace-only entries dropped, repeats dropped
 * (first occurrence wins), order kept.
 */
export function usableIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(id => id.trim().length > 0))]
}

/**
 * The roster button label. A selection reads "Email links (N)" for its N usable ids
 * (so a selection of only blank ids reads "(0)" and is never widened to everyone);
 * an EMPTY selection means "everyone eligible" and reads "Email all links".
 */
export function emailLinksLabel(selection: readonly string[]): string {
  return selection.length === 0 ? 'Email all links' : `Email links (${usableIds(selection).length})`
}

/**
 * Whether the roster says this person can be emailed right now: an email address,
 * an enabled account, and an active link whose copy is recoverable. An ESTIMATE for
 * the confirm text only; the server decides, and reports anyone it skips.
 */
export function looksEmailable(entry: RosterEntryDto): boolean {
  return (
    (entry.email?.trim().length ?? 0) > 0
    && entry.access === 'enabled'
    && entry.link.status === 'active'
    && entry.link.needsReissue !== true
  )
}

/** Who a request would consider: the selected entries, or everyone when nothing is selected. */
export function consideredEntries(
  entries: readonly RosterEntryDto[],
  ids: readonly string[],
): RosterEntryDto[] {
  if (ids.length === 0) return [...entries]
  const wanted = new Set(ids)
  return entries.filter(entry => wanted.has(entry.id))
}

/** Plain-language skip and failure reasons. An unknown reason falls back to a generic line. */
const REASON_TEXT: Readonly<Record<string, string>> = {
  noEmail: 'no email address',
  noActiveLink: 'no active link',
  disabled: 'disabled',
  tokenUnrecoverable: 'link needs reissuing',
  notFound: 'not on this roster',
  sendFailed: 'the email could not be sent',
  rateLimited: 'the email service is busy, try again later',
  notAttempted: 'not attempted in time, send again',
}

/** The readable text for a reason. */
export function reasonText(reason: string | undefined): string {
  if (reason === undefined) return 'no reason given'
  return REASON_TEXT[reason] ?? 'no reason given'
}

/** One group of people sharing a status and reason, for the summary. */
export interface ReasonGroup {
  readonly status: Exclude<RosterEmailStatus, 'sent'>
  readonly reason: string
  readonly text: string
  readonly participantIds: readonly string[]
}

/** The result, counted by status, with the skipped and failed people grouped by reason. */
export interface EmailLinksSummary {
  readonly sent: number
  readonly skipped: number
  readonly failed: number
  readonly groups: readonly ReasonGroup[]
}

/** Counts a result by status; groups the skipped and failed people by reason (first-seen order). */
export function summarizeResult(result: RosterEmailResultDto): EmailLinksSummary {
  let sent = 0
  let skipped = 0
  let failed = 0
  const groups = new Map<string, { status: 'skipped' | 'failed', reason: string, ids: string[] }>()

  for (const item of result.results) {
    if (item.status === 'sent') {
      sent += 1
      continue
    }
    if (item.status === 'skipped') skipped += 1
    else failed += 1

    const reason = item.reason ?? ''
    const key = `${item.status}:${reason}`
    const group = groups.get(key) ?? { status: item.status, reason, ids: [] }
    group.ids.push(item.participantId)
    groups.set(key, group)
  }

  return {
    sent,
    skipped,
    failed,
    groups: [...groups.values()].map(group => ({
      status: group.status,
      reason: group.reason,
      text: reasonText(group.reason === '' ? undefined : group.reason),
      participantIds: group.ids,
    })),
  }
}

/** "1 person" / "3 people". */
export function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
}
