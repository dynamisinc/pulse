/**
 * features/staffShell/components/ExerciseIdentityBadge.tsx
 * ---------------------------------------------------------------------------
 * The exercise identity badge in `StaffHeader` ("Pulse UAT Pilot / CONTROLLER ·
 * SIMCELL-1"), which is also the staff EXERCISE SWITCHER when the signed-in
 * staff member holds two or more exercise assignments.
 *
 * WHY HERE (UAT 10/16): the switcher used to mount as a full panel ABOVE the
 * whole staff console (`ExerciseSwitcherSlot`), pushing the console down and
 * sitting a light card over the dark COBRA header. Switching now lives in the
 * header, where the exercise identity already is.
 *
 * BEHAVIOUR
 *  - 0 or 1 assignment (or the query still loading / failed): the original
 *    static, non-interactive badge, same markup as before.
 *  - 2+ assignments: the badge becomes a menu button (`aria-haspopup="menu"`,
 *    `aria-expanded`) with a FontAwesome chevron, opening a MUI `Menu` that lists
 *    each assignment (name + role). The active one carries a check icon AND the
 *    text "Active" plus `aria-current` (never color alone). Choosing another one
 *    calls the SAME `useSetActiveExercise` mutation `ExerciseSwitcher` uses (scope
 *    re-resolve, cache reset and all); the menu closes on success and stays open
 *    on failure with the error shown inside it (`role="alert"`, icon + text).
 *  - The menu can always be dismissed, even mid-switch (no keyboard trap); the
 *    switch keeps running and reopening shows it still pending.
 *  - The last-known assignments are retained while a post-switch refetch runs, so
 *    the trigger is never unmounted and focus returns to it.
 *  - Keyboard: Enter/Space open the trigger; arrows move; Escape closes and MUI
 *    restores focus to the trigger; the trigger has a visible focus ring.
 *
 * The mutation hook lives in the inner `SwitchableBadge` so the static path (and
 * every header render with fewer than two assignments) never touches it.
 * Imports from `@/features/staff` go through direct file paths, never the
 * barrel, to avoid a registry -> surface -> StaffHeader import cycle.
 *
 * STAFF world only: navy-header idiom from `staffShellTokens`, FontAwesome icons,
 * MUI 9 `sx`-only; `Menu`/`MenuItem` are the same sanctioned plain-MUI pieces
 * `SurfaceLauncher` uses (COBRA has no menu component).
 */

import { useEffect, useId, useState } from 'react'
import { Box, CircularProgress, ListItemText, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faChevronDown,
  faChevronUp,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useStaffAssignments } from '@/features/staff/hooks/useStaffAssignments'
import { selectInternalName } from '@/features/staff/hooks/useActiveExerciseInternalName'
import { useSetActiveExercise } from '@/features/staff/hooks/useSetActiveExercise'
import { friendlyErrorMessage, sameExercise } from '@/features/staff/components/switcherShared'
import type { Enrollment } from '@/features/staff/types'
import {
  STAFF_COARSE_POINTER_MEDIA,
  STAFF_TABLET_PORTRAIT_MEDIA,
  STAFF_TOUCH_TARGET_PX,
  staffShellTokens,
} from '../staffShellTokens'

/** The minimum number of assignments for there to be anything to switch between. */
const MIN_ASSIGNMENTS_TO_SWITCH = 2

export interface ExerciseIdentityBadgeProps {
  /** Role label shown on the badge's second line, e.g. "CONTROLLER". */
  role: string
  /** Cell / call sign shown after the role, e.g. "SIMCELL-1". */
  cell: string
}

interface BadgeTextProps extends ExerciseIdentityBadgeProps {
  /** INTERNAL name (never the participant-facing scope name); null renders no name line. */
  exerciseName: string | null
}

