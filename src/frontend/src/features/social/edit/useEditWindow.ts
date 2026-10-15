/**
 * features/social/edit/useEditWindow.ts
 * ---------------------------------------------------------------------------
 * The client-side edit-window countdown (demo-feedback story 20; DF-29, COR-053). The server
 * sends `viewer.editableForSeconds` - a DURATION - and is authoritative; the client counts it
 * down from the moment the post was READ and stops offering Edit at 0 without a reload. No
 * clock value is ever rendered: the hook answers only "is Edit still offered".
 *
 * One timeout for the whole remaining window (not a ticking interval): no re-render until it
 * fires. A fresh read with a new `seconds` value restarts it; `0` / absent is closed from the
 * start. The timer is cleared on unmount and on change.
 */

import { useEffect, useState } from 'react'

export function useEditWindow(seconds: number | undefined): boolean {
  // The `seconds` value whose window has run out; a different value is a different window.
  const [expiredFor, setExpiredFor] = useState<number | null>(null)
  const offered = seconds !== undefined && seconds > 0

  useEffect(() => {
    if (!offered || seconds === undefined) return undefined
    const timer = setTimeout(() => setExpiredFor(seconds), seconds * 1000)
    return () => clearTimeout(timer)
  }, [offered, seconds])

  return offered && expiredFor !== seconds
}
