/**
 * features/participantAdmin/cards/CardSheetPreview.tsx
 * ---------------------------------------------------------------------------
 * The full-screen card-sheet preview (easy-login story 12): a portal appended to
 * `document.body` (a SIBLING of `#root`) that fetches the cards, shows every card as it
 * will print, and offers Print and Close. Mounted by `PrintCardsButton` ONLY while open.
 *
 * WHY A PORTAL OUTSIDE `#root` (EL-15). The staff shell is a fixed-height,
 * `overflow: hidden` flex column; printing it as it stands prints one screenful. The sheet
 * therefore lives beside `#root`, and `cardSheet.module.css` hides `#root` (and this
 * component's toolbar) under `@media print`, leaving the sheet as ordinary flowing
 * content. While the preview is open this component adds the `sheetOpen` class to `<html>`
 * so those print rules apply ONLY then; with the preview closed, printing the page is
 * untouched. A React portal keeps this subtree inside the React tree, so the COBRA theme
 * from `StaffShellFrame` still reaches the toolbar's buttons.
 *
 * WHAT IS STAFF CHROME AND WHAT IS PAPER
 *   `.screenOnly` (toolbar with Print / Close and the count, the skipped summary, the
 *   "personal sign-in links" banner): staff world, COBRA buttons, MUI `sx` only, hidden in
 *   print. `<CardSheet>` (the cards): the neutral printed artifact. The banner is a
 *   sibling of the sheet, never inside it, so it can never print.
 *
 * THE DIALOG (NFR-001)
 *   `role="dialog"` + `aria-modal` + `aria-labelledby`. On open, focus moves to the dialog
 *   and every other body child is made `inert` (so Tab and screen readers stay inside);
 *   Tab and Shift+Tab wrap between the first and last control; a focus that escapes is
 *   pulled back; Escape closes. On close the inert state is restored and `PrintCardsButton`
 *   returns focus to the button that opened it. The scrolling sheet area is itself a
 *   focusable, named region so a keyboard user can scroll it.
 *
 * STATES. Loading, error (replaces the sheet), empty (everyone was skipped) and loaded.
 * `409` (links not configured), `403` and `401` each get a specific message; anything
 * else gets a generic message and a Try again button. The status line is a polite live
 * region that is mounted from the start, so the result is announced once it lands: the
 * card count and, when people were left out, how many and why ("2 disabled, 1 whose link
 * needs reissue") with the instruction to fix them in the roster and print again.
 *
 * SECRETS. The cards come from `useRosterCards` (no cache, discarded on close). A join
 * URL appears only inside the sheet's DOM, never in this component's text, a title, a
 * toast or a log. Nothing here writes to storage.
 */

import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPrint, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { CardSheet } from './CardSheet'
import { PERSONAL_LINKS_WARNING, summarizeSkipped } from './cardFormat'
import { RosterCardsError, type RosterCardsErrorKind } from './cardsService'
import { useRosterCards } from './useRosterCards'
import styles from './cardSheet.module.css'

export interface CardSheetPreviewProps {
  /**
   * The people to print cards for, snapshotted when the preview opened.
   * Empty = everyone eligible.
   */
  participantIds: readonly string[]
  /** Closes the preview (Close button and Escape). The owner unmounts this component. */
  onClose: () => void
}

/** Controls the focus trap cycles through. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** What the replaced-sheet message says for each failure. */
interface ErrorCopy {
  readonly title: string
  readonly body: string
  readonly canRetry: boolean
}

function errorCopy(kind: RosterCardsErrorKind): ErrorCopy {
  switch (kind) {
    case 'notConfigured':
      return {
        title: 'Personal links are not set up on this server',
        body: 'There is no address to build participant links from yet, so cards cannot be ' +
          'printed. Ask an administrator to configure it, then open this again.',
        canRetry: false,
      }
    case 'forbidden':
      return {
        title: 'You do not have access to print cards',
        body: 'Only controllers and planners assigned to this exercise can print participant cards.',
        canRetry: false,
      }
    case 'unauthorized':
      return {
        title: 'Your staff session has ended',
        body: 'Sign in again, then print the cards.',
        canRetry: false,
      }
    default:
      return {
        title: 'The cards could not be loaded',
        body: 'Check your connection and try again.',
        canRetry: true,
      }
  }
}

/**
 * Dialog mechanics for the open preview: the print-scoping class on <html>, `inert` on every
 * other body child, initial focus, the focus pull-back, and Escape. All undone on cleanup.
 */
