/**
 * features/planner/components/StageExerciseControl.tsx
 * ---------------------------------------------------------------------------
 * The planner's **Stage exercise** control (feature: exercise-build-golive, story 04 - gated
 * go-live + StartEx; COR-032 / COR-042; NFR-001). Mounted directly under `ReadinessPanel` in the
 * Readiness section of `ExerciseSettingsPage` (`/staff/plan`). STAFF world: COBRA, FontAwesome
 * only, MUI 9 `sx`-only. The page itself is planner-only, so no extra role gate lives here (the
 * server still answers 403 to a non-planner stage).
 *
 * WHAT IT SHOWS, by lifecycle state (read through the EXISTING controller lifecycle hook -
 * `useExerciseLifecycle`; extended, not forked):
 *   - `build`     the **Stage exercise** button;
 *   - `staged`    "This exercise is staged. A controller starts it from the console.";
 *   - `live` / `paused` / `completed` / `archived`  one status sentence, no button.
 *
 * DISABLED WITH A REASON. While the readiness read says any blocking item is `open` (or readiness
 * is loading / failed, or the server's `ready` disagrees), the button is `aria-disabled` - still
 * focusable, press ignored - and the reason sits beside it as visible text and is wired through
 * `aria-describedby`. Ready: it opens the confirm dialog (`StageExerciseDialog`).
 *
 * THE SERVER IS THE AUTHORITY. If staging is refused anyway (409 `readiness-blocking`, a race
 * with another planner), the dialog stays open and lists the items the server named, and
 * readiness is refetched so the panel above and the button below catch up.
 *
 * ON SUCCESS: the lifecycle and readiness queries are invalidated, the dialog closes, "Exercise
 * staged." is announced in a polite live region (always mounted), and focus moves to this
 * control's group - the Stage button that held it is gone.
 *
 * Scenario time (COR-053): not applicable - staff world, no timestamps.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleExclamation,
  faLayerGroup,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { Box, Stack, Typography } from '@mui/material'
import { CobraLinkButton, CobraPrimaryButton } from '@/theme/styledComponents'
import { useActiveExerciseInternalName } from '@/features/staff/hooks/useActiveExerciseInternalName'
import { useExerciseLifecycle } from '@/features/controller/lifecycle/useExerciseLifecycle'
import type { LifecycleState } from '@/features/controller/lifecycle/lifecycleService'
import { READINESS_QUERY_KEY, useReadiness } from '../hooks/useReadiness'
import { StageExerciseDialog } from './StageExerciseDialog'

/** One sentence per non-build state (the control offers nothing to press there). */
const STATE_SENTENCE: Readonly<Record<Exclude<LifecycleState, 'build'>, string>> = {
  staged: 'This exercise is staged. A controller starts it from the console.',
  live: 'This exercise is live.',
  paused: 'This exercise is live and currently paused.',
  completed: 'This exercise has ended.',
  archived: 'This exercise is archived.',
}

/** What the live region says after a successful stage. */
export const STAGED_ANNOUNCEMENT = 'Exercise staged.'

const REASON_ID = 'stage-exercise-reason'

