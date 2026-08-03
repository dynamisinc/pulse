/**
 * features/staff/components/ExerciseSwitcher.tsx
 * ---------------------------------------------------------------------------
 * The staff cross-exercise switcher (feature: exercise-isolation, story 05 —
 * "Staff cross-exercise switcher (staff-only)"; COR-005, D5-012(g); see
 * docs/features/exercise-isolation/05-staff-cross-exercise-switcher.md).
 *
 * A staff member (controller/evaluator/planner) may hold assignments across
 * several exercises. This is the PRE-CONDUCT control that lists those
 * assignments (`GET /api/staff/assignments`) and lets the staff member pick a
 * different one (`POST /api/staff/active-exercise`), which re-scopes every
 * subsequent staff query SERVER-SIDE (the staff arm of the COR-001 scope
 * seam, built on exercise-isolation/01; identity-auth-roles/05 owns the
 * backend contract).
 *
 * TWO WORLDS (D0 §2 / CLAUDE.md) — STAFF world only. COBRA look via
 * `@/theme/styledComponents`-adjacent tokens (`CobraStyles`) + FontAwesome
 * icons only; MUI system props go through `sx` (MUI 9). This component must
 * NEVER be mounted on a participant path (XC-002) — it is exported ONLY from
 * `features/staff`, a staff-only feature folder never imported by a
 * participant surface. It renders inside a COBRA `ThemeProvider` +
 * `ExerciseContextProvider` + a React Query `QueryClientProvider` (the later
 * `app-shell/01` story mounts it into a pre-conduct staff route) — this
 * component owns only itself, its hooks, and its service, never the route
 * table.
 *
 * OUT OF SCOPE (see the story's "Out of Scope" + D5-012(g)): the LIVE-CONDUCT
 * static identity badge is a DIFFERENT surface (`console-shell/03`,
 * `StaffHeader`'s identity badge) — this component is not that badge and
 * never renders it. Whether/where to mount THIS switcher vs. that badge is
 * the composing route's decision, not logic inside this file — this
 * component does not gate its own visibility by exercise lifecycle status.
 *
 * DATA SOURCE (make-real, identity-auth-roles/05): `useStaffAssignments()`
 * lists the caller's own assignments; `useSetActiveExercise()` wraps the
 * switch mutation. The CURRENTLY ACTIVE exercise is read from
 * `useExerciseContext()` (the frozen `core/exerciseContext` seam — the same
 * scope every other staff surface, e.g. `StaffHeader`, already consumes) and
 * matched against the assignment list by `exerciseId`. See
 * `../services/staffAssignmentsService.ts` for the mock seam
 * (`USE_MOCK_DATA`) that lets this render fully with no backend.
 *
 * SCOPE REFRESH (staff-navigation/04, COR-073 — the follow-up this header used
 * to flag as a KNOWN LIMITATION, now built): `ExerciseContextProvider` is no
 * longer mount-once. `useSetActiveExercise` re-resolves the scope FROM THE
 * SERVER on success and commits it atomically, so every `useExerciseContext()`
 * consumer — `StaffHeader`'s exercise-name badge above all — follows a switch
 * with no page reload and no remount. See that hook's header for the
 * cancel → re-resolve → commit → reset ordering guarantee.
 *
 * WHY `justSwitchedTo` SURVIVES (it is no longer the mechanism, and no longer
 * a workaround for a missing one): the switch mutation's own 200 response is
 * the server's statement of which assignment is now active, and this component
 * shows it as a LOCAL, PROVISIONAL echo so THIS control confirms the action it
 * just performed. It is superseded the instant the provider re-resolves to a
 * different exercise (see the convergence effect below), so the echo can never
 * out-live or contradict the authoritative scope. Two reasons to keep it:
 *  - it is server-sourced (the POST response body), never a client assertion;
 *  - under `USE_MOCK_DATA` the mock `/exercise-context` adapter is stateless
 *    and always re-resolves to the same canned exercise, so in dev/UAT it is
 *    the only true statement of the switch available to this row. FLAGGED: the
 *    mock `/staff/active-exercise` and mock `/exercise-context` adapters do not
 *    share a fake session, so a mock-mode switch does not move the header
 *    badge. That is a mock-seam gap, not a gap in this mechanism (against a
 *    real backend the badge moves) — worth a follow-up story.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA):
 *  - The whole control has an accessible name (`aria-labelledby` to its own
 *    visible heading) and the assignment list is a real `<ul>` with its own
 *    `aria-label`.
 *  - The active exercise is marked with `aria-current="true"` PLUS a visible
 *    icon (a check mark) and an "ACTIVE" text badge — never color alone.
 *  - Every non-active assignment is a real, native `<button>` — reachable by
 *    Tab, activatable with Enter/Space, with an explicit accessible name
 *    ("Switch to {name} ({role})") — no custom roving-tabindex/listbox needed
 *    for a short, non-searchable list.
 *  - Loading/switching states are `role="status"`/`aria-live="polite"`;
 *    errors are `role="alert"` and pair an icon with text (never color only).
 *
 * CONTENT SECURITY (NFR-004): exercise names are rendered as React text nodes
 * ({value}), which React escapes — this component never uses
 * `dangerouslySetInnerHTML`.
 *
 * SCENARIO TIME (COR-053): not applicable — staff world, no timestamps here.
 */

