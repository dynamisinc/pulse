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
 * YIELDS TO ANY OTHER MODAL (Gate-1 H-1). The shell's Pause / EndEx / break-fiction
 * overlay (`participant-shell`'s `useOverlayFocusTrap`) can mount while the viewer
 * is open and must win — it paints above the viewer. Every handler here returns
 * early when focus is inside a different `[aria-modal="true"]` element
 * (`core/a11y/otherModal`), and the shell's trap applies the same rule, so the two
 * can never ping-pong focus (that loop overflowed the stack and left focus under the
 * overlay). A viewer that opens while another modal already holds focus does not
 * steal it, and does not take focus back from it when it closes.
 *
 * Mirrors `participant-shell`'s `useOverlayFocusTrap` (kept separate: that hook
 * restores only the previously-focused element and is private to the shell).
 * Participant world, behaviour only — no UI.
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { isInsideOtherModal } from '@/core/a11y/otherModal'

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

    // Do not steal focus from another modal that already holds it (e.g. the shell overlay).
    if (!isInsideOtherModal(document.activeElement, container)) container.focus()

    function handleFocusIn(event: FocusEvent): void {
      const target = event.target
      if (container === null || !(target instanceof Node) || container.contains(target)) return
      // A focus move into ANOTHER modal belongs to that modal's own trap (H-1).
      if (isInsideOtherModal(target, container)) return
      const [first] = getFocusable(container)
      ;(first ?? container).focus()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || container === null) return
      // Another modal owns the keyboard right now: do not cycle, do not pull focus (H-1).
      if (isInsideOtherModal(document.activeElement, container)) return
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
      if (container !== null && isInsideOtherModal(document.activeElement, container)) return
      const preferred = returnTargetRef.current
      if (preferred !== null && preferred.isConnected) preferred.focus()
      else if (openedFrom !== null && openedFrom.isConnected) openedFrom.focus()
    }
  }, [containerRef])
}