export function StageExerciseControl() {
  const lifecycle = useExerciseLifecycle()
  const readiness = useReadiness()
  const queryClient = useQueryClient()
  // Staff world: the INTERNAL name (story 09), never the participant-facing scope name.
  const exerciseName = useActiveExerciseInternalName()
  const [open, setOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [focusGroupOnClose, setFocusGroupOnClose] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)

  const { state, allowedTransitions, loadPhase, loadError, pending, transitionError } = lifecycle
  const { transitionBlocking, transition, clearError, reload } = lifecycle

  // A failed refetch keeps stale data in the cache; never treat it as current.
  const data = readiness.isError ? undefined : readiness.data
  const openBlocking = data?.blocking.filter(item => item.status === 'open').length
  const ready = data !== undefined && data.ready && openBlocking === 0

  // The server named blocking items (a race): make the panel and button catch up.
  useEffect(() => {
    if (transitionBlocking !== undefined) {
      void queryClient.invalidateQueries({ queryKey: READINESS_QUERY_KEY })
    }
  }, [transitionBlocking, queryClient])

  const blockedReason = ((): string | undefined => {
    if (ready) return undefined
    if (readiness.isError) return 'Readiness could not be loaded, so staging is unavailable.'
    if (data === undefined) return 'Checking readiness…'
    if (openBlocking !== undefined && openBlocking > 0) {
      return `Staging is unavailable: ${openBlocking} blocking ${
        openBlocking === 1 ? 'item is' : 'items are'
      } still open.`
    }
    return 'Staging is unavailable: the server does not yet report this exercise as ready.'
  })()

  const openDialog = () => {
    if (blockedReason !== undefined) return
    clearError()
    setOpen(true)
  }

  const cancel = useCallback(() => {
    clearError()
    setOpen(false)
  }, [clearError])

  // Focus moves to this control's group only AFTER the dialog (and its focus trap's restore to a
  // trigger that no longer exists) has unmounted; focusing earlier is undone by the trap.
  useEffect(() => {
    if (!open && focusGroupOnClose) {
      groupRef.current?.focus()
      setFocusGroupOnClose(false)
    }
  }, [open, focusGroupOnClose])

  const confirm = async () => {
    if (pending !== undefined) return
    if (await transition('staged')) {
      void queryClient.invalidateQueries({ queryKey: READINESS_QUERY_KEY })
      reload()
      setOpen(false)
      setAnnouncement(STAGED_ANNOUNCEMENT)
      // The Stage button that held focus is gone: keep focus inside this control (effect above).
      setFocusGroupOnClose(true)
    }
  }

  const canStage = state === 'build' && allowedTransitions.includes('staged')

  return (
    <Box
      ref={groupRef}
      component="section"
      role="group"
      aria-label="Stage exercise"
      tabIndex={-1}
      data-testid="stage-exercise-control"
      sx={{ maxWidth: 860, outline: 'none', paddingBottom: 3 }}
    >
      <Stack sx={{ gap: 1, alignItems: 'flex-start' }}>
        {loadPhase === 'loading' && (
          <Typography variant="body2">Checking the exercise state…</Typography>
        )}

        {loadPhase === 'error' && (
          <Stack
            role="alert"
            data-testid="stage-load-error"
            direction="row"
            sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
            <Typography variant="body2">
              <strong>Exercise state unavailable.</strong> {loadError}
            </Typography>
            <CobraLinkButton size="small" onClick={reload}>
              Retry
            </CobraLinkButton>
          </Stack>
        )}

        {canStage && (
          <>
            <CobraPrimaryButton
              startIcon={<FontAwesomeIcon icon={faLayerGroup} aria-hidden="true" />}
              onClick={openDialog}
              aria-haspopup="dialog"
              aria-disabled={blockedReason !== undefined}
              aria-describedby={blockedReason !== undefined ? REASON_ID : undefined}
              sx={{ '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' } }}
              data-testid="stage-exercise-button"
            >
              Stage exercise
            </CobraPrimaryButton>
            <Typography
              id={REASON_ID}
              variant="body2"
              data-testid="stage-exercise-reason"
              sx={{ display: 'flex', gap: 1, alignItems: 'center' }}
            >
              <FontAwesomeIcon
                icon={blockedReason === undefined ? faCircleCheck : faTriangleExclamation}
                aria-hidden="true"
              />
              <span>{blockedReason ?? 'All blocking items are done. This exercise can be staged.'}</span>
            </Typography>
          </>
        )}

        {state !== undefined && state !== 'build' && (
          <Typography variant="body2" data-testid="stage-exercise-state">
            {STATE_SENTENCE[state]}
          </Typography>
        )}

        {!open && transitionError !== undefined && (
          <Stack
            role="alert"
            direction="row"
            data-testid="stage-inline-error"
            sx={{ alignItems: 'flex-start', gap: 1 }}
          >
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
            <Typography variant="body2">
              <strong>The exercise was not staged.</strong> {transitionError}
            </Typography>
          </Stack>
        )}

        {/* Always mounted so a later announcement is read out. */}
        <Typography
          role="status"
          aria-live="polite"
          variant="body2"
          data-testid="stage-exercise-status"
          sx={{ fontWeight: 600 }}
        >
          {announcement}
        </Typography>
      </Stack>

      {open && (
        <StageExerciseDialog
          exerciseName={exerciseName}
          openBlocking={openBlocking}
          pending={pending === 'staged'}
          error={transitionError}
          blocking={transitionBlocking}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      )}
    </Box>
  )
}
