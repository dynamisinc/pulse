/**
 * features/exerciseLifecycleAdmin/components/ArchiveExerciseDialog.tsx
 * ---------------------------------------------------------------------------
 * The ARCHIVE row action's confirm step (demo-feedback story 22, DF-35):
 * `POST /api/org/exercises/{exerciseId}/archive`.
 *
 * Archive is `completed → archived` in the COR-032 lifecycle, and archived is
 * terminal: nothing moves an exercise out of it. So the action sits behind a
 * confirm that names the exercise (as text, never HTML) and says it cannot be
 * undone. The row only offers this dialog for a completed exercise; if the
 * server still refuses (another tab moved it, `409 not-completed`), the dialog
 * stays open and says why in words (`role="alert"`).
 *
 * Pending posture as `RenameExerciseDialog`: `aria-disabled` controls, Esc and
 * Cancel ignored while the request is in flight.
 *
 * World: STAFF (COBRA). FontAwesome only; MUI 9 `sx`-only system props.
 */

import { useId } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxArchive, faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { CobraDeleteButton, CobraLinkButton } from '@/theme/styledComponents'
import { useArchiveExercise } from '../hooks/useExerciseRowActions'
import { isExerciseNotFoundError, isNotCompletedError } from '../services/orgExercisesService'
import type { OrgExercise } from '../types'

const PENDING_SX = {
  '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' },
} as const

export interface ArchiveExerciseDialogProps {
  /** The completed row being archived. */
  readonly exercise: OrgExercise
  /** Closes the dialog (after success, or on Cancel / Esc when nothing is in flight). */
  readonly onClose: () => void
}

/** The archive confirm. See the module header. */
export function ArchiveExerciseDialog({ exercise, onClose }: ArchiveExerciseDialogProps) {
  const archive = useArchiveExercise()
  const titleId = useId()
  const bodyId = useId()

  const pending = archive.isPending
  const error = archive.error
  const errorText = error === null
    ? undefined
    : isNotCompletedError(error)
      ? 'It is no longer completed. End the exercise first.'
      : isExerciseNotFoundError(error)
        ? 'This exercise is no longer in your organization’s list.'
        : (error.serverMessage ?? 'Try again.')

  const close = () => {
    if (!pending) onClose()
  }

  const confirm = () => {
    if (pending) return
    archive.mutate(exercise.exerciseId, { onSuccess: () => onClose() })
  }

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="archive-exercise-dialog"
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        Archive the exercise?
      </DialogTitle>
      <DialogContent>
        <Typography id={bodyId} component="div" sx={{ fontSize: 13, lineHeight: 1.5 }}>
          <strong data-testid="archive-exercise-name">{exercise.name}</strong> moves to Archived.
          Archived is final: it cannot be reopened. It stays in this list, labelled Archived.
        </Typography>
        {errorText !== undefined && (
          <Typography
            role="alert"
            data-testid="archive-exercise-error"
            component="div"
            sx={{ fontSize: 13, mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}
          >
            <FontAwesomeIcon
              icon={faCircleExclamation}
              aria-hidden="true"
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>The exercise was not archived.</strong> {errorText}
            </span>
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {/* Focus starts on Cancel: the safe choice on a step that cannot be undone. */}
        <CobraLinkButton onClick={close} aria-disabled={pending} sx={PENDING_SX} autoFocus>
          Cancel
        </CobraLinkButton>
        <CobraDeleteButton
          startIcon={<FontAwesomeIcon icon={faBoxArchive} aria-hidden="true" />}
          onClick={confirm}
          aria-disabled={pending}
          aria-busy={pending}
          sx={PENDING_SX}
          data-testid="archive-exercise-confirm"
        >
          {pending ? 'Archiving…' : 'Archive'}
        </CobraDeleteButton>
      </DialogActions>
    </Dialog>
  )
}
