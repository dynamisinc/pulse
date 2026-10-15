/**
 * features/exerciseLifecycleAdmin/components/ExerciseRowActions.tsx
 * ---------------------------------------------------------------------------
 * The ACTIONS cell of one org exercise row (demo-feedback story 22, DF-35).
 *
 *  - **Rename** on every row: opens `RenameExerciseDialog`.
 *  - **Archive** only does something on a COMPLETED exercise, behind
 *    `ArchiveExerciseDialog`. On any other live state the button is shown
 *    disabled AND the reason is visible text beside it, "End the exercise
 *    first" (the AC: not tooltip-only), tied to the button with
 *    `aria-describedby` so a screen reader hears it too. An ARCHIVED row has no
 *    Archive button at all: it is already archived, and its status cell says so.
 *
 * Who sees this: the page only mounts for the DF-20 roles (planner, org admin,
 * controller). An evaluator never reaches `/staff/exercises` (the not-allowed
 * page), so it never sees these actions; `orgAdminSurfaceFamily.test.tsx`
 * asserts that.
 *
 * World: STAFF (COBRA). FontAwesome only; MUI 9 `sx`-only system props.
 */

import { useId, useState } from 'react'
import { Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxArchive, faPen } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import { ArchiveExerciseDialog } from './ArchiveExerciseDialog'
import { RenameExerciseDialog } from './RenameExerciseDialog'
import { isArchivedStatus, isCompletedStatus } from './exerciseRowStatus'
import type { OrgExercise } from '../types'

/** The visible reason a non-completed exercise cannot be archived (story 22 AC, verbatim). */
export const ARCHIVE_DISABLED_TEXT = 'End the exercise first'

const ACTION_BUTTON_SX = {
  minWidth: 0,
  whiteSpace: 'nowrap',
  paddingLeft: '12px',
  paddingRight: '12px',
} as const

export interface ExerciseRowActionsProps {
  readonly exercise: OrgExercise
}

/** One row's actions and the dialogs they open. See the module header. */
export function ExerciseRowActions({ exercise }: ExerciseRowActionsProps) {
  const [open, setOpen] = useState<'rename' | 'archive' | null>(null)
  const reasonId = useId()
  const archived = isArchivedStatus(exercise.status)
  const completed = isCompletedStatus(exercise.status)

  return (
    <Stack
      direction="row"
      data-testid={`org-exercise-actions-${exercise.exerciseId}`}
      sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
    >
      <CobraSecondaryButton
        type="button"
        size="small"
        startIcon={<FontAwesomeIcon icon={faPen} aria-hidden="true" />}
        onClick={() => setOpen('rename')}
        aria-label={`Rename ${exercise.name}`}
        sx={ACTION_BUTTON_SX}
      >
        Rename
      </CobraSecondaryButton>

      {archived ? null : (
        <>
          <CobraSecondaryButton
            type="button"
            size="small"
            startIcon={<FontAwesomeIcon icon={faBoxArchive} aria-hidden="true" />}
            onClick={() => setOpen('archive')}
            disabled={!completed}
            aria-label={`Archive ${exercise.name}`}
            aria-describedby={completed ? undefined : reasonId}
            sx={ACTION_BUTTON_SX}
          >
            Archive
          </CobraSecondaryButton>
          {completed ? null : (
            <Typography
              id={reasonId}
              variant="caption"
              data-testid={`org-exercise-archive-reason-${exercise.exerciseId}`}
              sx={{ color: 'text.secondary' }}
            >
              {ARCHIVE_DISABLED_TEXT}
            </Typography>
          )}
        </>
      )}

      {open === 'rename' && (
        <RenameExerciseDialog exercise={exercise} onClose={() => setOpen(null)} />
      )}
      {open === 'archive' && (
        <ArchiveExerciseDialog exercise={exercise} onClose={() => setOpen(null)} />
      )}
    </Stack>
  )
}
