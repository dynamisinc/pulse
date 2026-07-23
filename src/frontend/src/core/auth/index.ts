/**
 * core/auth — public barrel.
 *
 * The Wave-1 identity seam (COR-010/COR-012; feature: identity-auth-roles,
 * stories 01 Roles + 03 Sessions; the token store + `logout()` are feature:
 * login, story 01 — "Frontend session & token wiring"). Foldered like its
 * Wave-0 siblings (`core/exerciseContext`, `core/clock`, `core/telemetry`)
 * because it spans more than one file (role model + session resolver +
 * provider/hook + token store + logout).
 *
 * Consumers import from `@/core/auth`. Note: the session's `exerciseId` is a
 * display/attribution field, NOT a client query-scoping param — query
 * isolation is enforced server-side (COR-001).
 */

export type { ExerciseRole } from './roles'
export {
  PARTICIPANT_ROLES,
  STAFF_ROLES,
  isParticipantRole,
  isStaffRole,
  canWriteInSim,
  isExerciseRole,
  useRole,
} from './roles'

export { SessionProvider, useSession } from './session'
export type { SessionProviderProps } from './session'

export { resolveSession, isSessionExpired, SESSION_TTL_MS } from './sessionResolver'
export type { Session } from './sessionResolver'

export { getAccessToken, getRefreshToken, setTokens, clearTokens } from './tokenStore'
export type { TokenPair } from './tokenStore'

export { logout } from './logout'
export { endSession } from './endSession'
