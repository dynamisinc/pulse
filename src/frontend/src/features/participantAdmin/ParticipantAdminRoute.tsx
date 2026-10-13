/**
 * features/participantAdmin/ParticipantAdminRoute.tsx
 * ---------------------------------------------------------------------------
 * The PARTICIPANT ADMIN staff surface ROUTE composition (feature: easy-login,
 * story 10; EL-14) — the element the staff route registry mounts at
 * `/staff/participant-admin` for `planner` and `controller`.
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
 * ## Slot composition is the orchestrator's (integration seam)
 * `<RosterPage />` is mounted bare. After stories 11, 12 (and 13) land, the
 * orchestrator passes `dayWordSlot={<DayWordPanel />}`,
 * `renderCardsAction={selection => <PrintCardsButton selection={selection} />}`
 * and, only when `capabilities.emailLinks`, `renderEmailAction`. See
 * docs/features/easy-login/implementation.md, "Integration seam".
 */

import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { RosterPage } from './pages/RosterPage'

/** The `/staff/participant-admin` route element. See the module header. */
export const ParticipantAdminRoute = () => (
  <ToolstripProvider>
    <StaffShellFrame
      header={<StaffHeader surfaceName="Participants" />}
      toolstrip={<Toolstrip />}
    >
      <RosterPage />
    </StaffShellFrame>
  </ToolstripProvider>
)
