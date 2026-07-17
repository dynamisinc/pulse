/**
 * core/auth/roles.ts
 * ---------------------------------------------------------------------------
 * Wave-1 identity foundation: the six-role vocabulary that gates every
 * surface in Pulse (COR-010; see
 * docs/features/identity-auth-roles/01-roles.md).
 *
 * Roles: **participant**, **pio** (a participant flavor with monitoring
 * defaults + Press Room authoring once E5 lands), **controller**,
 * **evaluator** (read-everything, write-nothing in the sim - COR-013),
 * **planner** (aka ExerciseAdmin), **orgAdmin** (organization administration -
 * its own surface, neither staff nor participant). Naming is aligned with
 * Cadence's `ExerciseRole` vocabulary where sensible (COR-010).
 *
 * `STAFF_ROLES` (controller/evaluator/planner) and `PARTICIPANT_ROLES`
 * (participant/pio) are the two gated surface families a role can reach
 * (XC-002: a participant role can never reach a staff surface). `orgAdmin`
 * belongs to neither - org administration is a third, separate surface
 * family (story 01 AC) - so callers that need "is this an org-admin" should
 * compare the role directly (`role === 'orgAdmin'`), not infer it from the
 * absence of the other two sets.
 *
 * Roles are exercise-scoped assignments (a person's role is per exercise,
 * not global) - `useRole()` reads the role off the current bound session
 * (`./session`), never a standalone/global role store.
 *
 * World: platform/foundation. Pure `core/` module - no UI, no COBRA, no
 * participant skin.
 */
import { useSession } from './session'

/** The six roles that gate every Pulse surface (COR-010). */
export type ExerciseRole =
  | 'participant'
  | 'pio'
  | 'controller'
  | 'evaluator'
  | 'planner'
  | 'orgAdmin'

/**
 * All valid roles. The runtime guard (`isExerciseRole`) checks membership
 * here, so an out-of-vocabulary role string fails closed rather than being
 * cast blindly to `ExerciseRole` (same precedent as
 * `exerciseContextResolver.ts`'s `isExerciseStatus`).
 */
export const ALL_ROLES: readonly ExerciseRole[] = [
  'participant',
  'pio',
  'controller',
  'evaluator',
  'planner',
  'orgAdmin',
] as const

/** Staff-surface roles (controller/evaluator/planner) - gated behind XC-002. */
export const STAFF_ROLES: readonly ExerciseRole[] = [
  'controller',
  'evaluator',
  'planner',
] as const

/** Participant-surface roles (participant/pio) - the fiction-facing world. */
export const PARTICIPANT_ROLES: readonly ExerciseRole[] = [
  'participant',
  'pio',
] as const

/** Runtime guard for a value read off the wire (e.g. a resolved session). */
export function isExerciseRole(value: unknown): value is ExerciseRole {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value)
}

/** True for controller/evaluator/planner - staff-console-reachable roles. */
export function isStaffRole(role: ExerciseRole): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

/** True for participant/pio - the two participant-surface flavors. */
export function isParticipantRole(role: ExerciseRole): boolean {
  return (PARTICIPANT_ROLES as readonly string[]).includes(role)
}

/**
 * True unless the role is `evaluator` - evaluators read everything but write
 * nothing in the sim (COR-013; enforcement detail is story 04, out of scope
 * here). Every other role - including staff roles like controller/planner
 * acting in-sim, and orgAdmin - can write.
 */
export function canWriteInSim(role: ExerciseRole): boolean {
  return role !== 'evaluator'
}

/**
 * Reads the current session's role. Delegates entirely to `useSession()`
 * (`./session`) - there is no separate role store, so a role can never drift
 * from the session it was resolved with. Throws outside a `SessionProvider`
 * (fail-closed; see `useSession`).
 */
export function useRole(): ExerciseRole {
  return useSession().role
}
