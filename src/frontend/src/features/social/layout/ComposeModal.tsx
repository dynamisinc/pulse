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
 *  - ESC CLOSES, as does the Close button and a press on the dim backdrop -- but
 *    NOT silently over a draft: with text (or attachment chips) in the box, those
 *    three first ask "Discard this draft?" inline (Keep editing is focused and is
 *    what Esc picks). A successful post closes with no question (the draft is
 *    gone), and so does the HOST closing the dialog because the route changed.
 *  - FOCUS COMES BACK: on close, focus returns to the control that opened it --
 *    `returnFocusRef` (the Post button) when the host supplies it, else whatever
 *    was focused when the dialog opened. Some browsers (Safari) do not focus a
 *    button on click, so "whatever was focused" alone is not reliable; the ref is.
 *    It only does so if focus has actually been LOST (it fell to <body> when the
 *    dialog left the DOM): if something else already took it -- the route-change
 *    rule moved it to the new page's heading -- it is left there.
 *  - The trap and the initial focus consider only controls that are really
 *    RENDERED: not inside `[hidden]` or an `inert` subtree, and not
 *    `checkVisibility()`-false (a `display:none` / `visibility:hidden` input such
 *    as a hidden file picker). A Tab stop on something unrendered would let focus
 *    escape the dialog.
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
  useState,
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

/**
 * Whether `element` is actually rendered and operable: not within `[hidden]` or
 * `inert`, and (where the browser supports `checkVisibility()`) not
 * `display:none` / `visibility:hidden` / `content-visibility` hidden. Where
 * `checkVisibility` is absent (older engines, jsdom) the structural checks stand
 * alone.
 */
function isRendered(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert]') !== null) return false
  return element.checkVisibility?.({ visibilityProperty: true }) !== false
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isRendered)
}

/** Whether the composer inside `dialog` holds text or attachment chips worth keeping. */
function hasUnsentDraft(dialog: HTMLElement): boolean {
  const textBox = dialog.querySelector<HTMLTextAreaElement>('textarea')
  if (textBox !== null && textBox.value.trim() !== '') return true
  return dialog.querySelector('[data-testid="composer-media"] li') !== null
}

export function ComposeModal({ onClose, returnFocusRef }: ComposeModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  // True while the inline "Discard this draft?" question is showing.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

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
      // Restore only if focus was lost with the dialog (fell to <body>); never steal it
      // back from something that took it deliberately, e.g. the new route's heading.
      const lost = document.activeElement === null || document.activeElement === document.body
      if (lost && opener !== null && opener.isConnected) opener.focus()
    }
  }, [returnFocusRef])

  // Put focus on the SAFE choice when the question appears.
  useEffect(() => {
    if (confirmingDiscard) keepEditingRef.current?.focus()
  }, [confirmingDiscard])

  /** Esc / Close / backdrop: close now, or ask first if there is a draft to lose. */
  const requestClose = () => {
    if (confirmingDiscard) return
    const dialog = dialogRef.current
    if (dialog !== null && hasUnsentDraft(dialog)) setConfirmingDiscard(true)
    else onClose()
  }

  const keepEditing = () => {
    setConfirmingDiscard(false)
    dialogRef.current?.querySelector<HTMLElement>('textarea')?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // Esc on the question means "never mind", not "discard".
      if (confirmingDiscard) keepEditing()
      else requestClose()
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
    if (event.target === event.currentTarget) requestClose()
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
          <button type="button" className={styles.close} aria-label="Close" onClick={requestClose}>
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
          <h2 id={titleId} className={styles.title}>New post</h2>
        </div>

        {confirmingDiscard && (
          <div className={styles.confirm} data-testid="compose-discard-confirm">
            <p className={styles.confirmText} role="alert">Discard this draft?</p>
            <div className={styles.confirmActions}>
              <button
                ref={keepEditingRef}
                type="button"
                className={styles.keepEditing}
                onClick={keepEditing}
              >
                Keep editing
              </button>
              <button type="button" className={styles.discard} onClick={onClose}>
                Discard
              </button>
            </div>
          </div>
        )}

        {/* `inert` while the question shows: the draft cannot change under it. */}
        <div inert={confirmingDiscard}>
          <Composer onPosted={onClose} />
        </div>
      </div>
    </div>
  )
}
