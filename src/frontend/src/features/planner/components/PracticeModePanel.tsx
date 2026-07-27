/**
 * features/planner/components/PracticeModePanel.tsx
 * ---------------------------------------------------------------------------
 * The staff-console PRACTICE / SANDBOX control (feature: exercise-configuration,
 * story 04 — "Practice/sandbox flag"; COR-033; issue #41 / story #70). A planner
 * marks an exercise as a rehearsal — a load test, a controller dry-run — so its
 * data is excluded from evaluation exports and never pollutes the AAR.
 *
 * TWO WORLDS — this is the STAFF world (D0 §2 / CLAUDE.md). COBRA look via
 * `@/theme/styledComponents` + `CobraStyles`, rendered inside the app's COBRA
 * `ThemeProvider`. Icons are FontAwesome only; MUI system props go through `sx`
 * (MUI 9). There is no `CobraCheckbox`, so the raw MUI `Checkbox` is used —
 * matching the shipped `ExerciseSettingsPanel` precedent.
 *
 * PRACTICE STATE IS STAFF-WORLD ONLY (XC-002). It appears on no participant
 * surface: the server's participant read model structurally omits the flag, and
 * nothing in this file is imported by a participant surface. A participant in a
 * rehearsal must experience it exactly as real conduct.
 *
 * ============================================================================
 * THE INDICATOR IS NEVER COLOR-ONLY (NFR-001, WCAG 2.1 AA)
 * ============================================================================
 * A rehearsal mistaken for real conduct is the failure this panel exists to
 * prevent, so the state is carried by a FontAwesome ICON **and** a text label —
 * the color is decoration on top of both, never the signal itself. The indicator
 * is a `role="status"` region so a screen reader is told when the state changes,
 * and the checkbox is a real labeled control whose helper text is bound with
 * `aria-describedby`. Load, save-success and every failure are each announced
 * with an icon + text as well.
 *
 * COLOR TOKENS — COBRA-NATIVE ONLY, AND MEASURED (gate-1 finding WR-001).
 * The indicator originally used `warning.main` / `warning.dark`. `cobraTheme`
 * never defines `palette.warning`, so those resolved to STOCK MUI (#ed6c02 /
 * #e65100) — a default-MUI palette leak onto a COBRA surface, and at 3.79:1 on
 * `background.paper` a real WCAG 2.1 AA failure for this ~14px `body2` copy.
 * The COBRA-native replacements are measured against both staff backgrounds:
 *
 *   notifications.warningText #6F4E37 -> 7.44:1 on #ffffff, 7.01:1 on #f8f8f8
 *   notifications.successText #008000 -> 5.14:1 on #ffffff, 4.84:1 on #f8f8f8
 *
 * Both clear the 4.5:1 AA floor for normal-size text on either background.
 * NOTE the border deliberately reuses these SAME `*Text` tokens rather than the
 * `notifications.warning` / `notifications.success` pair: those two are pale
 * FILL tints (#F9F9BE / #AEFBB8, cf. `HomePage.tsx` using them as `bgcolor`)
 * and would render a 1.09:1 / 1.21:1 border — invisible, silently erasing the
 * outline of the one block on this page that must be unmissable. Do not "fix"
 * them back to the tints without also giving the block a matching background,
 * and if you do, re-measure: #008000 on #AEFBB8 is only 4.23:1 and FAILS AA.
 *
 * WHAT THE FLAG DOES — AND DELIBERATELY DOES NOT DO. It changes evaluation
 * eligibility and nothing else: channels, engine and telemetry all behave
 * exactly as in real conduct, because a rehearsal that behaves differently is
 * not a rehearsal. `evaluationEligible` is the SERVER's own answer, read from
 * the single `IEvaluationEligibility` seam a future evaluation export (E10) will
 * filter on — this panel renders that value and never re-derives it, so the
 * console and the export can never disagree.
 *
 * SELF-CONTAINED BY CONTRACT. It owns its hook, its service, its query and all
 * of its states, so `ExerciseSettingsPage` mounts it with a single `<PracticeModePanel />`
 * and no prop threaded through (implementation.md -> "Integration seams").
 *
 * SCENARIO TIME (COR-053): not applicable — staff world, no in-fiction time.
 */

