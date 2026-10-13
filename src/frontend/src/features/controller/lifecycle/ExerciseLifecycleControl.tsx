/**
 * features/controller/lifecycle/ExerciseLifecycleControl.tsx
 * ---------------------------------------------------------------------------
 * The console's **Start exercise** / **End exercise** control (demo-polish C6,
 * docs/features/demo-polish/23-preview-and-startex.md, #442; exercise-configuration/03 COR-032;
 * CTL-033, NFR-001). STAFF world: COBRA controls (`@/theme/styledComponents`), FontAwesome
 * only, MUI 9 `sx`-only, dense and keyboard-first -- unmistakably the machine, never a
 * participant surface.
 *
 * WHAT IT SHOWS (gated by the SERVER's allowed transitions -- `useExerciseLifecycle`):
 *   - **Start exercise** for a STAGED exercise (`live` is its legal next state). A PAUSED
 *     exercise also reaches `live`, but that is a resume -- the world-steering tier control's
 *     job -- so it is not offered here as a second "Start exercise";
 *   - **End exercise** while `completed` is a legal next state (a live or paused exercise);
 *   - nothing to press otherwise (build, completed, archived): the control then shows only the
 *     last result and any error, or renders nothing at all if there is neither.
 * Start runs at once, with no confirm: it is the presenter's deliberate first beat. It is NOT
 * undone by EndEx -- EndEx is the final transition, a different act, not an "un-start" -- and
 * there is no way back to staged from this console; the mitigation for a premature start is
 * PAUSE (the world-steering tier control), which holds the world while the presenter recovers.
 * End opens the type-to-confirm dialog (`EndExerciseDialog`), naming the exercise: it cannot be
 * taken back from this console.
 *
 * WHAT HAPPENS NEXT. A success updates the buttons from the response and re-resolves the exercise
 * scope, so the staff header's state pill moves (LIVE -> ENDEX) -- see the hook. Under mock data
 * the same path runs against a simulated machine.
 *
 * ERRORS ARE TEXT. A failed read shows "Exercise state unavailable" with a **Retry** button; a
 * refused or failed transition shows an icon, a bold lead-in and the reason (the server's own
 * sentence for a 409), `role="alert"`. A failed End shows its reason inside the dialog instead,
 * where the controller is looking. Nothing here is conveyed by colour alone (NFR-001): every
 * state has words, the buttons carry text labels as well as icons, and a successful change is
 * confirmed in a polite live region ("Exercise started. The state is now LIVE.").
 *
 * AN OUTCOME ALREADY REACHED IS A SUCCESS, NOT AN ERROR (Gate-2 W-1). When a request fails in a
 * way that leaves the state unknown (a lost answer, a 409 because another controller got there
 * first) the hook re-reads the server; if the exercise is already at the target it resolves as a
 * success, and the live region says so ("The exercise had already ended. The state is now
 * ENDEX.") -- an announcement, never silence -- the End dialog (if open) closes, and focus moves
 * to this group. The live-region text is cleared after {@link STATUS_CLEAR_MS}: the state it names
 * can change under it (a later freeze), so it must not linger as a claim.
 *
 * ABSENT FOR NON-CONTROLLERS. The control renders nothing -- and, because the inner component
 * never mounts, issues no request -- unless the signed-in role is `controller`. The role is the
 * REAL session's (`useOptionalSession().role`: staff routes sit under the `SessionProvider` that
 * `app-shell/routes.tsx` hoists above `RoleAwareEntry`). There is deliberately NO prop to
 * override it: a control that can be told "you are a controller" is a control that can be shown
 * to the wrong role; tests choose the session instead (`lifecycle.sessionKit.testUtils`). With no
 * session at all it FAILS CLOSED -- renders nothing -- rather than crash the console (the
 * non-throwing read; see `core/auth`). NOT `useControllerIdentity().role`: that is a hard-coded
 * `'controller'` mock, so gating on it would be a no-op. This hides a control, it does not
 * authorize anything: the server gates both endpoints to a staff session assigned to the
 * resolved exercise (401 / 403) -- ANY assigned staff role, not only controllers -- so the
 * controller-only rule is a client-side convention until the server enforces it too.
 *
 * KEYBOARD (NFR-001). Both buttons are native buttons in the tab order. While a request is in
 * flight the Start button stays focusable (`aria-disabled`, reading "Starting...") rather than
 * `disabled`, so keyboard focus is not dropped mid-request, and a press is ignored. When a
 * success removes the button that held focus (Start disappears once the exercise is live; End
 * once it has ended) focus moves to this control's group, which is programmatically focusable,
 * so a keyboard user is never stranded on <body>. The group stays mounted after a success even
 * with nothing left to press, for exactly that reason (and so its live region keeps announcing).
 *
 * MOUNTING. The orchestrator mounts this in `ControllerConsole`'s header row through the
 * `lifecycleSlot` prop (`ControllerConsoleRoute.tsx`); see `./README.md`.
 */

import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faPlay, faStop } from '@fortawesome/free-solid-svg-icons'
import { Stack, Typography } from '@mui/material'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import { useOptionalSession } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import { EndExerciseDialog } from './EndExerciseDialog'
import { useExerciseLifecycle } from './useExerciseLifecycle'
import type { LifecycleTarget } from './lifecycleService'

/**
 * What the polite live region says after a success, keyed by the target. `done` = this console's
 * request was answered; `already` = the exercise was found at the target by a re-read (the
 * answer was lost, or another controller got there first). The state names match the header pill.
 */
