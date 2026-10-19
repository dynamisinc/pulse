/**
 * features/participantAdmin/ParticipantAdminSurface.tsx
 * ---------------------------------------------------------------------------
 * The participant-admin STAFF SURFACE as the staff route registry mounts it at
 * `/staff/participant-admin` (feature: easy-login; stories 10 + 11 + 12; Gate-2
 * finding W-3). This is the INTEGRATION SEAM: the one file that fills the roster
 * page's slots with the stories that were built beside it.
 *
 *   ParticipantAdminSurface            (this file: names dayWord/, cards/ and email/)
 *     > ParticipantAdminRoute          (story 10: frame + header + toolstrip)
 *       > RosterPage                   (story 10: the roster; imports no slot folder)
 *           dayWordSlot        = <DayWordPanel />                      (story 11)
 *           renderCardsAction  = selection => <PrintCardsButton ... /> (story 12)
 *           renderEmailAction  = selection => <EmailLinksButton ... /> (story 13)
 *
 * ## Why a separate file
 * `participantAdminSeparation.test.ts` forbids story 10's own files, including
 * `ParticipantAdminRoute.tsx`, from importing `dayWord/`, `cards/` or `email/`: the
 * slot props are the seam, so the roster stays independent of the stories that fill
 * it. Composition therefore needs a home outside that set. This is it, and the guard
 * pins that this is the ONLY non-slot file that may name those folders, so the seam
 * cannot quietly erode.
 *
 * ## The email slot gates itself
 * Story 13's `EmailLinksButton` is mounted unconditionally: it renders nothing unless
 * the roster reports `capabilities.emailLinks` (the server's mailer is configured), so
 * a host without Azure Communication Services shows no email action at all, and with
 * no join base configured the button is disabled (the roster already says why).
 *
 * ## Why the registry mounts this and not the route
 * Before this file the registry had no `participant-admin` entry at all, so the whole
 * roster, day-word and card-sheet stack was built, tested and unreachable (W-3). The
 * registry entry (`@/features/staff/staffRouteRegistry`) points here.
 *
 * World: STAFF (COBRA). `StaffShellFrame`, inside the route, mounts the COBRA theme;
 * nothing here is a participant surface.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons'
import { Box, Typography } from '@mui/material'
import { usePermissions } from '@/core/auth'
import CobraStyles from '@/theme/CobraStyles'
import { ParticipantAdminRoute } from './ParticipantAdminRoute'
import { PrintCardsButton } from './cards'
import { DayWordPanel } from './dayWord'
import { EmailLinksButton } from './email'

/**
 * Story 12's slot. Module-level so the render prop keeps one identity across renders
 * (the roster calls it with the live selection on every render).
 */
const renderCardsAction = (selection: readonly string[]) => (
  <PrintCardsButton selection={selection} />
)

/**
 * Story 13's slot, module-level for the same reason. The button decides for itself
 * whether to render (`capabilities.emailLinks`), so it is mounted unconditionally.
 */
const renderEmailAction = (selection: readonly string[]) => (
  <EmailLinksButton selection={selection} />
)

/**
 * The `/staff/participant-admin` registry element. See the module header.
 *
 * Story 17: roster provisioning/import and view-only/day-word codes are planner + controller
 * (`manageAccounts`). The registry already admits only those two roles; for any other role (an
 * evaluator would get a 403 on every call) this renders a text notice instead of write controls.
 */
export const ParticipantAdminSurface = () => {
  const canManage = usePermissions().can('manageAccounts')
  if (!canManage) {
    return (
      <Box
        role="status"
        data-testid="participant-admin-no-access"
        sx={{ padding: CobraStyles.Padding.MainWindow, display: 'flex', gap: 1, alignItems: 'center' }}
      >
        <FontAwesomeIcon icon={faLock} aria-hidden />
        <Typography variant="body2">
          <strong>Not available for your role.</strong> Only a planner or controller can manage
          participant accounts and codes.
        </Typography>
      </Box>
    )
  }
  return (
    <ParticipantAdminRoute
      dayWordSlot={<DayWordPanel />}
      renderCardsAction={renderCardsAction}
      renderEmailAction={renderEmailAction}
    />
  )
}