import { useEffect, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faRightLeft, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { useExerciseContext } from '@/core/exerciseContext'
import { useStaffAssignments } from '../hooks/useStaffAssignments'
import { useSetActiveExercise } from '../hooks/useSetActiveExercise'
import type { StaffAssignmentError } from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'

/** A `role="alert"` block pairing an icon with a message (never color alone). */
function SwitcherAlert({ message, testId }: { message: string; testId: string }) {
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

/** Maps a thrown assignment-seam error to clear, status-aware staff-facing copy. */
function friendlyErrorMessage(error: StaffAssignmentError, fallback: string): string {
  switch (error.status) {
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'You are not assigned to that exercise.'
    case 400:
      return error.serverMessage
        ? `That exercise could not be selected: ${error.serverMessage}`
        : 'That exercise could not be selected.'
    default:
      return error.status === undefined
        ? 'Could not reach the server. Check your connection and try again.'
        : (error.serverMessage ?? fallback)
  }
}

/**
 * Compares two exercise ids for identity, CASE-INSENSITIVELY. An exercise id is
 * an opaque GUID string on the wire, but the API surface has historically
 * emitted it in mixed casing (SQL Server materializes a `uniqueidentifier` to
 * an UPPERCASE string when `.ToString()` runs server-side inside a query, vs.
 * .NET's lowercase `Guid.ToString()` after materialization). The
 * `/api/staff/assignments`, `/api/session`, and `/api/exercise-context`
 * responses must all agree for the active row to be marked correctly; comparing
 * case-insensitively here is a defensive backstop so a future casing drift on
 * any of them can never silently mis-mark the active exercise as switchable.
 */
function sameExercise(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

interface AssignmentRowProps {
  assignment: StaffAssignment
  isActive: boolean
  disabled: boolean
  onSelect: () => void
}

/** One row: a static "ACTIVE" row, or a real, switchable button. */
function AssignmentRow({ assignment, isActive, disabled, onSelect }: AssignmentRowProps) {
  const roleLabel = assignment.role.toUpperCase()

  if (isActive) {
    return (
      <Stack
        component="li"
        data-testid={`exercise-switcher-row-${assignment.exerciseId}`}
        aria-current="true"
        direction="row"
        sx={{
          alignItems: 'center',
          gap: 1.5,
          px: 1.5,
          py: 1,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'success.main',
          bgcolor: 'action.selected',
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'success.main' }}>
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
          <Typography
            data-testid={`exercise-switcher-active-badge-${assignment.exerciseId}`}
            sx={{ fontSize: '0.6875rem', fontWeight: 800, letterSpacing: '0.06em' }}
          >
            ACTIVE
          </Typography>
        </Stack>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.875rem' }}>
            {assignment.exerciseName}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{roleLabel}</Typography>
        </Stack>
      </Stack>
    )
  }

  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <Box
        component="button"
        type="button"
        onClick={onSelect}
        disabled={disabled}
        data-testid={`exercise-switcher-switch-button-${assignment.exerciseId}`}
        aria-label={`Switch to ${assignment.exerciseName} (${roleLabel})`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          px: 1.5,
          py: 1,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'transparent',
          color: 'text.primary',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          font: 'inherit',
          textAlign: 'left',
          '&:hover': disabled ? undefined : { bgcolor: 'action.hover', borderColor: 'primary.main' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
        }}
      >
        <FontAwesomeIcon icon={faRightLeft} aria-hidden />
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
            {assignment.exerciseName}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{roleLabel}</Typography>
        </Stack>
      </Box>
    </Box>
  )
}

/**
 * The staff cross-exercise switcher. Self-contained COBRA staff surface:
 * lists the caller's exercise assignments, highlights the currently active
 * one, and lets the caller pick a different one. See module header for the
 * full contract. Requires an `<ExerciseContextProvider>` ancestor (via
 * `useExerciseContext()`) and a React Query `QueryClientProvider`.
 */
export function ExerciseSwitcher() {
  const scope = useExerciseContext()
  const assignmentsQuery = useStaffAssignments()
  const switchMutation = useSetActiveExercise()
  // See module header "WHY `justSwitchedTo` SURVIVES": a PROVISIONAL, local echo
  // of the switch response — never the mechanism, never authoritative.
  const [justSwitchedTo, setJustSwitchedTo] = useState<StaffAssignment | null>(null)

  // CONVERGENCE. The moment the provider re-resolves to a different exercise,
  // the server-resolved scope is the only truth this row may show — drop the
  // echo so the two can never disagree (a switcher insisting on exercise X
  // while the header badge reads Y is exactly the mixed-scope confusion
  // COR-073 exists to remove).
  useEffect(() => {
    setJustSwitchedTo(null)
  }, [scope.exerciseId])

  const activeExerciseId = justSwitchedTo?.exerciseId ?? scope.exerciseId

  const handleSelect = (assignment: StaffAssignment) => {
    if (sameExercise(assignment.exerciseId, activeExerciseId) || switchMutation.isPending) return
    switchMutation.mutate(assignment.exerciseId, {
      onSuccess: switched => setJustSwitchedTo(switched),
    })
  }

  return (
    <Box
      component="section"
      aria-labelledby="exercise-switcher-heading"
      data-testid="exercise-switcher"
      sx={{ padding: CobraStyles.Padding.MainWindow, maxWidth: 480 }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={faRightLeft} aria-hidden />
        <Typography id="exercise-switcher-heading" variant="h6" sx={{ fontWeight: 700 }}>
          Active exercise
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Choose which exercise your staff session is scoped to. Switching applies immediately.
      </Typography>

      {assignmentsQuery.isPending ? (
        <Stack
          direction="row"
          role="status"
          data-testid="exercise-switcher-loading"
          sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}
        >
          <CircularProgress size={16} />
          <Typography variant="body2">Loading your exercise assignments…</Typography>
        </Stack>
      ) : null}

      {assignmentsQuery.isError ? (
        <SwitcherAlert
          testId="exercise-switcher-load-error"
          message={friendlyErrorMessage(
            assignmentsQuery.error,
            'Could not load your exercise assignments.',
          )}
        />
      ) : null}

      {assignmentsQuery.isSuccess ? (
        assignmentsQuery.data.length === 0 ? (
          <Typography
            variant="body2"
            data-testid="exercise-switcher-empty"
            sx={{ color: 'text.secondary' }}
          >
            No exercise assignments found for your account.
          </Typography>
        ) : (
          <Box
            component="ul"
            aria-label="Your exercise assignments"
            data-testid="exercise-switcher-list"
            sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {assignmentsQuery.data.map(assignment => (
              <AssignmentRow
                key={assignment.exerciseId}
                assignment={assignment}
                isActive={sameExercise(assignment.exerciseId, activeExerciseId)}
                disabled={switchMutation.isPending}
                onSelect={() => handleSelect(assignment)}
              />
            ))}
          </Box>
        )
      ) : null}

      {switchMutation.isPending ? (
        <Stack
          direction="row"
          role="status"
          aria-live="polite"
          data-testid="exercise-switcher-switching"
          sx={{ alignItems: 'center', gap: 1, mt: 1.5, color: 'text.secondary' }}
        >
          <CircularProgress size={14} />
          <Typography variant="body2">Switching active exercise…</Typography>
        </Stack>
      ) : null}

      {switchMutation.isError ? (
        <SwitcherAlert
          testId="exercise-switcher-switch-error"
          message={friendlyErrorMessage(
            switchMutation.error,
            'Could not switch your active exercise.',
          )}
        />
      ) : null}

      {switchMutation.isSuccess && !switchMutation.isPending ? (
        <Typography
          role="status"
          aria-live="polite"
          data-testid="exercise-switcher-switch-success"
          variant="body2"
          sx={{ mt: 1.5, color: 'success.main', fontWeight: 600 }}
        >
          Switched to {switchMutation.data.exerciseName}.
        </Typography>
      ) : null}
    </Box>
  )
}