const STATUS_TEXT: Readonly<Record<LifecycleTarget, { done: string; already: string }>> = {
  live: {
    done: 'Exercise started. The state is now LIVE.',
    already: 'The exercise was already started. The state is now LIVE.',
  },
  completed: {
    done: 'Exercise ended. The state is now ENDEX.',
    already: 'The exercise had already ended. The state is now ENDEX.',
  },
}

/** How long a result stays in the live region before it is cleared (see the module header). */
export const STATUS_CLEAR_MS = 5000

/**
 * The control. It takes NO props: whether it exists is decided by the signed-in session alone
 * (see "ABSENT FOR NON-CONTROLLERS" above).
 */
export function ExerciseLifecycleControl() {
  const session = useOptionalSession()
  if (session?.role !== 'controller') return null
  return <ExerciseLifecycleControlBody />
}

/** The controller-only body. Its hooks (and so its request) exist only for a controller. */
function ExerciseLifecycleControlBody() {
  const lifecycle = useExerciseLifecycle()
  const { exerciseName } = useExerciseContext()
  const {
    canStart,
    canEnd,
    pending,
    transitionError,
    lastTransition,
    lastTransitionAlreadyDone,
    loadPhase,
    loadError,
    transition,
    clearError,
    reload,
  } = lifecycle

  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  // Bumped on every success, so the focus effect runs once per success and never on mount.
  const [settledCount, setSettledCount] = useState(0)
  // The `settledCount` whose live-region text has been cleared (see STATUS_CLEAR_MS).
  const [statusClearedFor, setStatusClearedFor] = useState(0)

  useEffect(() => {
    if (settledCount === 0) return
    // The button that held focus (Start, or End / the dialog's confirm) is gone: keep focus here.
    const active = document.activeElement
    if (active === null || active === document.body || !groupRef.current?.contains(active)) {
      groupRef.current?.focus()
    }
  }, [settledCount])

  useEffect(() => {
    if (settledCount === 0) return undefined
    const timer = window.setTimeout(() => setStatusClearedFor(settledCount), STATUS_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [settledCount])

  const start = async () => {
    if (pending !== undefined) return
    if (await transition('live')) setSettledCount(count => count + 1)
  }

  const openEndConfirm = () => {
    clearError()
    setConfirmingEnd(true)
  }

  const end = async () => {
    if (await transition('completed')) {
      setConfirmingEnd(false)
      setSettledCount(count => count + 1)
    }
  }

  const cancelEnd = () => {
    clearError()
    setConfirmingEnd(false)
  }

  // A failed End is explained in its dialog; every other error is explained here.
  const inlineError = confirmingEnd ? undefined : transitionError
  // Nothing to press and nothing to say. A control that has already SETTLED a transition keeps
  // its group (it holds focus and the live region); and an open End dialog is NEVER torn down
  // because the buttons behind it went away (the exercise moved on while the controller typed).
  const nothingToShow =
    !canStart && !canEnd && loadPhase !== 'error' && settledCount === 0 && inlineError === undefined
  if (nothingToShow && !confirmingEnd) return null

  const statusText = lastTransition === undefined || statusClearedFor === settledCount
    ? ''
    : STATUS_TEXT[lastTransition][lastTransitionAlreadyDone ? 'already' : 'done']

  return (
    <>
      <Stack
        ref={groupRef}
        direction="row"
        role="group"
        aria-label="Exercise lifecycle"
        tabIndex={-1}
        data-testid="exercise-lifecycle-control"
        sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', outline: 'none' }}
      >
        {canStart && (
          <CobraPrimaryButton
            size="small"
            startIcon={<FontAwesomeIcon icon={faPlay} aria-hidden="true" />}
            onClick={() => void start()}
            aria-disabled={pending !== undefined}
            data-testid="lifecycle-start"
          >
            {pending === 'live' ? 'Starting…' : 'Start exercise'}
          </CobraPrimaryButton>
        )}

        {canEnd && (
          <CobraSecondaryButton
            size="small"
            startIcon={<FontAwesomeIcon icon={faStop} aria-hidden="true" />}
            onClick={openEndConfirm}
            aria-haspopup="dialog"
            aria-disabled={pending !== undefined}
            data-testid="lifecycle-end"
          >
            End exercise
          </CobraSecondaryButton>
        )}

        {loadPhase === 'error' && (
          <Typography
            role="alert"
            component="span"
            data-testid="lifecycle-load-error"
            sx={{ fontSize: 12, display: 'inline-flex', gap: 0.75, alignItems: 'center' }}
          >
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
            <span>
              <strong>Exercise state unavailable.</strong> {loadError}
            </span>
            <CobraLinkButton size="small" onClick={reload} data-testid="lifecycle-retry">
              Retry
            </CobraLinkButton>
          </Typography>
        )}

        {inlineError !== undefined && (
          <Typography
            role="alert"
            component="span"
            data-testid="lifecycle-error"
            sx={{ fontSize: 12, display: 'inline-flex', gap: 0.75, alignItems: 'center' }}
          >
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
            <span>
              <strong>The exercise state was not changed.</strong> {inlineError}
            </span>
          </Typography>
        )}

        {/* Always mounted, so a later change is announced (a live region present at mount is
            what assistive technology watches). Empty until a transition succeeds, and again
            STATUS_CLEAR_MS after. */}
        <Typography
          role="status"
          aria-live="polite"
          component="span"
          data-testid="lifecycle-status"
          sx={{ fontSize: 12, fontWeight: 600 }}
        >
          {statusText}
        </Typography>
      </Stack>

      {confirmingEnd && (
        <EndExerciseDialog
          exerciseName={exerciseName}
          pending={pending === 'completed'}
          error={transitionError}
          onConfirm={() => void end()}
          onCancel={cancelEnd}
        />
      )}
    </>
  )
}
