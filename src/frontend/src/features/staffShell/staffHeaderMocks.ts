/**
 * features/staffShell/staffHeaderMocks.ts
 * ---------------------------------------------------------------------------
 * Contract-seam mocks for `StaffHeader` (feature: staff-shell, story 01 —
 * "Staff header — lockup, identity badge, clocks, state pill, classification
 * tag"; see docs/features/staff-shell/01-staff-header.md).
 *
 * Two pieces of header content have no backend yet:
 *   - the current staff user's role/cell (e.g. "CONTROLLER · SimCell-1"),
 *     shown under the exercise name in the identity badge;
 *   - the staff presence roster (who else is logged into this exercise's
 *     staff side right now), shown as a row of avatars.
 *
 * TODO(E1 roles/presence API): both are placeholders. The real replacement is
 * E1's roles/lifecycle API (role/cell — COR-005/032) plus a live presence
 * channel (SignalR, mirroring Cadence — see CLAUDE.md "G. Real-time": one
 * shared connection, presence becomes a handler on it, not a new socket).
 * Deliberately lightweight: a typed mock hook/const, NOT an axios-routed
 * resolver — that plumbing belongs to the real API integration, not this
 * header-layout seam. `StaffHeader` imports only the two hooks below, so
 * swapping this file's internals for real data requires no change to the
 * component.
 */

/** A staff member's role + assigned cell/team, as shown in the identity badge. */
export interface StaffRoleCell {
  readonly role: string
  readonly cell: string
}

// TODO(E1 roles/presence API): replace with the real per-session role/cell
// resolution once E1 lands. Wave-0/story-01 has no backend; this mock exists
// only so the identity badge's second line has something real-shaped to render.
export function useStaffRoleCell(): StaffRoleCell {
  return { role: 'CONTROLLER', cell: 'SimCell-1' }
}

/** One entry in the staff presence roster. */
export interface StaffPresenceMember {
  readonly id: string
  readonly initials: string
  /** Accessible name / tooltip text, e.g. "SimCell-2 · J. Okoro". */
  readonly label: string
  /**
   * Avatar background color (presentational only — never the sole signal; the
   * label carries identity). Chosen dark enough that the white initials meet
   * WCAG 2.1 AA (>=4.5:1 for small text) on this staff surface (NFR-001).
   */
  readonly color: string
}

// TODO(E1 roles/presence API): replace with the real SignalR presence channel
// (CLAUDE.md "G. Real-time" — a handler on the one shared connection, not a
// new socket) once it exists. Wave-0/story-01 mock: a fixed roster. Colors are
// AA-safe against white initials (contrast >=4.5:1): #276749 6.7:1, #8a5300
// 6.3:1, #5b3f86 8.4:1.
const MOCK_STAFF_PRESENCE: readonly StaffPresenceMember[] = [
  { id: 'simcell-1', initials: 'S1', label: 'SimCell-1 (you)', color: '#276749' },
  { id: 'simcell-2', initials: 'S2', label: 'SimCell-2 · J. Okoro', color: '#8a5300' },
  { id: 'director', initials: 'DP', label: 'Director · L. Park', color: '#5b3f86' },
]

export function useStaffPresence(): readonly StaffPresenceMember[] {
  return MOCK_STAFF_PRESENCE
}
