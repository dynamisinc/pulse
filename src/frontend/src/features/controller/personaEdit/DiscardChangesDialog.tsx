/**
 * features/controller/personaEdit/DiscardChangesDialog.tsx
 * ---------------------------------------------------------------------------
 * "Discard your changes?" — asked when a controller presses Esc on a persona edit
 * dialog that holds unsaved work (demo-polish story 21 / PE-FE Gate-1 L-2). Staff
 * world (COBRA buttons).
 *
 * A dense console makes a stray Esc (or a click that misses) easy, and the draft may
 * include an image the controller just uploaded, so closing silently would throw real
 * work away. The safe answer, "Keep editing", takes focus when this opens (Enter
 * keeps editing); Esc here closes only THIS dialog (it is an MUI modal above the
 * edit dialog, so MUI's modal manager gives it the key). A clean dialog never asks.
 * An explicit Cancel click does not ask either — that is a clear decision.
 */

import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useId } from 'react'
import CobraStyles from '@/theme/CobraStyles'
import { CobraDeleteButton, CobraPrimaryButton } from '@/theme/styledComponents'
import { swallowConsoleChord } from './consoleChords'

export interface DiscardChangesDialogProps {
  readonly open: boolean
  readonly handle: string
  /** Back to the edit dialog, draft intact. Also what Esc and a backdrop click do. */
  readonly onKeepEditing: () => void
  /** Throw the draft away and close the edit dialog. */
  readonly onDiscard: () => void
}

/** Asks whether to discard an unsaved persona edit. */
export function DiscardChangesDialog({
  open,
  handle,
  onKeepEditing,
  onDiscard,
}: DiscardChangesDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  return (
    <Dialog
      open={open}
      onClose={onKeepEditing}
      onKeyDown={event => {
        swallowConsoleChord(event)
      }}
      maxWidth="xs"
      fullWidth
      transitionDuration={0}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <DialogTitle id={titleId} sx={{ fontSize: 18, fontWeight: 700 }}>
        Discard your changes?
      </DialogTitle>
      <DialogContent sx={{ padding: CobraStyles.Padding.DialogContent }}>
        <Typography id={bodyId} variant="body2">
          You have unsaved changes to @{handle}. Closing now throws them away — nothing has
          been sent to participants.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ padding: CobraStyles.Padding.DialogContent, gap: 1 }}>
        <CobraDeleteButton onClick={onDiscard}>Discard changes</CobraDeleteButton>
        <CobraPrimaryButton autoFocus onClick={onKeepEditing}>
          Keep editing
        </CobraPrimaryButton>
      </DialogActions>
    </Dialog>
  )
}
