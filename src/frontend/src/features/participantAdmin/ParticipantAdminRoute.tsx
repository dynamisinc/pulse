/**
 * features/participantAdmin/ParticipantAdminRoute.tsx
 * ---------------------------------------------------------------------------
 * The PARTICIPANT ADMIN staff surface ROUTE composition (feature: easy-login,
 * story 10; EL-14) — the frame + roster page that `ParticipantAdminSurface` fills
 * with the day-word panel and the print action, and that the staff route registry
 * mounts at `/staff/participant-admin` for `planner` and `controller`.
 *
 * This is the "full participant-admin surface" the staff-shell flyout
 * (`ParticipantAdminFlyout`) has been waiting for (identity-auth-roles/08).
 *
 * ## STAFF world, despite the folder name
 * `features/participantAdmin/` is COBRA: `StaffShellFrame` mounts the COBRA theme
 * for everything inside it. It is deliberately NOT one of the participant roots
 * `staffShell/twoWorldsSeparation.test.ts` scans, and that test forbids any
 * participant surface from importing it (so a participant path can never reach
 * this code).
 *
 * ## Modelled on `PlannerWorkspaceRoute`
 * No `ExerciseContextProvider` here, on purpose (CR-001): exactly one provider is
 * hoisted in `features/app-shell/routes.tsx`, and a second one would keep
 * serving the pre-switch scope after the staff exercise switcher refreshes the
 * hoisted one. Tests that mount this route directly must supply a provider.
 * No `PreviewProvider`: previewing the participant world belongs to the conduct
 * surfaces.
 *
 * ## Slot composition lives in `ParticipantAdminSurface`, not here
 * `<RosterPage />` takes three slot props (`dayWordSlot`, `renderCardsAction`,
 * `renderEmailAction`). This route accepts the same props and forwards them
 * untouched, but it imports NOTHING from `dayWord/`, `cards/` or `email/`:
 * `participantAdminSeparation.test.ts` forbids that for every file in story 10's
 * set, so the roster screen stays testable and shippable without the slot
 * stories. The one file that names those folders is `ParticipantAdminSurface.tsx`,
 * which is what the staff route registry mounts. Mounted bare (as this file's own
 * test does), the roster renders with no slot content.
 */

import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { RosterPage, type RosterPageProps } from './pages/RosterPage'

/**
 * The participant-admin route composition. Slot props are forwarded to the roster
 * page verbatim; see the module header for who supplies them.
 */
export const ParticipantAdminRoute = (slots: RosterPageProps) => (
  <ToolstripProvider>
    <StaffShellFrame
      header={<StaffHeader surfaceName="Participants" />}
      toolstrip={<Toolstrip />}
    >
      <RosterPage {...slots} />
    </StaffShellFrame>
  </ToolstripProvider>
)
