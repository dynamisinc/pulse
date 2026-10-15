/**
 * features/social/edit/EditDialogShell.tsx
 * ---------------------------------------------------------------------------
 * The in-skin modal frame both participant edit dialogs share (demo-feedback story 20):
 * a portaled backdrop + `role="dialog" aria-modal` panel with a labelled title and a Close
 * button, Escape to cancel, a focus trap (`useFocusTrap`, the same one the media viewer uses,
 * which stands aside for the shell's overlay via `modalPriority`) and focus returned to the
 * control that opened it (`returnFocusTo`, the Edit / Edited button).
 *
 * Portaled to <body>: a post card must never trap a fixed dialog in its own stacking context;
 * the palette therefore lives on the backdrop (`EditDialogs.module.css`). Pointer and key events
 * are stopped at the panel so they can never reach a card's open handler through React's portal
 * bubbling (Tab alone is let through: the document-level focus trap needs it). Participant world
 * only (no COBRA, no MUI); the staff history dialog is its own file.
 */

import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { useFocusTrap } from '../components/media/useFocusTrap'
import styles from './EditDialogs.module.css'

export interface EditDialogShellProps {
  readonly title: string
  /** `data-testid` for the dialog panel. */
  readonly testId: string
  /** Escape, Close or a backdrop press. */
  readonly onClose: () => void
  /** The control to return focus to on close. */
  readonly returnFocusTo: HTMLElement | null
  readonly children: ReactNode
}

export function EditDialogShell({
  title,
  testId,
  onClose,
  returnFocusTo,
  children,
}: EditDialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(dialogRef, { returnFocusTo })

  // Focus into the first field (not the Close button) once the trap has placed it on the panel.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    const field = dialog.querySelector<HTMLElement>('textarea')
    if (field !== null && dialog.contains(document.activeElement)) field.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Tab must reach the document-level focus trap, so it is the one key not stopped here.
    if (event.key !== 'Tab') event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.target === event.currentTarget) onClose()
  }

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid={`${testId}-backdrop`}
      onMouseDown={handleBackdropMouseDown}
      onClick={event => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
          <h2 id={titleId} className={styles.title}>{title}</h2>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
