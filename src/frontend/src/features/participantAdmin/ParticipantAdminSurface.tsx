/**
 * features/participantAdmin/ParticipantAdminSurface.tsx
 * ---------------------------------------------------------------------------
 * The participant-admin STAFF SURFACE as the staff route registry mounts it at
 * `/staff/participant-admin` (feature: easy-login; stories 10 + 11 + 12; Gate-2
 * finding W-3). This is the INTEGRATION SEAM: the one file that fills the roster
 * page's slots with the stories that were built beside it.
 *
 *   ParticipantAdminSurface            (this file: names dayWord/ and cards/)
 *     > ParticipantAdminRoute          (story 10: frame + header + toolstrip)
 *       > RosterPage                   (story 10: the roster; imports no slot folder)
 *           dayWordSlot        = <DayWordPanel />                      (story 11)
 *           renderCardsAction  = selection => <PrintCardsButton ... /> (story 12)
 *           renderEmailAction  = (empty - see below)                   (story 13)
 *
 * ## Why a separate file
 * `participantAdminSeparation.test.ts` forbids story 10's own files, including
 * `ParticipantAdminRoute.tsx`, from importing `dayWord/`, `cards/` or `email/`: the
 * slot props are the seam, so the roster stays independent of the stories that fill
 * it. Composition therefore needs a home outside that set. This is it, and the guard
 * pins that this is the ONLY non-slot file that may name those folders, so the seam
 * cannot quietly erode.
 *
 * ## The email slot is deliberately empty
 * Story 13's email-links action lives on another branch and is not merged here. When
 * it lands, add `renderEmailAction` below, gated on `capabilities.emailLinks`
 * (docs/features/easy-login/implementation.md, "Integration seam"). Until then
 * `RosterPage` renders nothing in that place.
 *
 * ## Why the registry mounts this and not the route
 * Before this file the registry had no `participant-admin` entry at all, so the whole
 * roster, day-word and card-sheet stack was built, tested and unreachable (W-3). The
 * registry entry (`@/features/staff/staffRouteRegistry`) points here.
 *
 * World: STAFF (COBRA). `StaffShellFrame`, inside the route, mounts the COBRA theme;
 * nothing here is a participant surface.
 */

import { ParticipantAdminRoute } from './ParticipantAdminRoute'
import { PrintCardsButton } from './cards'
import { DayWordPanel } from './dayWord'

/**
 * Story 12's slot. Module-level so the render prop keeps one identity across renders
 * (the roster calls it with the live selection on every render).
 */
const renderCardsAction = (selection: readonly string[]) => (
  <PrintCardsButton selection={selection} />
)

/** The `/staff/participant-admin` registry element. See the module header. */
export const ParticipantAdminSurface = () => (
  <ParticipantAdminRoute
    dayWordSlot={<DayWordPanel />}
    renderCardsAction={renderCardsAction}
  />
)
