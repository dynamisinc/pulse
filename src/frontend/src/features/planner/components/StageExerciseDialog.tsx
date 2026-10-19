/**
 * features/planner/components/StageExerciseDialog.tsx
 * ---------------------------------------------------------------------------
 * The COBRA CONFIRM DIALOG for **Stage exercise** (feature: exercise-build-golive, story 04 -
 * gated go-live; COR-032 / COR-042; NFR-001). STAFF world: COBRA buttons, FontAwesome only,
 * MUI 9 `sx`-only.
 *
 * TOM'S DECISION: a plain confirm, NOT typed-name confirmation. Staging does not start the
 * clock, so a click-through with the stakes spelled out is the right weight:
 *
 *   Title   "Stage <exercise name>?"
 *   Body    "Participants will be able to sign in and see the ambient world. The clock does not
 *            start until a controller starts the exercise."
 *   Also    the readiness summary (open blocking items / ready) and, when the SERVER refused
 *           anyway (a race: an item opened after the page last looked), the items it named.
 *   Actions Cancel / Stage.
 *
 * A11Y. A modal MUI `Dialog` (`aria-modal`, focus trapped, Escape cancels, focus returns to the
 * element that opened it - the Stage button - on close), labelled by its title and described by
 * its body. Focus lands on **Cancel**, the safe choice. While the request is in flight the
 * controls are `aria-disabled` (not `disabled`, which would drop focus) and Escape / Cancel are
 * ignored, so the planner is never unsure whether it went through. Every status is an icon plus
 * words (never colour alone); the refusal is `role="alert"`.
 *
 * The dialog owns text only: the request, the pending flag and the refusal come from
 * `StageExerciseControl`.
 */

import { useId } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleExclamation,
  faLayerGroup,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import type { ReadinessItem } from '../services/readinessService'

/** The exact body copy (Tom's decision). Exported so tests assert the shipped words. */
export const STAGE_DIALOG_BODY =
  'Participants will be able to sign in and see the ambient world. ' +
  'The clock does not start until a controller starts the exercise.'

/** MUI does not style `aria-disabled`: dim the pending control and drop the pointer. */
const PENDING_SX = {
  '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' },
} as const

export interface StageExerciseDialogProps {
  /** The exercise the console shows (the scope's name): the one this dialog says it stages. */
  readonly exerciseName: string
  /** Count of OPEN blocking items from the last readiness read; `undefined` = unknown. */
  readonly openBlocking: number | undefined
  /** A request is in flight: not dismissable; the confirm reads "Staging...". */
  readonly pending: boolean
  /** Plain-text reason the last attempt failed; `undefined` when none. */
  readonly error: string | undefined
  /** The blocking items the server named when it refused (readiness-blocking 409). */
  readonly blocking: readonly ReadinessItem[] | undefined
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/** The readiness line inside the dialog: icon plus words. */
function readinessLine(openBlocking: number | undefined): { text: string; ready: boolean } {
  if (openBlocking === undefined) return { text: 'Readiness is unknown right now.', ready: false }
  if (openBlocking === 0) return { text: 'Readiness: all blocking items are done.', ready: true }
  return {
    text: `Readiness: ${openBlocking} blocking ${openBlocking === 1 ? 'item' : 'items'} open.`,
    ready: false,
  }
}

export function StageExerciseDialog({
  exerciseName,
  openBlocking,
  pending,
  error,
  blocking,
  onConfirm,
  onCancel,
}: StageExerciseDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const line = readinessLine(openBlocking)

  const cancel = () => {
    if (!pending) onCancel()
  }
  const confirm = () => {
    if (!pending) onConfirm()
  }

  return (
    <Dialog
      open
      onClose={cancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="stage-exercise-dialog"
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        Stage {exerciseName}?
      </DialogTitle>
      <DialogContent>
        <Typography id={bodyId} component="div" sx={{ fontSize: 13, lineHeight: 1.5, mb: 1.5 }}>
          {STAGE_DIALOG_BODY}
        </Typography>
        <Typography
          component="div"
          data-testid="stage-dialog-readiness"
          sx={{ fontSize: 13, display: 'flex', gap: 1, alignItems: 'center', fontWeight: 600 }}
        >
          <FontAwesomeIcon
            icon={line.ready ? faCircleCheck : faTriangleExclamation}
            aria-hidden="true"
          />
          <span>{line.text}</span>
        </Typography>
        {error !== undefined && (
          <Box
            role="alert"
            data-testid="stage-exercise-error"
            sx={{ mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start', fontSize: 13 }}
          >
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
            <div>
              <strong>The exercise was not staged.</strong> {error}
              {blocking !== undefined && (
                <Box
                  component="ul"
                  data-testid="stage-blocking-list"
                  sx={{ margin: '6px 0 0', paddingLeft: '18px' }}
                >
                  {blocking.map(item => (
                    <li key={item.id}>
                      {item.label}
                      {item.detail !== null && item.detail.length > 0 ? `: ${item.detail}` : ''}
                    </li>
                  ))}
                </Box>
              )}
            </div>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <CobraSecondaryButton
          onClick={cancel}
          autoFocus
          aria-disabled={pending}
          sx={PENDING_SX}
          data-testid="stage-exercise-cancel"
        >
          Cancel
        </CobraSecondaryButton>
        <CobraPrimaryButton
          startIcon={<FontAwesomeIcon icon={faLayerGroup} aria-hidden="true" />}
          onClick={confirm}
          aria-disabled={pending}
          aria-busy={pending}
          sx={PENDING_SX}
          data-testid="stage-exercise-confirm"
        >
          {pending ? 'Staging…' : 'Stage'}
        </CobraPrimaryButton>
      </DialogActions>
    </Dialog>
  )
}
