/**
 * features/exerciseLifecycleAdmin/components/ExerciseStatusBadge.tsx
 * ---------------------------------------------------------------------------
 * The lifecycle-status cell of the org exercise list (feature:
 * exercise-lifecycle-admin, story 02 AC2 — COR-032, NFR-001).
 *
 * ## NEVER COLOUR-ONLY (NFR-001, D0 §4.1)
 * Every badge renders a FontAwesome icon AND a word. The colour is decoration
 * laid on top of both; remove all colour and the state is still fully legible,
 * both on screen and to a screen reader. There is no state whose only signal is
 * a hue, and none may be added.
 *
 * ## Why this does not reuse `staffShell/statePillConfig.ts`
 * That map exists and is exhaustive — but its colours are deliberately
 * "navy-safe": they are calibrated for the 56px `#1e3a5f` staff header the
 * exercise-state pill lives in, and its own header says the base COBRA palette
 * hues would render muddy there. This badge renders on the LIGHT work-area
 * background, where the opposite is true. Reusing those accents here would
 * import a contrast decision made for a different surface. The LABELS below are
 * kept identical to that map's on purpose, so a planner reading "STAGED" in the
 * header and "Staged" in this table is reading about the same state.
 *
 * ## Unrecognised statuses render as unrecognised — not as a guess, and not as
 * ## a blank surface
 * The backend canonicalizes legacy literals but emits an unknown one VERBATIM,
 * so the client can refuse it. Refusing the whole RESPONSE, though, would mean
 * one odd row blanks the organization's entire portfolio — the exact
 * backend-ahead-deploy failure `core/exerciseContext/exerciseContextResolver.ts`
 * warns about. So the refusal is scoped to the ROW: an unrecognised literal gets
 * a warning icon, the words "Unrecognised status", and the raw literal itself,
 * which is honest about what is known and leaves the other rows readable.
 *
 * World: STAFF (COBRA). Colours are COBRA palette tokens or AA-checked literals
 * on the light work area; icons are FontAwesome only.
 */

import { Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBoxArchive,
  faCircleCheck,
  faCirclePause,
  faCirclePlay,
  faHourglassHalf,
  faPenRuler,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { isExerciseStatus, type ExerciseStatus } from '@/core/exerciseContext'

interface StatusPresentation {
  /** The REQUIRED text half — the state is never conveyed by colour alone. */
  readonly label: string
  readonly icon: IconDefinition
  /** Text + icon colour. AA-contrast on the COBRA light work area. */
  readonly color: string
  readonly background: string
  readonly borderColor: string
}

/** Pre-conduct / ended states: deliberately unemphasised, slate on light grey. */
const QUIET: Pick<StatusPresentation, 'color' | 'background' | 'borderColor'> = {
  color: '#41505f',
  background: 'rgba(65, 80, 95, 0.08)',
  borderColor: 'rgba(65, 80, 95, 0.28)',
}

/** Running. Green at 4.9:1 on white. */
const RUNNING: Pick<StatusPresentation, 'color' | 'background' | 'borderColor'> = {
  color: '#1d6f4a',
  background: 'rgba(29, 111, 74, 0.10)',
  borderColor: 'rgba(29, 111, 74, 0.35)',
}

/** Waiting / held. The same brown-amber `notifications.warningText` register (7.4:1 on white). */
const WAITING: Pick<StatusPresentation, 'color' | 'background' | 'borderColor'> = {
  color: '#6F4E37',
  background: 'rgba(111, 78, 55, 0.10)',
  borderColor: 'rgba(111, 78, 55, 0.35)',
}

/**
 * Every status the wire can carry, keyed by the TRANSITIONAL SUPERSET
 * `ExerciseStatus` (exercise-configuration story 01a): the COR-032 six plus the
 * legacy four still valid through the transition. Exhaustive by its `Record`
 * type — a status the backend can emit always has a word, never a bare colour.
 *
 * The legacy literals are pure ALIASES of their COR-032 replacement
 * (`active` ≡ `live`, `scheduled` ≡ `staged`, `complete` ≡ `completed`), so no
 * new vocabulary is coined here.
 */
const STATUS_PRESENTATION: Record<ExerciseStatus, StatusPresentation> = {
  build: { label: 'Build', icon: faPenRuler, ...QUIET },
  staged: { label: 'Staged', icon: faHourglassHalf, ...WAITING },
  live: { label: 'Live', icon: faCirclePlay, ...RUNNING },
  paused: { label: 'Paused', icon: faCirclePause, ...WAITING },
  completed: { label: 'Completed', icon: faCircleCheck, ...QUIET },
  archived: { label: 'Archived', icon: faBoxArchive, ...QUIET },
  // Legacy aliases, valid through the transition.
  scheduled: { label: 'Staged', icon: faHourglassHalf, ...WAITING },
  active: { label: 'Live', icon: faCirclePlay, ...RUNNING },
  complete: { label: 'Completed', icon: faCircleCheck, ...QUIET },
}

/**
 * The row-level refusal. Not a guessed state and not a thrown response — see the
 * module header. `#b22222` is COBRA's `notifications.errorText` (6.7:1 on white).
 */
const UNRECOGNISED: StatusPresentation = {
  label: 'Unrecognised status',
  icon: faTriangleExclamation,
  color: '#b22222',
  background: 'rgba(178, 34, 34, 0.08)',
  borderColor: 'rgba(178, 34, 34, 0.35)',
}

/**
 * Resolves a raw wire literal to its presentation. A plain function (not an
 * inline ternary at the call site) so TypeScript narrows `status` through the
 * guard — the narrowing IS the safety property here, and an index into
 * `STATUS_PRESENTATION` that needed a cast would mean the guard was not
 * actually doing its job.
 */
function resolvePresentation(
  status: string,
): { readonly known: boolean, readonly presentation: StatusPresentation } {
  if (isExerciseStatus(status)) {
    return { known: true, presentation: STATUS_PRESENTATION[status] }
  }
  return { known: false, presentation: UNRECOGNISED }
}

export interface ExerciseStatusBadgeProps {
  /** The RAW wire literal. Unrecognised values are rendered as such, not guessed. */
  readonly status: string
}

/**
 * One exercise's lifecycle state, as icon + word (+ colour, as decoration only).
 * See the module header for the unrecognised-status rule.
 */
export function ExerciseStatusBadge({ status }: ExerciseStatusBadgeProps) {
  const { known, presentation } = resolvePresentation(status)

  return (
    <Stack
      direction="row"
      component="span"
      data-testid={`exercise-status-${known ? status : 'unknown'}`}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.625,
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid',
        borderColor: presentation.borderColor,
        backgroundColor: presentation.background,
        color: presentation.color,
        maxWidth: '100%',
      }}
    >
      <FontAwesomeIcon icon={presentation.icon} aria-hidden fixedWidth />
      <Typography
        component="span"
        variant="caption"
        sx={{ fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}
      >
        {presentation.label}
      </Typography>
      {known ? null : (
        // The raw literal, so a staff human can report exactly what the server
        // said instead of "it showed a warning".
        <Typography
          component="span"
          variant="caption"
          sx={{ fontWeight: 400, whiteSpace: 'nowrap' }}
        >
          ({status})
        </Typography>
      )}
    </Stack>
  )
}
