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
 *   (`CardSheetPreview`), which fetches `POST /staff/roster/cards` for exactly those people
 *   (`{ participantIds }`; none selected = the explicit `{ all: true }`). The button owns
 *   only "is the preview open, and for which people"; fetching, the dialog and the sheet
 *   are the preview's.
 *
 * THE SELECTION IS SNAPSHOTTED AT CLICK. The preview prints the people who were selected
 * when staff pressed the button, not whoever the roster later shows as selected: the
 * roster is inert behind the open dialog, so nothing can change it, but a snapshot makes
 * the sheet independent of re-renders in the slot. Blank and repeated ids are dropped from
 * the count and the snapshot. Only an EMPTY selection means "everyone": a selection that
 * holds ids but no usable one disables the button instead of quietly printing everybody.
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
import { printCardsLabel, usableIds } from './cardFormat'

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

  // Blank and repeated ids do not count. An EMPTY selection means "everyone eligible"; a
  // non-empty one that holds nothing usable must never be widened to that, so it is disabled.
  const usable = usableIds(selection)
  const nothingUsable = selection.length > 0 && usable.length === 0
  const isOpen = openFor !== null

  const open = useCallback(() => setOpenFor(usableIds(selection)), [selection])
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
        disabled={nothingUsable}
        startIcon={<FontAwesomeIcon icon={faPrint} />}
        onClick={open}
      >
        {printCardsLabel(selection)}
      </CobraSecondaryButton>
      {openFor !== null && <CardSheetPreview participantIds={openFor} onClose={close} />}
    </>
  )
}
