/**
 * features/participantAdmin/cards/PrintCardsButton.tsx
 * ---------------------------------------------------------------------------
 * The entry point of the printable card sheet (easy-login story 12; COR-017 in part:
 * handing out credentials at StartEx). The orchestrator mounts it into the roster
 * screen's `renderCardsAction` slot:
 *
 *     renderCardsAction={selection => <PrintCardsButton selection={selection} />}
 *
 * WHAT IT DOES
 *   Renders a COBRA button that reads "Print cards (N)" for N selected people, or
 *   "Print all cards" when the selection is empty. Activating it opens the preview
 *   (`CardSheetPreview`), which fetches `GET /staff/roster/cards` for exactly those people
 *   (none selected = every eligible participant). The button owns only "is the preview
 *   open, and for which people"; fetching, the dialog and the sheet are the preview's.
 *
 * THE SELECTION IS SNAPSHOTTED AT CLICK. The preview prints the people who were selected
 * when staff pressed the button, not whoever the roster later shows as selected: the
 * roster is inert behind the open dialog, so nothing can change it, but a snapshot makes
 * the sheet independent of re-renders in the slot.
 *
 * FOCUS. When the preview closes, focus returns to this button (an effect keyed on the
 * open state, so it also works in browsers that do not focus a button on click and it
 * runs after the preview has lifted its `inert` marking).
 *
 * World: STAFF. COBRA button, FontAwesome icon, MUI `sx` only where MUI is used. The
 * printed card itself is the neutral artifact in `Card.tsx`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPrint } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import { CardSheetPreview } from './CardSheetPreview'
import { printCardsLabel } from './cardFormat'

export interface PrintCardsButtonProps {
  /**
   * The selected participants' account ids (`RosterEntryDto.id`).
   * Empty = print everyone eligible.
   */
  selection: readonly string[]
}

export function PrintCardsButton({ selection }: PrintCardsButtonProps) {
  // `null` = closed; otherwise the ids the preview was opened for.
  const [openFor, setOpenFor] = useState<readonly string[] | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  const count = new Set(selection).size
  const isOpen = openFor !== null

  const open = useCallback(() => setOpenFor([...new Set(selection)]), [selection])
  const close = useCallback(() => setOpenFor(null), [])

  // Return focus to the button once the preview has closed.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      buttonRef.current?.focus()
    }
  }, [isOpen])

  return (
    <>
      <CobraSecondaryButton
        ref={buttonRef}
        aria-haspopup="dialog"
        startIcon={<FontAwesomeIcon icon={faPrint} />}
        onClick={open}
      >
        {printCardsLabel(count)}
      </CobraSecondaryButton>
      {openFor !== null && <CardSheetPreview participantIds={openFor} onClose={close} />}
    </>
  )
}
