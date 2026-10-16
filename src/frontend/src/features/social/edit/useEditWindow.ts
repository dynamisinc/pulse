/**
 * features/social/edit/useEditWindow.ts
 * ---------------------------------------------------------------------------
 * The client-side edit-window countdown (demo-feedback story 20; DF-29, COR-053). The server
 * sends `viewer.editableForSeconds` - a DURATION - and is authoritative; the client counts it
 * down from the moment the post was READ and stops offering Edit at 0 without a reload. No
 * clock value is ever rendered: the hook answers only "is Edit still offered".
 *
 * The countdown starts at the FIRST read of a post's seconds value (`editWindowClock`), so a
 * remount never grants a fresh window. One timeout for the whole remaining window (not a
 * ticking interval): no re-render until it fires. A fresh read with a new `seconds` value
 * restarts it; `0` / absent is closed from the start. The timer is cleared on unmount/change.
 */

import { useEffect, useMemo, useState } from 'react'
import { remainingWindowMs } from './editWindowClock'

export function useEditWindow(postId: string, seconds: number | undefined): boolean {
  // The window (post + seconds value) that has run out; a different value is a different window.
  const [expiredKey, setExpiredKey] = useState<string | null>(null)
  const key = `${postId}:${seconds ?? 'none'}`
  // Counted from the FIRST time this value was read (a remount does not restart it).
  const remainingMs = useMemo(() => remainingWindowMs(postId, seconds), [postId, seconds])

  useEffect(() => {
    if (remainingMs <= 0) return undefined
    const timer = setTimeout(() => setExpiredKey(key), remainingMs)
    return () => clearTimeout(timer)
  }, [remainingMs, key])

  return remainingMs > 0 && expiredKey !== key
}
