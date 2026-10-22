/**
 * features/planner/types/staff.ts
 * ---------------------------------------------------------------------------
 * Client contract types for the planner "Staff" section (identity-auth-roles story 20, #575a).
 * STAFF world. Mirrors the A2 backend DTOs:
 *   GET /api/org/exercises/{exerciseId}/enrollments -> StaffRoster
 * The service validates the wire body against these shapes (fail closed) before anything renders.
 */

/** The staff roles an enrollment can hold (participants are not assigned here). */
export type StaffRole = 'planner' | 'controller' | 'evaluator'

export const STAFF_ROLES: readonly StaffRole[] = ['planner', 'controller', 'evaluator']

/** One person currently holding a staff role in the exercise. */
export interface StaffEnrollment {
  readonly id: string
  readonly personId: string
  readonly displayName: string
  readonly email: string | null
  readonly role: StaffRole
  /** True on the lead controller (only ever a controller). */
  readonly isLead: boolean
}

/** An org person with no role in this exercise yet. */
export interface StaffCandidate {
  readonly personId: string
  readonly displayName: string
  readonly email: string | null
}

/** The planner's read of an exercise's staff. */
export interface StaffRoster {
  readonly exerciseId: string
  readonly enrollments: readonly StaffEnrollment[]
  readonly candidates: readonly StaffCandidate[]
}
