/**
 * features/controller/report/services/markerLayout.ts
 * ---------------------------------------------------------------------------
 * Pure layout of the numbered inject badges on the activity chart (story 31). No React, no DOM.
 *
 * The chart draws one dashed line per key inject and a small numbered badge (1, 2, 3...) on top.
 * Badges are only a number, but ten injects in adjacent bins would still overprint, so:
 *   1. Markers (sorted left to right, numbered in that order) whose lines are closer than a
 *      badge is wide MERGE into one badge labeled "2-4" (or "2, 3" for a pair); every marker
 *      keeps its own dashed line, and the chart's text key still lists each one.
 *   2. The resulting badges are placed in rows (first fit), a row being a horizontal band;
 *      a badge goes in the lowest row where it clears the previous badge by `gap`.
 * Result: no two badges overlap at any density (see markerLayout.test.ts).
 */

export interface MarkerInput {
  /** Horizontal centre of the marker's dashed line, in chart units. */
  readonly x: number
}

export interface PlacedBadge {
  /** "3", "2, 3" or "2–5". */
  readonly label: string
  /** Centre x of the badge (the mean of its markers' lines). */
  readonly x: number
  /** Full badge width in chart units. */
  readonly width: number
  /** 0 is the row nearest the plot; higher rows sit further up. */
  readonly row: number
  /** 1-based marker numbers the badge stands for. */
  readonly numbers: readonly number[]
}

export interface MarkerLayout {
  readonly badges: readonly PlacedBadge[]
  /** How many rows are used (at least 1 when there are markers, else 0). */
  readonly rows: number
  /** Marker i's (0-based, in the order given) 1-based number: its position left to right. */
  readonly numberOf: readonly number[]
}

export const BADGE_HEIGHT = 14
const MIN_WIDTH = 14
const CHAR_WIDTH = 6.4
const PADDING = 6
/** Clear space kept between two badges in a row. */
const GAP = 2

function badgeWidth(label: string): number {
  return Math.max(MIN_WIDTH, Math.ceil(label.length * CHAR_WIDTH + PADDING))
}

function labelFor(numbers: readonly number[]): string {
  const first = numbers[0] ?? 0
  const last = numbers[numbers.length - 1] ?? first
  if (numbers.length === 1) return String(first)
  return numbers.length === 2 ? `${first}, ${last}` : `${first}–${last}`
}

/**
 * Lays out the badges. `markers` may be in any order; numbers follow left-to-right position.
 * With `bounds`, each badge is kept inside [min, max] BEFORE its row is chosen, so an edge clamp
 * can never make two badges in one row overlap.
 */
export function layoutMarkerBadges(
  markers: readonly MarkerInput[],
  bounds?: { readonly min: number; readonly max: number },
): MarkerLayout {
  const order = markers
    .map((marker, index) => ({ x: marker.x, index }))
    .sort((a, b) => a.x - b.x || a.index - b.index)
  const numberOf: number[] = new Array<number>(markers.length).fill(0)
  order.forEach((entry, position) => {
    numberOf[entry.index] = position + 1
  })

  // 1. Merge neighbours closer than a (single-digit) badge is wide.
  const clusters: { xs: number[]; numbers: number[] }[] = []
  order.forEach((entry, position) => {
    const last = clusters[clusters.length - 1]
    const previousX = last?.xs[last.xs.length - 1]
    if (last !== undefined && previousX !== undefined && entry.x - previousX < MIN_WIDTH + GAP) {
      last.xs.push(entry.x)
      last.numbers.push(position + 1)
    } else {
      clusters.push({ xs: [entry.x], numbers: [position + 1] })
    }
  })

  // 2. First-fit rows by real badge width.
  const rowEnds: number[] = []
  const badges: PlacedBadge[] = clusters.map(cluster => {
    const label = labelFor(cluster.numbers)
    const width = badgeWidth(label)
    const mean = cluster.xs.reduce((sum, value) => sum + value, 0) / cluster.xs.length
    const x = bounds === undefined
      ? mean
      : Math.min(Math.max(mean, bounds.min + width / 2), bounds.max - width / 2)
    const left = x - width / 2
    let row = rowEnds.findIndex(end => left >= end + GAP)
    if (row < 0) {
      row = rowEnds.length
      rowEnds.push(0)
    }
    rowEnds[row] = x + width / 2
    return { label, x, width, row, numbers: cluster.numbers }
  })

  return { badges, rows: rowEnds.length, numberOf }
}
