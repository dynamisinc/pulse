/**
 * features/participantAdmin/components/people/ConfirmActionDialog.tsx
 * ---------------------------------------------------------------------------
 * The confirm step in front of the roster's consequential actions — reissue a
 * link, revoke a link, disable a person (feature: easy-login, story 10;
 * NFR-001). Each says PLAINLY what will happen ("This signs {name} out
 * everywhere and the old link stops working") before it does it.
 *
 * ## Accessibility
 *  - `role="alertdialog"`, named by its title (`aria-labelledby`) and described
 *    by its body (`aria-describedby`): the content needs an answer, not a skim.
 *  - A focus TRAP (MUI `Modal`), and initial focus on **Cancel** — the safe
 *    choice — not on the destructive button. Escape and Cancel both dismiss.
 *  - Focus RESTORE is deliberately NOT left to MUI (`disableRestoreFocus`):
 *    after a successful action the trigger may no longer exist (Disable becomes
 *    Enable), so the OWNER (`RosterRowActions`) puts focus back explicitly on
 *    the right control once the list has refreshed.
 *  - A failure renders INSIDE the dialog as `role="alert"` text with an icon,
 *    so the dialog stays open for a retry and the reason is announced.
 *
 * World: STAFF. COBRA buttons from `@/theme/styledComponents`; MUI `Dialog`
 * under the COBRA theme the staff shell mounts. FontAwesome only; `sx`-only.
 */

import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { CobraDeleteButton, CobraLinkButton, CobraPrimaryButton } from '@/theme/styledComponents'

export interface ConfirmActionDialogProps {
  readonly open: boolean
  /** Stable id prefix so `aria-labelledby` / `aria-describedby` resolve. */
  readonly idPrefix: string
  readonly title: string
  /** Plain-language consequence. Rendered as text. */
  readonly body: string
  readonly confirmLabel: string
  /** A destructive action gets the red COBRA button; others the primary one. */
  readonly destructive?: boolean
  /** The request is in flight: both buttons are inert. */
  readonly pending?: boolean
  /** A failure from the last attempt, shown inline and announced. */
  readonly errorMessage?: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/** The roster's alertdialog. See the module header. */
export function ConfirmActionDialog({
  open,
  idPrefix,
  title,
  body,
  confirmLabel,
  destructive = false,
  pending = false,
  errorMessage,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const titleId = `${idPrefix}-title`
  const bodyId = `${idPrefix}-body`
  const confirmText = pending ? 'Working…' : confirmLabel

  return (
    <Dialog
      open={open}
      role="alertdialog"
      onClose={pending ? undefined : onCancel}
      disableRestoreFocus
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <DialogTitle id={titleId} sx={{ fontSize: 16, fontWeight: 700 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Typography id={bodyId} variant="body2">
          {body}
        </Typography>
        {errorMessage !== undefined
          ? (
            <Stack
              role="alert"
              direction="row"
              data-testid="confirm-dialog-error"
              sx={{
                mt: 1.5,
                gap: 1,
                alignItems: 'flex-start',
                color: 'notifications.errorText',
              }}
            >
              <Box component="span" sx={{ mt: '2px' }}>
                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
              </Box>
              <Typography variant="body2">{errorMessage}</Typography>
            </Stack>
          )
          : null}
      </DialogContent>
      <DialogActions sx={{ padding: '8px 20px 16px', gap: 1 }}>
        <CobraLinkButton type="button" autoFocus disabled={pending} onClick={onCancel}>
          Cancel
        </CobraLinkButton>
        {destructive
          ? (
            <CobraDeleteButton
              type="button"
              hideIcon
              disabled={pending}
              onClick={onConfirm}
            >
              {confirmText}
            </CobraDeleteButton>
          )
          : (
            <CobraPrimaryButton
              type="button"
              disabled={pending}
              onClick={onConfirm}
            >
              {confirmText}
            </CobraPrimaryButton>
          )}
      </DialogActions>
    </Dialog>
  )
}
