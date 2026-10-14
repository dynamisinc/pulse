/**
 * features/controller/lifecycle/EndExerciseDialog.tsx
 * ---------------------------------------------------------------------------
 * The TYPE-TO-CONFIRM step for **End exercise** (demo-polish C6, AC "End requires a
 * type-to-confirm ("END")"; exercise-configuration/03 COR-032; NFR-001). STAFF world: COBRA
 * controls (`@/theme/styledComponents`), FontAwesome only, MUI 9 `sx`-only.
 *
 * WHY A TYPED WORD. EndEx moves the exercise to ENDEX for every participant, and the only way
 * on from there is archive: it cannot be taken back from this console. A click-through
 * "Are you sure?" gets dismissed by habit; typing `END` cannot be done by accident, and it is
 * exactly as keyboard-friendly as a button. The match is EXACT (after trimming the field) -- not
 * case-insensitive -- so the word the dialog tells the controller to type is the word that works.
 *
 * THE FLOW. The dialog opens with focus in the field. **End exercise** stays disabled until the
 * field reads `END`; Enter in the field confirms (only when it matches, never while a request is
 * in flight); **Cancel** and Esc close it. While the request is in flight the dialog cannot be
 * dismissed (Esc and Cancel are ignored and the button reads "Ending...") so the controller is
 * never left wondering whether the exercise ended. The controls that can hold focus (the field,
 * Cancel, the confirm button) are marked `aria-disabled` / read-only while pending, NOT
 * `disabled`: a `disabled` control that has focus drops it to <body> in the middle of the
 * request, stranding a keyboard user inside a modal (the only `disabled` state left is the
 * confirm button BEFORE END is typed, which cannot hold focus yet).
 *
 * A REFUSED or failed request leaves the dialog
 * open with the reason as TEXT (an icon, a bold lead-in and the sentence -- never colour alone),
 * announced with `role="alert"`, and the field still holding `END`, so retrying is one key press.
 *
 * MODAL, ON PURPOSE. This is a plain MUI `Dialog`, so its Paper declares `aria-modal="true"`
 * and MUI traps focus inside it. The console's Ctrl/Cmd+K palette is inert while ANY
 * `[aria-modal]` layer is mounted (`ControllerConsole` -> `core/a11y/modalPriority`
 * `hasOtherModalMounted`), so the palette cannot open on top of an unfinished EndEx.
 * It does NOT need the "stand aside for the participant shell's overlay" treatment that
 * `modalPriority.ts` asks of CHANNEL modals: that overlay (`data-shell-layer`: pause / EndEx /
 * break-fiction) is the participant shell's and never mounts on `/console`, and the staff
 * preview-as-participant replaces the console's work area (and with it this control) while it
 * is open, so no participant layer can be up at the same time as this dialog.
 *
 * IT NAMES THE EXERCISE (Gate-2 S-3). The body says WHICH exercise is about to end, using the
 * name from the console's exercise scope. The transition request deliberately names no exercise
 * (the server resolves it from the session, COR-001), so a second browser tab whose session
 * switched the active exercise could otherwise end an exercise this tab is not showing; reading
 * the name aloud in the confirmation is the last chance for the controller to notice. (The name
 * is data, rendered as text -- never HTML.)
 *
 * The dialog owns its text and nothing else: the request, the pending flag and the error come
 * from the caller (`ExerciseLifecycleControl` via `useExerciseLifecycle`).
 */

import { useId, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faStop } from '@fortawesome/free-solid-svg-icons'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import {
  CobraDeleteButton,
  CobraLinkButton,
  CobraTextField,
} from '@/theme/styledComponents'

/** The word the controller types. Exact match after trimming. */
export const END_CONFIRM_WORD = 'END'

/** MUI does not style `aria-disabled`: dim the pending control and drop the pointer. */
const PENDING_SX = {
  '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' },
} as const

export interface EndExerciseDialogProps {
  /** The exercise the console is showing (the scope's name): the one this dialog says it ends. */
  readonly exerciseName: string
  /** A request is in flight: the dialog cannot be dismissed and the confirm reads "Ending...". */
  readonly pending: boolean
  /** The plain-text reason the last attempt failed; shown inside the dialog. */
  readonly error: string | undefined
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function EndExerciseDialog({
  exerciseName,
  pending,
  error,
  onConfirm,
  onCancel,
}: EndExerciseDialogProps) {
  const [typed, setTyped] = useState('')
  const titleId = useId()
  const bodyId = useId()
  const hintId = useId()
  const errorId = useId()

  const matches = typed.trim() === END_CONFIRM_WORD
  const canConfirm = matches && !pending

  const confirm = () => {
    if (canConfirm) onConfirm()
  }
  const cancel = () => {
    if (!pending) onCancel()
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter') return
    // A native default action (a button's click) must still happen on the buttons.
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    confirm()
  }

  return (
    <Dialog
      open
      onClose={cancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="end-exercise-dialog"
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        End the exercise?
      </DialogTitle>
      <DialogContent onKeyDown={handleKeyDown}>
        <Typography id={bodyId} component="div" sx={{ fontSize: 13, lineHeight: 1.5, mb: 1.5 }}>
          This moves <strong data-testid="end-exercise-name">{exerciseName}</strong> to ENDEX for
          everyone in it. It cannot be undone from the console.
        </Typography>
        <CobraTextField
          label="Type END to confirm"
          value={typed}
          onChange={event => setTyped(event.target.value)}
          fullWidth
          size="small"
          autoComplete="off"
          // Focus lands in the field on open: the controller's next act is to type END.
          autoFocus
          slotProps={{
            htmlInput: {
              // Read-only (not disabled) while the request is in flight: it may hold focus.
              readOnly: pending,
              'aria-disabled': pending,
              'data-testid': 'end-exercise-confirm-input',
              spellCheck: false,
              autoCapitalize: 'characters',
              'aria-describedby': error === undefined ? hintId : `${hintId} ${errorId}`,
            },
          }}
        />
        <Typography
          id={hintId}
          component="div"
          sx={{ fontSize: 12, mt: 0.75, color: 'text.secondary' }}
        >
          {matches ? 'Ready: choose End exercise.' : 'End exercise is unavailable until you type END.'}
        </Typography>
        {error !== undefined && (
          <Typography
            id={errorId}
            role="alert"
            data-testid="end-exercise-error"
            component="div"
            sx={{ fontSize: 13, mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}
          >
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
            <span>
              <strong>The exercise was not ended.</strong> {error}
            </span>
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <CobraLinkButton onClick={cancel} aria-disabled={pending} sx={PENDING_SX}>
          Cancel
        </CobraLinkButton>
        <CobraDeleteButton
          startIcon={<FontAwesomeIcon icon={faStop} aria-hidden="true" />}
          onClick={confirm}
          disabled={!matches}
          aria-disabled={pending}
          aria-busy={pending}
          sx={PENDING_SX}
          data-testid="end-exercise-confirm"
        >
          {pending ? 'Ending…' : 'End exercise'}
        </CobraDeleteButton>
      </DialogActions>
    </Dialog>
  )
}
