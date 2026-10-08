/**
 * features/staffShell/staffHeaderMocks.ts
 * ---------------------------------------------------------------------------
 * Contract seams for `StaffHeader` (feature: staff-shell, story 01 — "Staff
 * header — lockup, identity badge, clocks, state pill, classification tag";
 * see docs/features/staff-shell/01-staff-header.md; reworked by demo-polish
 * C4, docs/features/demo-polish/20-console-cleanup.md).
 *
 * Two pieces of header content have no real backend yet:
 *   - the current staff user's role/cell (e.g. "CONTROLLER · SIMCELL-1"),
 *     shown under the exercise name in the identity badge;
 *   - the staff presence roster (who else is logged into this exercise's
 *     staff side right now).
 *
 * ## Role/cell has ONE source (demo-polish C4)
 * `useStaffRoleCell()` derives both halves from the controller identity seam
 * (`features/controller/identity/controllerIdentity`): `role` is the identity's
 * `role` upper-cased and `cell` is its `callSign` VERBATIM. The console body
 * prints the same `callSign` (`ControllerConsole`), so the header and the body
 * can never disagree about the cell name again (they used to read "SimCell-1"
 * and "SIMCELL-1" from two separate literals). Do not re-introduce a literal
 * here; if the real roles API (E1, COR-005/032) lands, swap the identity seam
 * and this hook follows.
 *
 * ## Presence is deliberately EMPTY (demo-polish C4)
 * There is no presence channel, so `useStaffPresence()` returns `[]` instead of
 * a made-up roster of colleagues — fake avatars next to a real participant app
 * read as unfinished at best and as false statements about who is online at
 * worst. `StaffHeader` renders NO presence region at all for an empty roster
 * (not an empty labelled group). The roster must not be faked back in: the
 * replacement is the live presence channel (SignalR, mirroring Cadence — see
 * CLAUDE.md "G. Real-time": one shared connection, presence becomes a handler
 * on it, not a new socket), tracked as CTL-004 and out of scope here.
 *
 * Deliberately lightweight: typed hooks, NOT an axios-routed resolver — that
 * plumbing belongs to the real API integration, not this header-layout seam.
 * `StaffHeader` imports only the two hooks below, so swapping this file's
 * internals for real data requires no change to the component.
 */

import { useControllerIdentity } from '@/features/controller/identity/controllerIdentity'

/** A staff member's role + assigned cell/team, as shown in the identity badge. */
export interface StaffRoleCell {
  readonly role: string
  readonly cell: string
}

/**
 * The signed-in staff user's role + cell for the identity badge. Derived from
 * the controller identity seam (see the module header: one source for the cell
 * name). Reads the exercise scope, so it must run inside an exercise context —
 * as `StaffHeader` already does.
 */
export function useStaffRoleCell(): StaffRoleCell {
  const identity = useControllerIdentity()
  return { role: identity.role.toUpperCase(), cell: identity.callSign }
}

/** One entry in the staff presence roster. */
export interface StaffPresenceMember {
  readonly id: string
  readonly initials: string
  /** Accessible name / tooltip text, e.g. "SIMCELL-2 · J. Okoro". */
  readonly label: string
  /**
   * Avatar background color (presentational only — never the sole signal; the
   * label carries identity). Must be dark enough that the white initials meet
   * WCAG 2.1 AA (>=4.5:1 for small text) on this staff surface (NFR-001).
   */
  readonly color: string
}

/** The roster until a real presence channel exists: nobody is claimed online. */
const NO_STAFF_PRESENCE: readonly StaffPresenceMember[] = []

/**
 * The staff presence roster. Always empty today (see the module header) —
 * never a faked roster. A stable module-level array, so consumers can depend on
 * its identity.
 */
export function useStaffPresence(): readonly StaffPresenceMember[] {
  return NO_STAFF_PRESENCE
}
