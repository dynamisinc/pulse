/**
 * features/controller/personaEdit/VerifiedConfirmDialog.tsx
 * ---------------------------------------------------------------------------
 * The confirmation shown when a controller flips an account's VERIFIED mark in the
 * persona edit dialog (demo-polish story 21 / PE-FE; SOC-052 "verification is a
 * trainable signal", COR-030). STAFF world (COBRA buttons).
 *
 * Why it asks: the verified seal is the one trust cue a participant gets. Whether
 * a lookalike account carries it is exactly what an impersonation exercise tests
 * (SOC-052/D1-008: absence of the mark is the ONLY signal), so flipping it by a
 * stray Space on a checkbox must not be possible. Turning it ON makes an account
 * read as trustworthy to every participant; turning it OFF is how an impersonator
 * is made to read as the fake it is. The wording therefore names the participant-
 * visible consequence in both directions, and — since the change only reaches
 * participants on Save — says so.
 *
 * Keyboard-first: the confirm button takes focus when the dialog opens (Enter
 * confirms), Esc / Cancel dismiss without changing anything, and MUI's focus trap
 * returns focus to the Verified checkbox that opened it. This is a nested dialog:
 * Esc closes only this one, not the edit dialog beneath it.
 */

import { useId } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { CobraLinkButton, CobraPrimaryButton } from '@/theme/styledComponents'
import { swallowConsoleChord } from './consoleChords'

export interface VerifiedConfirmDialogProps {
  /** The value being proposed: `true` = turn the mark ON, `false` = turn it OFF. */
  readonly proposed: boolean | null
  readonly handle: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/** Confirms a verified-mark change. Open while `proposed` is not `null`. */
export function VerifiedConfirmDialog({
  proposed,
  handle,
  onConfirm,
  onCancel,
}: VerifiedConfirmDialogProps) {
  const turningOn = proposed === true
  const titleId = useId()
  const bodyId = useId()
  return (
    <Dialog
      open={proposed !== null}
      onClose={onCancel}
      onKeyDown={event => {
        swallowConsoleChord(event)
      }}
      maxWidth="xs"
      fullWidth
      transitionDuration={0}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <DialogTitle
        id={titleId}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 18, fontWeight: 700 }}
      >
        <FontAwesomeIcon icon={turningOn ? faCircleCheck : faCircleXmark} aria-hidden />
        {turningOn
          ? `Turn the verified mark ON for @${handle}?`
          : `Turn the verified mark OFF for @${handle}?`}
      </DialogTitle>
      <DialogContent sx={{ padding: CobraStyles.Padding.DialogContent }}>
        <Typography id={bodyId} variant="body2">
          {turningOn
            ? 'Participants will see the verified seal next to this account on every post and '
              + 'profile. It is how they tell real accounts from lookalikes — only turn it on '
              + 'for an account that should be trusted.'
            : 'Participants will no longer see the verified seal on this account, so it reads '
              + 'as unverified. Use this for a lookalike or impersonator.'}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
          This reaches participants when you save the persona.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ padding: CobraStyles.Padding.DialogContent, gap: 1 }}>
        <CobraLinkButton onClick={onCancel}>Cancel</CobraLinkButton>
        <CobraPrimaryButton autoFocus onClick={onConfirm}>
          {turningOn ? 'Turn verified ON' : 'Turn verified OFF'}
        </CobraPrimaryButton>
      </DialogActions>
    </Dialog>
  )
}
