/**
 * features/controller/runSheet/MarkFiredAction.tsx
 * ---------------------------------------------------------------------------
 * The run sheet row's "Mark fired" action (demo-feedback story 23, DF-36): records
 * an item as fired WITHOUT posting anything — the inject was delivered outside
 * Pulse, or posted by hand from the persona composer. STAFF world: a COBRA row
 * button (FontAwesome icon + text) and a COBRA confirm dialog.
 *
 * It cannot be undone, so it always asks first: "Mark as fired without posting?
 * This can't be undone." Cancel / Esc change nothing; the confirm button takes
 * focus (Enter confirms). The row offers it only on pending / held / failed rows
 * and only to a controller (`useCanControl()`); the server enforces both.
 *
 * KEYBOARD. The dialog is portalled, but React events still bubble up the
 * COMPONENT tree into the run sheet's shortcut handler, so plain key presses are
 * stopped at the dialog (as the import dialog does) — typing Enter here must never
 * also act on the selected row.
 */

import { useId, useState } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClipboardCheck } from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { CobraLinkButton, CobraPrimaryButton } from '@/theme/styledComponents'
import { RunSheetButton } from './RunSheetButtons'
import { MESSAGES } from './injectMessages'

export interface MarkFiredActionProps {
  /** The item's title, for the accessible names. */
  readonly title: string
  /** An action on the row is in flight. */
  readonly disabled: boolean
  /** Called once the controller confirms. */
  readonly onConfirm: () => void
}

export function MarkFiredAction({ title, disabled, onConfirm }: MarkFiredActionProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const bodyId = useId()

  const confirm = (): void => {
    setOpen(false)
    onConfirm()
  }

  return (
    <>
      <RunSheetButton
        icon={faClipboardCheck}
        label="Mark fired"
        ariaLabel={`Mark fired ${title}`}
        disabled={disabled}
        testId="row-mark-fired"
        onClick={() => setOpen(true)}
      />
      {/* Mounted only while open: closing removes it at once (no exit transition left behind). */}
      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          onKeyDown={event => {
            if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation()
          }}
          maxWidth="xs"
          fullWidth
          transitionDuration={0}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          data-testid="mark-fired-dialog"
        >
          <DialogTitle
            id={titleId}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 18, fontWeight: 700 }}
          >
            <FontAwesomeIcon icon={faClipboardCheck} aria-hidden />
            {`Mark "${title}" fired`}
          </DialogTitle>
          <DialogContent sx={{ padding: CobraStyles.Padding.DialogContent }}>
            <Typography id={bodyId} variant="body2">
              {MESSAGES.markFiredConfirm}
            </Typography>
          </DialogContent>
          <DialogActions sx={{ padding: CobraStyles.Padding.DialogContent, gap: 1 }}>
            <CobraLinkButton onClick={() => setOpen(false)} data-testid="mark-fired-cancel">
              Cancel
            </CobraLinkButton>
            <CobraPrimaryButton autoFocus onClick={confirm} data-testid="mark-fired-confirm">
              Mark fired
            </CobraPrimaryButton>
          </DialogActions>
        </Dialog>
      ) : null}
    </>
  )
}
