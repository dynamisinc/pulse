/**
 * features/controller/runSheet/ConfirmDialog.tsx
 * ---------------------------------------------------------------------------
 * The run sheet's one CONFIRM step (demo-polish C3, story 19). STAFF world - COBRA
 * buttons, MUI 9 `sx`-only. Used only where an action cannot be taken back or could
 * double-post: deleting a beat, replacing the sheet by an import, firing again a beat
 * whose outcome is unknown, and discarding an unreadable saved sheet. Firing a normal
 * beat is deliberately NOT confirmed - the story is "one key press" and every beat is
 * reviewed when it is authored.
 *
 * SAFE BY DEFAULT: focus lands on Cancel, so an Enter/Space pressed out of habit
 * dismisses the dialog instead of confirming. `Esc` cancels (the dialog's own handler).
 */

import { useId, type ReactNode } from 'react'
import { DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { CobraDeleteButton, CobraLinkButton, CobraPrimaryButton } from '@/theme/styledComponents'
import { StaffDialog } from './StaffDialog'

export interface ConfirmDialogProps {
  readonly title: string
  readonly children: ReactNode
  readonly confirmLabel: string
  /** Styles the confirm button as destructive (red, trash icon). */
  readonly destructive?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  return (
    <StaffDialog
      initialFocus="[data-initial-focus]"
      open
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Typography id={bodyId} component="div" sx={{ fontSize: 13, lineHeight: 1.5 }}>
          {children}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <CobraLinkButton data-initial-focus onClick={onCancel}>
          Cancel
        </CobraLinkButton>
        {destructive ? (
          <CobraDeleteButton onClick={onConfirm}>{confirmLabel}</CobraDeleteButton>
        ) : (
          <CobraPrimaryButton onClick={onConfirm}>{confirmLabel}</CobraPrimaryButton>
        )}
      </DialogActions>
    </StaffDialog>
  )
}
