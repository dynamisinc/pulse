/**
 * features/staffShell/participantAdminMocks.ts
 * ---------------------------------------------------------------------------
 * Contract-seam mocks for `ParticipantAdminFlyout` (feature: staff-shell,
 * story 03 — "Participant-admin flyout / login triage"; COR-017; see
 * docs/features/staff-shell/03-participant-admin-flyout.md).
 *
 * Two pieces of this tool's data have no backend yet:
 *   - the participant login-triage roster (name / role / login status) for
 *     the CURRENT exercise — `useParticipantAdminRoster(exerciseId)`;
 *   - the current staff member's role + whether that role may perform an
 *     admin quick action (unlock / resend) — `useAdminAuthorization()`.
 *
 * TODO(E1 identity-auth-roles): both are placeholders. The real replacements
 * are E1's participant-admin API (roster + login state, COR-017) and its
 * roles/session-identity resolution (lead-controller/controller gating).
 * Deliberately lightweight: typed mock hooks/consts, NOT axios-routed
 * resolvers — that plumbing belongs to the real API integration, not this
 * triage-flyout seam (mirrors `staffHeaderMocks.ts`'s same call). Swapping
 * either hook's internals for real data requires no change to
 * `ParticipantAdminFlyout`, which imports only the two hooks below.
 *
 * ## Exercise scoping (XC-001)
 * `useParticipantAdminRoster` is keyed on the RESOLVED exercise id (passed in
 * by the caller, sourced from `useExerciseContext()` — never read from here).
 * An exercise id with no roster entry returns an EMPTY roster, never another
 * exercise's data and never a fabricated "generic" fallback — showing the
 * wrong exercise's participants would itself be a cross-exercise leak.
 *
 * ## Role gating (COR-017)
 * `useAdminAuthorization()` returns the resolved role AND the derived
 * `canPerformAdminAction` boolean (lead-controller / controller only). The
 * flyout HIDES (never merely disables) a quick action when the current role
 * can't perform it — the codebase's established pattern for an unavailable
 * affordance (SHELL-CONTRACT.md §4 hard gate 3, "Read-only: affordances
 * absent, not disabled", COR-015) — rather than showing a disabled button a
 * denied role can still see and wonder about.
 */

/** A participant's login-triage state, as shown in the flyout's status chip. */
export type ParticipantLoginStatus = 'locked-out' | 'no-login-yet' | 'active'

/** One row in the participant-admin login-triage list. */
export interface ParticipantAdminRow {
  readonly id: string
  /** Participant's display name. */
  readonly name: string
  /** Participant's exercise role/cell (e.g. "EOC Liaison"), NOT the staff role. */
  readonly role: string
  readonly status: ParticipantLoginStatus
}

// TODO(E1 identity-auth-roles): replace with the real per-exercise participant
// roster + login-state API once E1 lands. Wave-1/story-03 has no backend;
// this mock exists only so the flyout has something exercise-shaped to
// render. Keyed by exerciseId — see module header "Exercise scoping".
const MOCK_ROSTER_BY_EXERCISE: Record<string, readonly ParticipantAdminRow[]> = {
  // Matches exerciseContextResolver.ts's MOCK_EXERCISE_CONTEXT.exerciseId, so
  // the shipped (un-mocked) ExerciseContextProvider path has real-shaped data.
  'ex-mock-0001': [
    { id: 'participant-001', name: 'Morgan Ellis', role: 'EOC Liaison', status: 'locked-out' },
    { id: 'participant-002', name: 'Priya Chandran', role: 'Public Information Officer', status: 'no-login-yet' },
    { id: 'participant-003', name: 'Devon Ruiz', role: 'Incident Commander', status: 'locked-out' },
    { id: 'participant-004', name: 'Sam Okafor', role: 'Logistics Chief', status: 'active' },
    { id: 'participant-005', name: 'Jamie Torres', role: 'Finance/Admin Chief', status: 'active' },
  ],
}

/** No roster entry for this exercise — an empty list, never another exercise's data. */
const EMPTY_ROSTER: readonly ParticipantAdminRow[] = []

/**
 * Returns the login-triage roster for `exerciseId` (contract seam — see
 * module header). Exercise-scoped by construction: an unrecognized id yields
 * an empty roster rather than a generic/fabricated fallback (XC-001).
 */
export function useParticipantAdminRoster(exerciseId: string): readonly ParticipantAdminRow[] {
  return MOCK_ROSTER_BY_EXERCISE[exerciseId] ?? EMPTY_ROSTER
}

/** The staff roles this mock models. Only two may perform an admin quick action. */
export type StaffAdminRole = 'lead-controller' | 'controller' | 'evaluator' | 'observer'

/** Roles permitted to perform participant-admin quick actions (COR-017). */
const ROLES_PERMITTED_ADMIN_ACTIONS: ReadonlySet<StaffAdminRole> = new Set([
  'lead-controller',
  'controller',
])

/** The current staff session's role + derived admin-action permission. */
export interface AdminAuthorization {
  readonly role: StaffAdminRole
  /**
   * The individual human behind this staff session (per-human attribution,
   * mirroring COR-018's `actingHumanId` for provenance) — stamped onto the
   * audit-log telemetry event a quick action emits.
   */
  readonly actingHumanId: string
  /** Whether `role` may perform an admin quick action (unlock / resend). */
  readonly canPerformAdminAction: boolean
}

// TODO(E1 identity-auth-roles): replace with the real per-session role
// resolution once E1 lands. Wave-1/story-03 mock: a fixed controller session.
const MOCK_STAFF_ROLE: StaffAdminRole = 'controller'
const MOCK_ADMIN_AUTHORIZATION: AdminAuthorization = {
  role: MOCK_STAFF_ROLE,
  actingHumanId: 'staff-mock-0001',
  canPerformAdminAction: ROLES_PERMITTED_ADMIN_ACTIONS.has(MOCK_STAFF_ROLE),
}

/**
 * Returns the current staff session's role + admin-action permission
 * (contract seam — see module header "Role gating").
 */
export function useAdminAuthorization(): AdminAuthorization {
  return MOCK_ADMIN_AUTHORIZATION
}