/** The two text lines (name, role · cell), shared by static and menu-button forms. */
function BadgeText({ exerciseName, role, cell }: BadgeTextProps) {
  return (
    <>
      {exerciseName && (
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            // Tablet portrait: a long exercise name WRAPS (never clipped, never ellipsised) so the
            // identity badge shrinks instead of pushing the header past the viewport.
            [STAFF_TABLET_PORTRAIT_MEDIA]: { whiteSpace: 'normal', lineHeight: 1.15 },
          }}
        >
          {exerciseName}
        </Typography>
      )}
      <Typography
        sx={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: staffShellTokens.header.textMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {role} · {cell}
      </Typography>
    </>
  )
}

const badgeFrameSx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1px',
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  borderRadius: '8px',
  px: 1.375,
  py: 0.625,
  minWidth: 0,
} as const

/**
 * Tablet overrides, spread LAST in each usage: object-key order is emission order, so a media
 * rule must come after every base declaration it overrides (a media block spread early would be
 * beaten by a later base `pr`).
 */
const badgeTabletSx = {
  [STAFF_TABLET_PORTRAIT_MEDIA]: { px: 1, pr: 1 },
  [STAFF_COARSE_POINTER_MEDIA]: { minHeight: STAFF_TOUCH_TARGET_PX },
} as const

interface SwitchableBadgeProps extends ExerciseIdentityBadgeProps {
  assignments: Enrollment[]
}

