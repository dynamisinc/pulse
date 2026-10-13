/**
 * features/participantAdmin/cards/cardFormat.ts
 * ---------------------------------------------------------------------------
 * Small pure helpers for the printed card (easy-login story 12): the page size, the
 * "agency · role" line, and the site origin used by the card's help line. Kept out of
 * the `.tsx` files so those export only components (fast refresh) and so these rules are
 * unit-testable without rendering.
 *
 * World-neutral. No React, no theme. Nothing here touches the clock: a card shows no time
 * (COR-053 is not in play).
 */

/** Cards per printed US Letter page: two columns by four rows. Mirrors the CSS grid. */
export const CARDS_PER_PAGE = 8

/**
 * The on-screen banner shown for as long as the preview is open. Exact wording is part of
 * the story; it lives here (not in the component) so tests and the component share it.
 */
export const PERSONAL_LINKS_WARNING =
  'These cards contain personal sign-in links. Hand them out one by one and shred any left over.'

/** The roster button label for `count` selected people ("Print all cards" when none). */
export function printCardsLabel(count: number): string {
  return count > 0 ? `Print cards (${count})` : 'Print all cards'
}

/**
 * A name longer than this prints in a smaller face (`.nameLong`), and longer than
 * {@link XLONG_NAME_LENGTH} in a smaller one still (`.nameXLong`), so a long name wraps
 * instead of being cut. LONG is roughly one line of the large face.
 */
export const LONG_NAME_LENGTH = 24
export const XLONG_NAME_LENGTH = 48

/** The separator between agency and role. */
const AFFILIATION_SEPARATOR = ' · '

/**
 * "Agency · Role" with whichever of the two is present, or `undefined` when neither is
 * (the card then prints no affiliation line at all, not an empty one).
 */
export function affiliationLine(agency?: string, role?: string): string | undefined {
  const parts = [agency, role]
    .map(part => part?.trim() ?? '')
    .filter(part => part.length > 0)
  return parts.length > 0 ? parts.join(AFFILIATION_SEPARATOR) : undefined
}

/**
 * The origin of a join URL (`https://pulse-uat.cobrasoftware.com`), used as `{site}` in
 * the help line so the "No QR?" instruction names the same host the QR points at. Only
 * `http(s)` URLs qualify; anything unparseable or of another scheme (`javascript:`,
 * `data:`) gives `undefined` and the card falls back to a generic sentence. The URL is
 * only ever PARSED here, never navigated to or linked.
 */
export function joinUrlOrigin(joinUrl: string): string | undefined {
  try {
    const url = new URL(joinUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

/** Splits `items` into runs of at most `size` (the printed pages). */
export function paginate<T>(items: readonly T[], size: number = CARDS_PER_PAGE): T[][] {
  const pages: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    pages.push(items.slice(start, start + size))
  }
  return pages
}

/** The order and wording of the skipped summary: one line per reason that occurred. */
const SKIP_REASON_LINES: ReadonlyArray<{
  readonly reason: 'noActiveLink' | 'disabled' | 'tokenUnrecoverable' | 'notFound'
  readonly describe: (count: number) => string
}> = [
  { reason: 'noActiveLink', describe: count => `${count} with no active link` },
  { reason: 'disabled', describe: count => `${count} disabled` },
  { reason: 'tokenUnrecoverable', describe: count => `${count} whose link needs reissue` },
  { reason: 'notFound', describe: count => `${count} not found` },
]

/** How many people were left off the sheet, and a plain-language line per reason. */
export interface SkippedSummary {
  readonly total: number
  readonly lines: readonly string[]
}

/**
 * Summarises `skipped` BY REASON, never by name: the server does not name a skipped
 * person (only their id and why), and an id is no use to a human. Reasons that did not
 * occur are omitted; the order is fixed so the wording is predictable.
 */
export function summarizeSkipped(
  skipped: ReadonlyArray<{ readonly reason: string }>,
): SkippedSummary {
  const lines: string[] = []
  for (const { reason, describe } of SKIP_REASON_LINES) {
    const count = skipped.filter(entry => entry.reason === reason).length
    if (count > 0) lines.push(describe(count))
  }
  return { total: skipped.length, lines }
}
