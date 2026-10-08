/**
 * features/controller/runSheet/useStatusAnnouncer.ts
 * ---------------------------------------------------------------------------
 * Turns CHANGES in the run sheet into one short sentence for a POLITE live region
 * (inject-queue story 07, AC "Keyboard (NFR-001)": "Status changes announce through
 * a polite live region"). STAFF world.
 *
 * WHAT IS ANNOUNCED, AND WHAT IS NOT
 *   - a status change ("Boil-water advisory: Fired", "Pile-on: Firing 1/6") — whether
 *     it was this controller's press or another controller's, seen on the next poll;
 *   - an item added or removed by someone else;
 *   - NOT a burst's n/m ticking forward inside `firing` (every ~3 s for a minute is
 *     exactly the thrash a live region must avoid — the row still shows it live);
 *   - NOT the first load: the initial population is silent, only later changes speak.
 *
 * Several changes in one poll are joined into one sentence (capped at three, then
 * "and N more") so a screen reader is never handed a paragraph.
 */

import { useEffect, useRef, useState } from 'react'
import { statusText } from './injectRules'
import type { InjectItemDto, InjectStatus } from './types'

interface Snapshot {
  readonly title: string
  readonly status: InjectStatus
}

const MAX_LINES = 3

/** Pure: the announcement lines for `items` relative to the previous snapshot. */
export function describeChanges(
  previous: ReadonlyMap<string, Snapshot>,
  items: readonly InjectItemDto[],
): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    seen.add(item.id)
    const before = previous.get(item.id)
    if (!before) lines.push(`Added: ${item.title}`)
    else if (before.status !== item.status) lines.push(`${item.title}: ${statusText(item)}`)
  }
  for (const [id, before] of previous) if (!seen.has(id)) lines.push(`Removed: ${before.title}`)
  return lines
}

function snapshotOf(items: readonly InjectItemDto[]): Map<string, Snapshot> {
  return new Map(items.map(item => [item.id, { title: item.title, status: item.status }]))
}

/**
 * Returns the latest announcement ('' until something changes). `ready` must be
 * false until the first read has landed so the initial list is not announced.
 */
export function useStatusAnnouncer(items: readonly InjectItemDto[], ready: boolean): string {
  const previous = useRef<Map<string, Snapshot> | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!ready) return
    const before = previous.current
    previous.current = snapshotOf(items)
    if (before === null) return
    const lines = describeChanges(before, items)
    if (lines.length === 0) return
    const shown = lines.slice(0, MAX_LINES)
    const extra = lines.length - shown.length
    setMessage(extra > 0 ? `${shown.join('. ')}. And ${extra} more changes` : shown.join('. '))
  }, [items, ready])

  return message
}