import { useState } from 'react'
import { Box, Checkbox, CircularProgress, FormControlLabel, FormHelperText, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faFlask,
  faFloppyDisk,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { usePracticeMode, useSetPracticeMode } from '../hooks/usePracticeMode'
import type { PracticeModeError, PracticeModeState } from '../services/practiceModeService'

/** Maps a thrown practice-mode error to clear, status-aware staff-facing copy. */
function friendlyErrorMessage(error: PracticeModeError, verb: 'loaded' | 'saved'): string {
  switch (error.status) {
    case 400:
      return error.serverMessage
        ? `Practice mode was not changed: ${error.serverMessage}`
        : 'That change was rejected and nothing was saved. Try again.'
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'Your staff account is not assigned to this exercise.'
    case 404:
      return 'This exercise no longer exists. Pick another exercise and try again.'
    default:
      return error.status === undefined
        ? `Pulse could not be reached, so practice mode was not ${verb}. Check your connection and try again.`
        : (error.serverMessage ?? `Practice mode was not ${verb}. Try again.`)
  }
}

/** A `role="alert"` block pairing an icon with a message (never color-only). */
function PracticeAlert({ message, testId }: { message: string; testId: string }) {
  return (
    <Stack
      role="alert"
      direction="row"
      data-testid={testId}
      sx={{ alignItems: 'flex-start', gap: 1, color: 'error.main', mt: 1.5 }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2">{message}</Typography>
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// The indicator — the NFR-001 centerpiece
// ---------------------------------------------------------------------------

interface PracticeModeIndicatorProps {
  readonly state: PracticeModeState
}

/**
 * States the exercise's practice/sandbox condition with an ICON **and** a TEXT
 * label, plus a sentence naming the consequence. Color is applied on top of
 * both and carries no information of its own, so the state survives a
 * monochrome display, a color-blind reader and a screen reader alike.
 */
function PracticeModeIndicator({ state }: PracticeModeIndicatorProps) {
  const practice = state.isPracticeMode

  return (
    <Stack
      role="status"
      direction="row"
      data-testid="practice-mode-indicator"
      sx={{
        alignItems: 'flex-start',
        gap: 1,
        mt: 1.5,
        padding: '10px 12px',
        border: '1px solid',
        borderColor: practice ? 'notifications.warningText' : 'notifications.successText',
        borderRadius: 1,
        color: practice ? 'notifications.warningText' : 'notifications.successText',
      }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={practice ? faFlask : faCircleCheck} aria-hidden />
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {practice ? 'Practice / sandbox' : 'Real conduct'}
        </Typography>
        <Typography variant="body2" data-testid="practice-mode-eligibility">
          {state.evaluationEligible
            ? 'This exercise is not a rehearsal. Its data is included in evaluation exports.'
            : 'This exercise is a rehearsal. Its data is excluded from evaluation exports.'}
        </Typography>
      </Box>
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// The control (mounted once the state has loaded)
// ---------------------------------------------------------------------------

interface PracticeModeControlProps {
  readonly state: PracticeModeState
}

function PracticeModeControl({ state }: PracticeModeControlProps) {
  const save = useSetPracticeMode()

  // Re-sync from the SERVER's state whenever a new projection arrives — the
  // documented React "adjust state when a prop changes" pattern, no effect and
  // no flash of a stale checkbox. After a save the mutation seeds the query
  // cache with the response, which is how "render from the response, not from
  // local state" happens here.
  const [syncedFrom, setSyncedFrom] = useState<PracticeModeState>(state)
  const [checked, setChecked] = useState<boolean>(state.isPracticeMode)
  if (syncedFrom !== state) {
    setSyncedFrom(state)
    setChecked(state.isPracticeMode)
  }

  const disabled = save.isPending
  const dirty = checked !== state.isPracticeMode

  return (
    <Box data-testid="practice-mode-form">
      <PracticeModeIndicator state={state} />

      <FormControlLabel
        sx={{ mt: 1.5 }}
        control={
          <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={event => {
              setChecked(event.target.checked)
              save.reset()
            }}
            slotProps={{ input: { 'aria-describedby': 'practice-mode-help' } }}
          />
        }
        label="Run this exercise as practice / sandbox"
      />
      <FormHelperText id="practice-mode-help">
        A practice run works exactly like real conduct: the same channels, the same injects, the
        same controller tools. The one difference is that nothing from it reaches evaluation
        exports.
      </FormHelperText>

      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
        <CobraPrimaryButton
          type="button"
          onClick={() => save.mutate({ isPracticeMode: checked })}
          disabled={disabled || !dirty}
          startIcon={
            save.isPending
              ? <CircularProgress size={16} color="inherit" />
              : <FontAwesomeIcon icon={faFloppyDisk} />
          }
        >
          {save.isPending ? 'Saving…' : 'Save practice mode'}
        </CobraPrimaryButton>
      </Stack>

      {save.isError ? (
        <PracticeAlert
          message={friendlyErrorMessage(save.error, 'saved')}
          testId="practice-mode-save-error"
        />
      ) : null}

      {save.isSuccess ? (
        <Stack
          role="status"
          direction="row"
          data-testid="practice-mode-saved"
          sx={{ alignItems: 'center', gap: 1, color: 'success.main', mt: 1.5 }}
        >
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
          <Typography variant="body2">
            Saved. The state above is what is now stored for this exercise.
          </Typography>
        </Stack>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The panel (query states + the control)
// ---------------------------------------------------------------------------

/**
 * The practice/sandbox panel. Self-contained COBRA staff surface: it loads the
 * resolved exercise's COR-033 flag, states it with an icon **and** text, and
 * writes it back. Mounted by `ExerciseSettingsPage` with a single JSX line and
 * no props.
 */
export function PracticeModePanel() {
  const practiceQuery = usePracticeMode()

  return (
    <Box
      component="section"
      aria-labelledby="practice-mode-heading"
      data-testid="practice-mode-panel"
      sx={{
        // See `ExerciseSettingsPanel`: the page's content pane already supplies
        // the outer padding, so only the bottom breathing room is kept here.
        paddingBottom: CobraStyles.Padding.MainWindow,
        maxWidth: 860,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={faFlask} aria-hidden />
        <Typography id="practice-mode-heading" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          Practice / sandbox
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        Mark this exercise as a rehearsal, such as a controller dry run or a load test. Rehearsal
        data stays out of evaluation exports and out of the after-action report. Participants see
        no difference.
      </Typography>

      {practiceQuery.isPending ? (
        <Stack
          role="status"
          direction="row"
          data-testid="practice-mode-loading"
          sx={{ alignItems: 'center', gap: 1, mt: 2 }}
        >
          <CircularProgress size={16} />
          <Typography variant="body2">Loading practice mode…</Typography>
        </Stack>
      ) : null}

      {practiceQuery.isError ? (
        <PracticeAlert
          message={friendlyErrorMessage(practiceQuery.error, 'loaded')}
          testId="practice-mode-load-error"
        />
      ) : null}

      {practiceQuery.isSuccess ? <PracticeModeControl state={practiceQuery.data} /> : null}
    </Box>
  )
}
