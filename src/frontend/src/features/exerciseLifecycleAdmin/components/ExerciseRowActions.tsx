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
 * ## Focus after a successful archive
 * MUI returns focus to the control that opened a dialog, but a successful
 * archive REMOVES that control (the row re-reads as archived) and moves the row
 * to the end of the table, so focus would fall to `<body>` and a keyboard user
 * would lose their place. So once the dialog has closed AND the refreshed row
 * reads archived, focus goes to this row's Rename button, which survives. It
 * only moves focus that was lost (on `<body>`) or still inside this row, so a
 * person who has already moved on is never pulled back.
 *
 * Who sees which actions (story 17): Rename and Archive need `can('renameExercise')` /
 * `can('archiveExercise')` (org admin, planner); a controller sees neither. The page only
 * mounts for the DF-20 roles (planner, org admin, controller). An evaluator never reaches
 * `/staff/exercises` (the not-allowed page), so it never sees these actions;
 * `orgAdminSurfaceFamily.test.tsx` asserts that.
 *
 * World: STAFF (COBRA). FontAwesome only; MUI 9 `sx`-only system props.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxArchive, faPen } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import { usePermissions } from '@/core/auth'
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
  // Set by a successful archive; consumed once the row has re-read as archived.
  const [focusRenameAfterArchive, setFocusRenameAfterArchive] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLButtonElement>(null)
  const reasonId = useId()
  // Story 17: rename and archive are org-admin / planner; a controller would get a 403, so the
  // actions are absent (a controller still sees the row's status in the table).
  const permissions = usePermissions()
  // WR-005: ... and, per row, only where the server says the caller manages it (a planner only
  // plans some exercises). A backend that predates the field omits it: org admin manages all.
  const manages = exercise.canManage ?? permissions.role === 'orgAdmin'
  const canRename = manages && permissions.can('renameExercise')
  const canArchive = manages && permissions.can('archiveExercise')
  const archived = isArchivedStatus(exercise.status)
  const completed = isCompletedStatus(exercise.status)

  // See "Focus after a successful archive" in the module header. Runs after the
  // commit that both unmounts the dialog (MUI's own focus restore runs first) and
  // shows the row archived (its DOM move has already happened).
  useEffect(() => {
    if (!focusRenameAfterArchive || open !== null || !archived) return
    setFocusRenameAfterArchive(false)
    const active = document.activeElement
    const focusWasLost = active === null || active === document.body
    if (focusWasLost || (rowRef.current?.contains(active) ?? false)) {
      renameRef.current?.focus()
    }
  }, [focusRenameAfterArchive, open, archived])

  return (
    <Stack
      ref={rowRef}
      direction="row"
      data-testid={`org-exercise-actions-${exercise.exerciseId}`}
      sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
    >
      {canRename && (
        <CobraSecondaryButton
          type="button"
          size="small"
          startIcon={<FontAwesomeIcon icon={faPen} aria-hidden="true" />}
          ref={renameRef}
          onClick={() => setOpen('rename')}
          aria-label={`Rename ${exercise.name}`}
          sx={ACTION_BUTTON_SX}
        >
          Rename
        </CobraSecondaryButton>
      )}

      {archived || !canArchive ? null : (
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
        <ArchiveExerciseDialog
          exercise={exercise}
          onClose={() => setOpen(null)}
          onArchived={() => {
            setFocusRenameAfterArchive(true)
            setOpen(null)
          }}
        />
      )}
    </Stack>
  )
}
