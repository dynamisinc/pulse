/**
 * features/social/components/media/useFocusTrap.ts
 * ---------------------------------------------------------------------------
 * The modal viewer's focus management (demo-polish F2; NFR-001): while the
 * viewer is mounted, keyboard focus cannot leave it, and when it unmounts focus
 * goes back to where the user came from.
 *
 *  - On mount: remembers the element to return to, then focuses the container
 *    (`tabIndex={-1}`) so assistive tech announces the dialog's name at once.
 *  - A `focusin` listener on `document` pulls focus back inside the instant it
 *    lands anywhere else; a `keydown` listener cycles Tab / Shift+Tab among the
 *    container's own focusable descendants (recomputed on every Tab, because the
 *    viewer's controls change as the user pages through).
 *  - On unmount: focuses `returnFocusTo` (the thumbnail the user activated) if it
 *    is still in the document, else whatever had focus when the viewer opened.
 *    The explicit target matters: Safari does not focus a `<button>` on click, so
 *    `document.activeElement` at open time is `<body>` there.
 *
 * STANDS ASIDE COMPLETELY WHILE ANOTHER MODAL IS MOUNTED (Gate-1 H-1 / M-A). The
 * shell's Pause / EndEx / break-fiction overlay (`participant-shell`'s
 * `useOverlayFocusTrap`) can mount while the viewer is open and ALWAYS wins — it paints
 * above the viewer. Priority is ONE-WAY (`core/a11y/modalPriority`): while any other
 * `[aria-modal="true"]` element (not inside the viewer, not hosting it) is in the
 * document, this trap does nothing — no focus on mount, no pull-back, no Tab cycling, no
 * focus restore on unmount — and the overlay's own trap pulls focus back from the viewer
 * if it ever lands there. When the overlay clears the shell hands focus back to the
 * viewer and this trap resumes. (The first cut only backed off for a focus target that
 * was already inside the other modal, which let focus sit in the viewer UNDER the
 * overlay; that loop is also what overflowed the stack originally.)
 *
 * Mirrors `participant-shell`'s `useOverlayFocusTrap` (kept separate: that hook
 * restores only the previously-focused element and is private to the shell).
 * Participant world, behaviour only — no UI.
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { hasOtherModalMounted } from '@/core/a11y/modalPriority'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

export interface UseFocusTrapOptions {
  /** Where focus returns on unmount (the thumbnail that opened the viewer). */
  readonly returnFocusTo?: HTMLElement | null
}

/** Traps focus inside `containerRef`'s element for as long as the calling component is mounted. */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { returnFocusTo = null }: UseFocusTrapOptions = {},
): void {
  // The latest target, read at unmount (a ref, so a re-render never re-runs the trap effect).
  const returnTargetRef = useRef<HTMLElement | null>(returnFocusTo)
  useEffect(() => {
    returnTargetRef.current = returnFocusTo
  }, [returnFocusTo])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined

    const openedFrom = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    // Another modal (e.g. the shell overlay) is up: it owns focus; do not take any.
    if (!hasOtherModalMounted(container)) container.focus()

    function handleFocusIn(event: FocusEvent): void {
      const target = event.target
      if (container === null || !(target instanceof Node) || container.contains(target)) return
      // Another modal is mounted: stand aside completely (H-1 / M-A).
      if (hasOtherModalMounted(container)) return
      const [first] = getFocusable(container)
      ;(first ?? container).focus()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || container === null) return
      // Another modal owns the keyboard right now: do not cycle, do not pull focus (H-1 / M-A).
      if (hasOtherModalMounted(container)) return
      const focusable = getFocusable(container)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (first === undefined || last === undefined) {
        event.preventDefault()
        container.focus()
        return
      }
      const active = document.activeElement
      if (!container.contains(active) || active === container) {
        // Focus is on the dialog shell itself (or has drifted): enter the ring.
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('keydown', handleKeyDown)
      // Never take focus back from another modal that is on top of us now.
      if (container !== null && hasOtherModalMounted(container)) return
      const preferred = returnTargetRef.current
      if (preferred !== null && preferred.isConnected) preferred.focus()
      else if (openedFrom !== null && openedFrom.isConnected) openedFrom.focus()
    }
  }, [containerRef])
}
