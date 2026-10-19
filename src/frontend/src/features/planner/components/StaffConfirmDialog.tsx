/**
 * features/planner/components/StaffConfirmDialog.tsx
 * ---------------------------------------------------------------------------
 * The confirm step in front of the Staff section's consequential actions (remove, make lead,
 * demote yourself). STAFF world: COBRA buttons, FontAwesome, `sx`-only.
 *
 * Accessibility: `role="alertdialog"` named by its title and described by its body (MUI traps
 * focus; Escape and Cancel dismiss). Initial focus is on Cancel, the safe choice. MUI restores
 * focus to the trigger on close, which is what we want here (the row's button still exists, or
 * the table has refetched and the heading remains reachable).
 */
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { CobraDeleteButton, CobraLinkButton, CobraPrimaryButton } from '@/theme/styledComponents'

export interface StaffConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  /** Plain-language consequences, one paragraph each. */
  readonly paragraphs: readonly string[]
  readonly confirmLabel: string
  readonly destructive?: boolean
  readonly pending?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function StaffConfirmDialog({
  open,
  title,
  paragraphs,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: StaffConfirmDialogProps) {
  const label = pending ? 'Working…' : confirmLabel
  return (
    <Dialog
      open={open}
      role="alertdialog"
      onClose={pending ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby="staff-confirm-title"
      aria-describedby="staff-confirm-body"
    >
      <DialogTitle id="staff-confirm-title" sx={{ fontSize: 16, fontWeight: 700 }}>
        {title}
      </DialogTitle>
      <DialogContent id="staff-confirm-body">
        {paragraphs.map(text => (
          <Typography key={text} variant="body2" sx={{ mb: 1 }}>
            {text}
          </Typography>
        ))}
      </DialogContent>
      <DialogActions sx={{ padding: '8px 20px 16px', gap: 1 }}>
        <CobraLinkButton type="button" autoFocus disabled={pending} onClick={onCancel}>
          Cancel
        </CobraLinkButton>
        {destructive ? (
          <CobraDeleteButton type="button" hideIcon disabled={pending} onClick={onConfirm}>
            {label}
          </CobraDeleteButton>
        ) : (
          <CobraPrimaryButton type="button" disabled={pending} onClick={onConfirm}>
            {label}
          </CobraPrimaryButton>
        )}
      </DialogActions>
    </Dialog>
  )
}
