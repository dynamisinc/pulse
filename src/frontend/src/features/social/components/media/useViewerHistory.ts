/**
 * features/social/components/media/useViewerHistory.ts
 * ---------------------------------------------------------------------------
 * "Back closes the viewer" (mobile-tablet story 04; NFR-001). On a phone the
 * system back gesture / button is how people leave a full-screen layer; without
 * this it would leave the whole page instead.
 *
 *  - On mount the hook pushes ONE history entry (same URL, a marker in the state,
 *    the router's own state preserved) so there is an entry for "back" to consume.
 *  - A `popstate` while the viewer owns that entry closes it (`onClose`); the page
 *    stays where it is. Focus returns to the opening tile through `useFocusTrap`.
 *  - Closing any OTHER way (Close, Escape, backdrop) goes through the returned
 *    `requestClose`, which pops the entry with `history.back()` first, so the
 *    history stack is left as it was. A flag guards against a double pop (a Back
 *    that races a Close, or two quick Closes).
 *  - Already marked on mount (React StrictMode's remount): reuse the entry, push
 *    no second one. Unmounted by the owner while still owning it (route change):
 *    nothing is popped, so the new navigation is never fought.
 *
 * Participant world, behaviour only, no UI.
 */

import { useCallback, useEffect, useRef } from 'react'

const MARKER = 'pulseMediaViewer'

function isMarked(state: unknown): boolean {
  return typeof state === 'object' && state !== null && MARKER in state
}

/** Returns `requestClose`: use it for every close that is not the browser's Back. */
export function useViewerHistory(onClose: () => void): () => void {
  const onCloseRef = useRef(onClose)
  const ownsEntryRef = useRef(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isMarked(window.history.state)) {
      const previous: unknown = window.history.state
      const base = typeof previous === 'object' && previous !== null ? previous : {}
      window.history.pushState({ ...base, [MARKER]: true }, '')
    }
    ownsEntryRef.current = true

    function handlePopState(): void {
      if (!ownsEntryRef.current) return
      ownsEntryRef.current = false
      onCloseRef.current()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return useCallback(() => {
    if (ownsEntryRef.current) {
      ownsEntryRef.current = false
      window.history.back()
    }
    onCloseRef.current()
  }, [])
}
