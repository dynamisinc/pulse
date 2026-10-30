/**
 * features/channels/primitives/announcer/LiveRegionAnnouncer.tsx
 * ---------------------------------------------------------------------------
 * The ONE polite live region a channel page mounts for content arrivals
 * (channels-foundation 14; NFR-001, FC-9 rule 9).
 *
 *  - `arrivals` is a running count the page increments as stories arrive (for example
 *    `newItems.length` since the page mounted). The component announces the DELTA as
 *    "N new stories", at most once per 5 s (`arrivalCoalescer.ts`), so a 120-per-minute
 *    burst becomes one sentence every 5 s instead of a stream of interruptions.
 *  - Always `aria-live="polite"`; there is deliberately no assertive mode. Emergency
 *    alerts are NOT announced here: the shell's alert bar owns that (assertive) region.
 *  - Text only and visually hidden, so nothing it says depends on colour.
 *  - A count that goes DOWN (the page reset its list) is a new baseline, never an
 *    announcement.
 *
 * Participant world: CSS Module, no COBRA, no MUI.
 */

import { useEffect, useRef, useState } from 'react'
import { arrivalMessage, createArrivalCoalescer, type ArrivalCoalescer } from './arrivalCoalescer'
import styles from './LiveRegionAnnouncer.module.css'

export interface LiveRegionAnnouncerProps {
  /** Running count of arrivals since the page mounted; the delta is announced. */
  readonly arrivals: number
  /** The arriving item's noun. Default "story" / "stories". */
  readonly noun?: { readonly one: string; readonly other: string }
}

const DEFAULT_NOUN = { one: 'story', other: 'stories' } as const

export function LiveRegionAnnouncer({ arrivals, noun = DEFAULT_NOUN }: LiveRegionAnnouncerProps) {
  const [message, setMessage] = useState('')
  const baseline = useRef(arrivals)
  const coalescer = useRef<ArrivalCoalescer | null>(null)
  const nounRef = useRef(noun)

  useEffect(() => {
    nounRef.current = noun
  })

  useEffect(() => {
    let alternate = false
    const created = createArrivalCoalescer(count => {
      // Screen readers skip a repeat of identical text: alternate a trailing no-break space
      // so a second "2 new stories" is still announced.
      alternate = !alternate
      setMessage(`${arrivalMessage(count, nounRef.current)}${alternate ? '' : ' '}`)
    })
    coalescer.current = created
    return () => {
      created.dispose()
      coalescer.current = null
    }
  }, [])

  useEffect(() => {
    const delta = arrivals - baseline.current
    baseline.current = arrivals
    if (delta > 0) coalescer.current?.add(delta)
  }, [arrivals])

  return (
    <div
      className={styles.srOnly}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-region-announcer"
    >
      {message}
    </div>
  )
}
