/**
 * features/social/layout/ComposeModal.tsx
 * ---------------------------------------------------------------------------
 * The nav rail's **Post** button opens the composer in a modal (demo-polish F1;
 * D1 "Composer modal -- 600px overlay"). The modal WRAPS the existing
 * `<Composer onPosted={onClose}>` -- it adds the dialog behavior and nothing else;
 * every composing rule (limit, sanitization, telemetry, read-only guard) is the
 * composer's own.
 *
 * DIALOG BEHAVIOR (NFR-001):
 *  - `role="dialog"` + `aria-modal="true"`, named by its (visually hidden) title.
 *  - FOCUS GOES IN: on open, focus moves to the first focusable control -- the
 *    post text box.
 *  - FOCUS IS TRAPPED: Tab / Shift+Tab wrap inside the dialog. (The host also
 *    marks the rest of the frame `inert` while this is open; the trap is the
 *    belt to that braces, and is what makes the behavior testable in jsdom.)
 *  - ESC CLOSES, as does the Close button and a press on the dim backdrop.
 *  - FOCUS COMES BACK: on close, focus returns to the control that opened it --
 *    `returnFocusRef` (the Post button) when the host supplies it, else whatever
 *    was focused when the dialog opened. Some browsers (Safari) do not focus a
 *    button on click, so "whatever was focused" alone is not reliable; the ref is.
 *
 * AUTO-CLOSE. `onPosted` closes the dialog after a successful publish. In MOCK
 * mode `useComposePost` fires it today. In LIVE mode it does not yet (the post
 * arrives over SignalR instead); F4 makes `onPosted` fire there, which is verified
 * at Gate 2. Until then, live mode closes by Esc / Close like any dialog.
 *
 * It is rendered INLINE (not portalled to `document.body`) so it inherits the
 * channel's token root and the shell's stacking context: it sits above the frame
 * but below the shell's compliance banners and alert bar, which it must never
 * cover. Its backdrop is fixed to the viewport between those banners
 * (`--pulse-chrome-top` / `--pulse-chrome-bottom`).
 *
 * World: participant. CSS Module + FontAwesome only -- no COBRA, no MUI.
 */

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { Composer } from '../components/Composer'
import styles from './ComposeModal.module.css'

export interface ComposeModalProps {
  /** Close the dialog (Esc, Close, backdrop press, or a successful post). */
  onClose: () => void
  /** The control to return focus to on close (the Post button). */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/** Controls a Tab press can land on. Visually hidden inputs are filtered out below. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => element.closest('[hidden]') === null,
  )
}

export function ComposeModal({ onClose, returnFocusRef }: ComposeModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Focus in on open; focus back on close. Runs once per open (the modal is
  // mounted only while open).
  useEffect(() => {
    const active = document.activeElement
    // Captured now (the Post button is mounted for the dialog's whole life), so the
    // cleanup below does not read a ref that may have moved on.
    const opener = returnFocusRef?.current ?? (active instanceof HTMLElement ? active : null)
    const dialog = dialogRef.current
    if (dialog !== null) {
      const [first] = focusableWithin(dialog)
      // Prefer the text box over the Close button, which is first in DOM order.
      const textBox = dialog.querySelector<HTMLElement>('textarea')
      const initial = textBox ?? first ?? dialog
      initial.focus()
    }
    return () => {
      if (opener !== null && opener.isConnected) opener.focus()
    }
  }, [returnFocusRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (dialog === null) return
    const focusable = focusableWithin(dialog)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // Only a press on the dim backdrop itself -- never one that bubbled from the dialog.
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div
      className={styles.backdrop}
      data-testid="compose-backdrop"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="compose-modal"
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
          <h2 id={titleId} className={styles.title}>New post</h2>
        </div>
        <Composer onPosted={onClose} />
      </div>
    </div>
  )
}
