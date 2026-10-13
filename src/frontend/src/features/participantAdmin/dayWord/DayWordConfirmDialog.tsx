/**
 * features/participantAdmin/dayWord/DayWordConfirmDialog.tsx
 * ---------------------------------------------------------------------------
 * The confirm step in front of the three disruptive day-word actions (easy-login
 * story 11): ROTATE a word that is already set, TURN OFF word sign-in for today,
 * and CLEAR a pre-set later date. Each changes what staff can read out to the
 * room, so each asks first.
 *
 * ACCESSIBILITY (NFR-001):
 *  - `role="alertdialog"` with `aria-labelledby` (the question) and
 *    `aria-describedby` (the consequence), `aria-modal`, and MUI's focus trap,
 *    so keyboard focus cannot wander behind it.
 *  - Initial focus lands on CANCEL, the least destructive control, so a stray
 *    Enter or Space never rotates or clears anything.
 *  - Escape cancels (unless a request is in flight). A backdrop click does NOT:
 *    an alert dialog must be answered deliberately.
 *  - `disableRestoreFocus`: the caller owns where focus goes next. The control
 *    that opened the dialog is often GONE once the action succeeds (the "Turn
 *    off" button disappears with the word it turns off, an upcoming row
 *    vanishes), and MUI's automatic restore would silently drop focus to
 *    `<body>`. The panel moves focus deliberately instead (see `DayWordPanel`).
 *
 * WORLD: STAFF. COBRA buttons (`@/theme/styledComponents`); the MUI `Dialog`
 * itself is structural and inherits the COBRA theme the staff frame mounts.
 */

import { useId, type ReactNode } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import {
  CobraDeleteButton,
  CobraLinkButton,
  CobraPrimaryButton,
} from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'

export interface DayWordConfirmDialogProps {
  open: boolean
  /** The question, e.g. "Rotate the word for Tuesday, October 13, 2026?". */
  title: string
  /** The consequence, spelled out. */
  children: ReactNode
  confirmLabel: string
  /** True while the confirmed request is in flight (locks both buttons). */
  pending: boolean
  /** Red confirm button for removals; blue for a replacement. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DayWordConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pending,
  destructive = false,
  onConfirm,
  onCancel,
}: DayWordConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const confirmText = pending ? 'Working…' : confirmLabel

  return (
    <Dialog
      open={open}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      disableRestoreFocus
      onClose={(_event, reason) => {
        if (reason === 'escapeKeyDown' && !pending) onCancel()
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId} sx={{ fontWeight: 700, fontSize: '1.0625rem' }}>
        {title}
      </DialogTitle>
      <DialogContent sx={{ padding: CobraStyles.Padding.DialogContent }}>
        <Typography id={bodyId} variant="body2" component="div" sx={{ color: 'text.primary' }}>
          {children}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ padding: CobraStyles.Padding.DialogContent, gap: 1 }}>
        <CobraLinkButton autoFocus disabled={pending} onClick={onCancel}>
          Cancel
        </CobraLinkButton>
        {destructive ? (
          <CobraDeleteButton hideIcon disabled={pending} onClick={onConfirm}>
            {confirmText}
          </CobraDeleteButton>
        ) : (
          <CobraPrimaryButton disabled={pending} onClick={onConfirm}>
            {confirmText}
          </CobraPrimaryButton>
        )}
      </DialogActions>
    </Dialog>
  )
}