function useOpenPreviewEffects(
  overlayRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const overlay = overlayRef.current
    if (overlay === null) return undefined

    // Scope the @media print rules to "the preview is open".
    const html = document.documentElement
    html.classList.add(styles.sheetOpen ?? 'sheetOpen')

    // Keep focus and assistive tech inside the dialog: make every OTHER body child inert,
    // remembering which ones we changed so cleanup restores exactly those.
    const madeInert: Element[] = []
    for (const child of Array.from(document.body.children)) {
      if (child === overlay || child.hasAttribute('inert')) continue
      if (['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) continue
      child.setAttribute('inert', '')
      madeInert.push(child)
    }

    overlay.focus()

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !overlay.contains(event.target)) overlay.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      for (const element of madeInert) element.removeAttribute('inert')
      html.classList.remove(styles.sheetOpen ?? 'sheetOpen')
    }
  }, [overlayRef])
}

export function CardSheetPreview({ participantIds, onClose }: CardSheetPreviewProps) {
  const titleId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const query = useRosterCards(participantIds)
  useOpenPreviewEffects(overlayRef, onClose)

  const data = query.data
  const cards = data?.cards ?? []
  const skipped = summarizeSkipped(data?.skipped ?? [])
  const canPrint = data !== undefined && cards.length > 0

  // Tab / Shift+Tab wrap inside the dialog.
  const trapTab = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const overlay = overlayRef.current
    if (overlay === null) return
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) {
      event.preventDefault()
      overlay.focus()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === overlay)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  let statusText: string
  if (query.isPending) statusText = 'Loading cards...'
  else if (query.isError) statusText = 'The cards could not be loaded.'
  else statusText = `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} ready to print`

  let stage: React.ReactNode
  if (query.isPending) {
    stage = (
      <div className={styles.state} data-testid="card-sheet-loading">
        <p>Loading cards...</p>
      </div>
    )
  } else if (query.isError) {
    const kind = query.error instanceof RosterCardsError ? query.error.kind : 'unavailable'
    const copy = errorCopy(kind)
    stage = (
      <div className={styles.state} role="alert" data-testid="card-sheet-error">
        <h3 className={styles.stateTitle}>{copy.title}</h3>
        <p>{copy.body}</p>
        {copy.canRetry && (
          <p>
            <CobraSecondaryButton onClick={() => { void query.refetch() }}>
              Try again
            </CobraSecondaryButton>
          </p>
        )}
      </div>
    )
  } else if (data !== undefined && cards.length === 0) {
    stage = (
      <div className={styles.state} data-testid="card-sheet-empty">
        <h3 className={styles.stateTitle}>There are no cards to print</h3>
        <p>None of the people requested has an active personal link.</p>
      </div>
    )
  } else if (data !== undefined) {
    stage = <CardSheet cards={cards} exerciseName={data.exerciseName} />
  } else {
    stage = null
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={trapTab}
      data-testid="card-sheet-preview"
    >
      <div className={styles.screenOnly} data-testid="card-sheet-screen-only">
        <Box
          component="header"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 2,
            padding: CobraStyles.Padding.DialogContent,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flex: '1 1 20rem', minWidth: 0 }}>
            <Typography id={titleId} component="h2" variant="h6" sx={{ fontWeight: 700 }}>
              Print cards
            </Typography>
            <Box
              role="status"
              aria-live="polite"
              data-testid="card-sheet-status"
              sx={{ fontSize: '0.875rem', color: 'text.primary' }}
            >
              <div>{statusText}</div>
              {skipped.total > 0 && (
                <Box data-testid="card-sheet-skipped" sx={{ marginTop: 0.5 }}>
                  <div>
                    {skipped.total === 1
                      ? '1 person was left out of this sheet:'
                      : `${skipped.total} people were left out of this sheet:`}
                  </div>
                  <Box component="ul" sx={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {skipped.lines.map(line => <li key={line}>{line}</li>)}
                  </Box>
                  <div>Fix them in the roster, then print again.</div>
                </Box>
              )}
            </Box>
          </Box>

          <Box role="group" aria-label="Card sheet actions" sx={{ display: 'flex', gap: 1 }}>
            <CobraPrimaryButton
              disabled={!canPrint}
              startIcon={<FontAwesomeIcon icon={faPrint} />}
              onClick={() => window.print()}
            >
              Print
            </CobraPrimaryButton>
            <CobraSecondaryButton
              startIcon={<FontAwesomeIcon icon={faXmark} />}
              onClick={onClose}
            >
              Close
            </CobraSecondaryButton>
          </Box>
        </Box>

        <Box
          data-testid="card-sheet-banner"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            padding: '8px 15px',
            bgcolor: 'notifications.warning',
            color: 'text.primary',
            borderBottom: '1px solid',
            borderColor: 'notifications.warningText',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{PERSONAL_LINKS_WARNING}</span>
        </Box>
      </div>

      <div
        className={styles.stage}
        role="region"
        aria-label="Printable cards"
        tabIndex={0}
        data-testid="card-sheet-stage"
      >
        {stage}
      </div>
    </div>,
    document.body,
  )
}
