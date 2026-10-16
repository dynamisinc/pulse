/**
 * features/exerciseLifecycleAdmin/components/RenameExerciseDialog.tsx
 * ---------------------------------------------------------------------------
 * The RENAME row action's dialog (demo-feedback story 22, DF-35):
 * `PATCH /api/org/exercises/{exerciseId}` `{ name }`.
 *
 * The field opens holding the current name, with focus in it. **Rename** is
 * disabled while the field is blank or unchanged. The server applies the
 * exercise-settings name rule (trimmed, markup stripped, 1..200 characters); a
 * refused name keeps the dialog open with the server's reason as TEXT under the
 * field (`role="alert"`), and the typed value is kept so a fix is one edit.
 * Success closes the dialog; the table re-reads the list (the hook invalidates
 * it), so the new name shows without a reload.
 *
 * While the request is in flight the controls are `aria-disabled` rather than
 * `disabled`, so a focused control does not drop focus to `<body>` inside a
 * modal (the `EndExerciseDialog` precedent), and Esc / Cancel are ignored.
 *
 * World: STAFF (COBRA). `CobraTextField` + `CobraPrimaryButton`; FontAwesome
 * only; MUI 9 `sx`-only system props.
 */

import { useId, useState, type FormEvent } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faPen } from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import { useRenameExercise } from '../hooks/useExerciseRowActions'
import { isExerciseNotFoundError } from '../services/orgExercisesService'
import type { OrgExercise } from '../types'

/** MUI does not style `aria-disabled`: dim the pending control and drop the pointer. */
const PENDING_SX = {
  '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' },
} as const

export interface RenameExerciseDialogProps {
  /** The row being renamed. */
  readonly exercise: OrgExercise
  /** Closes the dialog (after success, or on Cancel / Esc when nothing is in flight). */
  readonly onClose: () => void
}

/** The rename dialog. See the module header. */
export function RenameExerciseDialog({ exercise, onClose }: RenameExerciseDialogProps) {
  const [name, setName] = useState(exercise.name)
  const rename = useRenameExercise()
  const titleId = useId()
  const errorId = useId()

  const pending = rename.isPending
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed !== exercise.name && !pending

  const error = rename.error
  const errorText = error === null
    ? undefined
    : isExerciseNotFoundError(error)
      ? 'This exercise is no longer in your organization’s list.'
      : (error.serverMessage ?? 'The exercise could not be renamed. Try again.')

  const close = () => {
    if (!pending) onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    rename.mutate(
      { exerciseId: exercise.exerciseId, name: trimmed },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      data-testid="rename-exercise-dialog"
    >
      <form onSubmit={submit} noValidate>
        <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
          Rename exercise
        </DialogTitle>
        <DialogContent>
          <CobraTextField
            label="Exercise name"
            value={name}
            onChange={event => setName(event.target.value)}
            fullWidth
            size="small"
            autoComplete="off"
            autoFocus
            required
            slotProps={{
              htmlInput: {
                maxLength: 200,
                readOnly: pending,
                'aria-disabled': pending,
                'aria-invalid': errorText !== undefined,
                'aria-describedby': errorText !== undefined ? errorId : undefined,
                'data-testid': 'rename-exercise-input',
              },
            }}
            sx={{ mt: 1 }}
          />
          {errorText !== undefined && (
            <Typography
              id={errorId}
              role="alert"
              data-testid="rename-exercise-error"
              component="div"
              sx={{ fontSize: 13, mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}
            >
              <FontAwesomeIcon
                icon={faCircleExclamation}
                aria-hidden="true"
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>The exercise was not renamed.</strong> {errorText}
              </span>
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <CobraLinkButton type="button" onClick={close} aria-disabled={pending} sx={PENDING_SX}>
            Cancel
          </CobraLinkButton>
          <CobraPrimaryButton
            type="submit"
            startIcon={<FontAwesomeIcon icon={faPen} aria-hidden="true" />}
            disabled={trimmed.length === 0 || trimmed === exercise.name}
            aria-disabled={pending}
            aria-busy={pending}
            sx={PENDING_SX}
            data-testid="rename-exercise-confirm"
          >
            {pending ? 'Renaming…' : 'Rename'}
          </CobraPrimaryButton>
        </DialogActions>
      </form>
    </Dialog>
  )
}
