/**
 * features/exerciseLifecycleAdmin/pages/ExerciseManagementPage.tsx
 * ---------------------------------------------------------------------------
 * The EXERCISE MANAGEMENT surface (feature: exercise-lifecycle-admin, stories
 * 01 + 02 — COR-074/COR-075). Work-area content for the `/staff/exercises`
 * route; the shared staff shell (D7) owns the header and toolstrip, so this page
 * renders NO chrome and NO `<main>` of its own (the `#382` precedent — a second
 * `main` landmark gives a screen-reader user two "main" destinations for one
 * page). It owns the page's single `h1`.
 *
 * ## Who is here, and what they see
 * A PLANNER and an ORG-ADMIN both reach this surface (the two roles the server's
 * `ExerciseAdministrators` gate admits). The list is scoped to the caller's
 * ORGANIZATION, not to their assignments — an org-admin administers runs they
 * hold no `StaffAssignment` on, and a planner needs to see what already exists
 * before creating another. That is a different, strictly larger read than the
 * exercise switcher's own-only `GET /api/staff/assignments`, on purpose.
 *
 * ## The four states, all real
 *  - LOADING — a `role="status"` line, not a bare blank. It is not a spinner
 *    alone: "Loading…" is a word.
 *  - EMPTY — the FIRST-RUN case, and the one that matters most. An organization
 *    that has never created an exercise arrives here with nothing, and until
 *    this surface existed there was no way for them to get anywhere. So the
 *    empty state is not a shrug: it says what this list is for and points at the
 *    form directly above it.
 *  - ERROR — icon + words, with the server's own reason when it gave one, and an
 *    explicit retry. Never a blank table that reads as "you have no exercises",
 *    which is the dangerous misreading (an org-admin must not conclude their
 *    portfolio is empty because a read failed).
 *  - POPULATED — the table.
 *
 * ## XC-002 / COR-004
 * This is a staff surface and nothing about it is reachable from a participant
 * path: the registry entry it mounts under is only ever consulted after the
 * resolved role has been narrowed to a staff-surface role, and a participant
 * typing `/staff/exercises` still lands on their participant surface because the
 * participant branch never reads the URL at all.
 *
 * World: STAFF (COBRA). `@/theme/styledComponents` + `CobraStyles`; FontAwesome
 * only; MUI 9 `sx`-only system props.
 */

import { Box, Divider, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsRotate,
  faFolderOpen,
  faSpinner,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import { CreateExerciseForm } from '../components/CreateExerciseForm'
import { OrgExerciseTable } from '../components/OrgExerciseTable'
import { useOrgExercises } from '../hooks/useOrgExercises'

/** The first-run state. See the module header for why it is more than a shrug. */
function EmptyState() {
  return (
    <Stack
      data-testid="org-exercises-empty"
      sx={{
        alignItems: 'center',
        gap: 1,
        padding: '32px 16px',
        border: '1px dashed',
        borderColor: 'grid.main',
        borderRadius: 1,
        textAlign: 'center',
      }}
    >
      <Box sx={{ fontSize: 24, color: 'text.secondary' }}>
        <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Your organization has no exercises yet
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 520 }}>
        Everything your organization runs will be listed here — its name, where it is in the
        lifecycle, its hostname and when it was created. Create your first one using the form
        above; it starts in Build and you will be assigned to it straight away.
      </Typography>
    </Stack>
  )
}

/** The exercise-management work area. */
export function ExerciseManagementPage() {
  const exercises = useOrgExercises()

  return (
    <Box
      data-testid="exercise-management-page"
      sx={{
        padding: CobraStyles.Padding.MainWindow,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Exercise management
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 860 }}>
          Every exercise your organization owns, and the place to create a new one. You only ever
          see your own organization&rsquo;s exercises here.
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      <CreateExerciseForm />

      <Box component="section" aria-labelledby="org-exercise-list-heading">
        <Typography
          id="org-exercise-list-heading"
          variant="h6"
          component="h2"
          sx={{ fontWeight: 700, mb: 1 }}
        >
          Your organization&rsquo;s exercises
        </Typography>

        {/*
          One live region for the whole read, so a state change (loading →
          loaded, loaded → error) is announced once rather than by three regions
          racing each other.
        */}
        <Box role="status" aria-live="polite" data-testid="org-exercises-state">
          {exercises.isPending
            ? (
              <Stack
                direction="row"
                data-testid="org-exercises-loading"
                sx={{ alignItems: 'center', gap: 1, color: 'text.secondary', padding: '16px 0' }}
              >
                <FontAwesomeIcon icon={faSpinner} spin aria-hidden />
                <Typography variant="body2">Loading your organization&rsquo;s exercises…</Typography>
              </Stack>
            )
            : null}
        </Box>

        {exercises.isError
          ? (
            <Stack
              role="alert"
              data-testid="org-exercises-error"
              sx={{
                gap: 1,
                alignItems: 'flex-start',
                padding: '12px 14px',
                border: '1px solid',
                borderColor: 'notifications.errorText',
                borderRadius: 1,
                color: 'notifications.errorText',
              }}
            >
              <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
                <Box component="span" sx={{ mt: '2px' }}>
                  <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                </Box>
                <Typography variant="body2">
                  Your organization&rsquo;s exercises could not be loaded, so this list is not a
                  record of what exists.
                  {exercises.error.serverMessage !== undefined
                    ? ` The server said: ${exercises.error.serverMessage}`
                    : ''}
                </Typography>
              </Stack>
              <CobraSecondaryButton
                type="button"
                onClick={() => { void exercises.refetch() }}
                startIcon={<FontAwesomeIcon icon={faArrowsRotate} />}
              >
                Try again
              </CobraSecondaryButton>
            </Stack>
          )
          : null}

        {exercises.isSuccess
          ? (
            exercises.data.length === 0
              ? <EmptyState />
              : <OrgExerciseTable exercises={exercises.data} />
          )
          : null}
      </Box>
    </Box>
  )
}