/** The 2+ assignments form: a menu button that switches the active exercise. */
function SwitchableBadge({ role, cell, assignments }: SwitchableBadgeProps) {
  const scope = useExerciseContext()
  const switchMutation = useSetActiveExercise()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  // Provisional echo of the switch response, superseded the moment the provider
  // re-resolves (same rationale as `ExerciseSwitcher`'s `justSwitchedTo`).
  const [justSwitchedTo, setJustSwitchedTo] = useState<Enrollment | null>(null)
  const menuId = useId()
  const open = anchorEl !== null

  useEffect(() => {
    setJustSwitchedTo(null)
  }, [scope.exerciseId])

  const activeExerciseId = justSwitchedTo?.exerciseId ?? scope.exerciseId
  // INTERNAL name from the assignments, never the (nullable) participant-facing scope name.
  const displayName =
    justSwitchedTo?.exerciseName ?? selectInternalName(assignments, scope.exerciseId)

  // Dismissal is ALWAYS allowed (Esc, Tab, backdrop): a slow or stalled switch must
  // never trap a keyboard user in the modal menu. Closing does not cancel the
  // mutation; reopening shows the still-pending state with items disabled.
  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleOpen = (target: HTMLElement) => {
    // Keep a pending switch's state so a second switch cannot start on reopen.
    if (!switchMutation.isPending) switchMutation.reset()
    setAnchorEl(target)
  }

  const handleSelect = (assignment: Enrollment) => {
    if (switchMutation.isPending) return
    if (sameExercise(assignment.exerciseId, activeExerciseId)) {
      setAnchorEl(null)
      return
    }
    switchMutation.mutate(assignment.exerciseId, {
      onSuccess: switched => {
        setJustSwitchedTo(switched)
        setAnchorEl(null)
      },
    })
  }

  return (
    <>
      <Box
        component="button"
        type="button"
        data-testid="staff-header-identity-badge"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Switch exercise — current: ${displayName ? `${displayName}, ` : ''}${role} ${cell}`}
        onClick={event => handleOpen(event.currentTarget)}
        sx={{
          ...badgeFrameSx,
          position: 'relative',
          pr: 3.5,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          '&:hover': { background: 'rgba(255, 255, 255, 0.16)' },
          '&:focus-visible': {
            outline: '2px solid rgba(255, 255, 255, 0.85)',
            outlineOffset: '2px',
          },
          ...badgeTabletSx,
          // The chevron is absolutely placed at right: 10, so portrait keeps room for it.
          [STAFF_TABLET_PORTRAIT_MEDIA]: { px: 1, pr: 3 },
        }}
      >
        <BadgeText exerciseName={displayName} role={role} cell={cell} />
        <Box
          component="span"
          sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
        >
          <FontAwesomeIcon
            icon={open ? faChevronUp : faChevronDown}
            size="xs"
            aria-hidden="true"
            style={{ opacity: 0.75 }}
          />
        </Box>
      </Box>

      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          list: { 'aria-label': 'Your exercises', dense: true, sx: { minWidth: 280, py: 0.5 } },
        }}
      >
        {assignments.map(assignment => {
          const isActive = sameExercise(assignment.exerciseId, activeExerciseId)
          const roleLabel = assignment.role.toUpperCase()
          return (
            <MenuItem
              key={assignment.exerciseId}
              data-testid={`staff-header-exercise-item-${assignment.exerciseId}`}
              aria-current={isActive ? 'true' : undefined}
              disabled={switchMutation.isPending}
              onClick={() => handleSelect(assignment)}
              sx={{ py: 0.875, gap: 1, alignItems: 'center' }}
            >
              <ListItemText
                primary={assignment.exerciseName}
                secondary={roleLabel}
                slotProps={{
                  primary: { sx: { fontSize: 13, fontWeight: isActive ? 700 : 600 } },
                  secondary: { sx: { fontSize: 11 } },
                }}
              />
              {isActive && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, flex: 'none' }}>
                  <FontAwesomeIcon icon={faCheck} size="xs" aria-hidden="true" />
                  <Typography component="span" sx={{ fontSize: 10, fontWeight: 700 }}>
                    Active
                  </Typography>
                </Stack>
              )}
            </MenuItem>
          )
        })}

        {switchMutation.isPending && (
          <Stack
            component="li"
            direction="row"
            role="status"
            aria-live="polite"
            data-testid="staff-header-switching"
            sx={{ alignItems: 'center', gap: 1, px: 2, py: 0.75, color: 'text.secondary', listStyle: 'none' }}
          >
            <CircularProgress size={14} />
            <Typography variant="body2">Switching active exercise…</Typography>
          </Stack>
        )}

        {switchMutation.isError && (
          <Stack
            component="li"
            direction="row"
            role="alert"
            data-testid="staff-header-switch-error"
            sx={{
              alignItems: 'flex-start',
              gap: 1,
              px: 2,
              py: 0.75,
              color: 'error.main',
              listStyle: 'none',
              maxWidth: 320,
            }}
          >
            <Box component="span" sx={{ mt: '2px' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            </Box>
            <Typography variant="body2">
              {friendlyErrorMessage(switchMutation.error, 'Could not switch your active exercise.')}
            </Typography>
          </Stack>
        )}
      </Menu>
    </>
  )
}

/**
 * The header's exercise identity badge: static with fewer than two assignments,
 * a switcher menu button with two or more. See the module header.
 */
export function ExerciseIdentityBadge({ role, cell }: ExerciseIdentityBadgeProps) {
  const { exerciseId } = useExerciseContext()
  const assignmentsQuery = useStaffAssignments()
  // The switch mutation's `resetQueries()` clears the assignments while they refetch.
  // Keep the last-known list so `SwitchableBadge` (the menu, the trigger, and the
  // focus target) stays mounted through the reset instead of being swapped out.
  const [lastKnown, setLastKnown] = useState<Enrollment[]>([])
  if (assignmentsQuery.isSuccess && assignmentsQuery.data !== lastKnown) {
    setLastKnown(assignmentsQuery.data)
  }
  const assignments = assignmentsQuery.isSuccess ? assignmentsQuery.data : lastKnown

  if (assignments.length >= MIN_ASSIGNMENTS_TO_SWITCH) {
    return <SwitchableBadge role={role} cell={cell} assignments={assignments} />
  }

  return (
    <Box
      data-testid="staff-header-identity-badge"
      title="Exercise identity — static while conduct is live (COR-005)"
      sx={{ ...badgeFrameSx, ...badgeTabletSx }}
    >
      <BadgeText
        exerciseName={selectInternalName(assignments, exerciseId)}
        role={role}
        cell={cell}
      />
    </Box>
  )
}
