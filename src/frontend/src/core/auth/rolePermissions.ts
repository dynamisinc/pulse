/**
 * core/auth/rolePermissions.ts
 * ---------------------------------------------------------------------------
 * The ONE place the client mirrors the backend role matrix (identity-auth-roles story 17,
 * ADMIN-IDENTITY-MODEL §8.2, issue #573). STAFF world; pure logic plus one thin hook, no UI.
 *
 * WHY. The server now refuses (403) every staff write a role is not entitled to. A control the
 * caller cannot use should be ABSENT (or DISABLED with a visible text reason, never colour-only,
 * WCAG 2.1 AA) instead of failing on click. Every gated control asks `can()` /
 * `usePermissions()` rather than comparing `role === '...'` inline, so the rules live here and
 * only here, and `rolePermissions.test.ts` asserts the whole table, role by role.
 *
 * THIS HIDES CONTROLS; IT AUTHORIZES NOTHING. The server is the authority. If this table and
 * `RoleMatrixTests` ever disagree, the server wins and this file is the bug.
 *
 * INPUTS ARE READ, NEVER INFERRED. `role` and `isLead` come off the signed-in `Session`
 * (`useOptionalSession()`); `exerciseStatus` (only needed for the build-vs-conduct posting rule)
 * is passed by the caller from the exercise scope. Fail closed: no session, or an unknown
 * status, grants the narrowest answer.
 *
 * THE TABLE (action -> who):
 *   createExercise                          orgAdmin
 *   renameExercise (org row)                orgAdmin, planner      (not controller)
 *   archiveExercise (lifecycle + org row)   orgAdmin, planner      (not controller)
 *   unarchiveExercise                       orgAdmin
 *   manageOrgPeople (people directory: list,
 *     grant/revoke org admin, disable/enable,
 *     reset link; story 19)                 orgAdmin               (every other role refused)
 *   stageExercise / unstageExercise         planner
 *   startExercise, pauseExercise,
 *     resumeExercise, endExercise,
 *     reopenExercise, freezeTiers           controller             (not planner)
 *   editExerciseSettings (settings, chrome,
 *     practice mode), setLeadController     planner
 *   manageViewOnlyCodes, manageAccounts     planner, controller    (not evaluator)
 *   editContent (inject create/update/delete/
 *     reorder/import, persona edit)         planner, controller
 *   staffPost / staffFollow / staffPin      planner + controller while the exercise is in
 *                                           `build`; controller only in any other state
 *   uploadStaffMedia                        planner, controller    (not evaluator)
 *   conductControl (fire/hold/skip, takedown,
 *     noise, review queue, steering)        controller
 *   raiseAutonomy                           controller AND lead    (swamped ON, autonomy up,
 *                                           tier-policy raise, autonomy restore, provider restore)
 *   lowerAutonomy                           any controller         (swamped OFF, autonomy down)
 */

import { useMemo } from 'react'
import type { ExerciseStatus } from '@/core/exerciseContext'
import { useOptionalSession } from './session'
import type { SessionRole } from './roles'

/** Every gated staff action. See the module header for the table. */
export type StaffAction =
  | 'createExercise'
  | 'renameExercise'
  | 'archiveExercise'
  | 'unarchiveExercise'
  | 'manageOrgPeople'
  | 'stageExercise'
  | 'unstageExercise'
  | 'startExercise'
  | 'pauseExercise'
  | 'resumeExercise'
  | 'endExercise'
  | 'reopenExercise'
  | 'freezeTiers'
  | 'editExerciseSettings'
  | 'setLeadController'
  | 'manageViewOnlyCodes'
  | 'manageAccounts'
  | 'editContent'
  | 'staffPost'
  | 'staffFollow'
  | 'staffPin'
  | 'uploadStaffMedia'
  | 'conductControl'
  | 'raiseAutonomy'
  | 'lowerAutonomy'

/** What a decision may depend on. */
export interface PermissionSubject {
  /** The session's role; `undefined` (no session) fails closed. */
  readonly role: SessionRole | undefined
  /** The session's server-computed lead-controller flag. */
  readonly isLead?: boolean
  /** The exercise's lifecycle status (only the staff-posting rule reads it). */
  readonly exerciseStatus?: ExerciseStatus
}

const PLANNER_OR_CONTROLLER: readonly SessionRole[] = ['planner', 'controller']

/** Static role lists for the actions that depend on the role alone. */
const ROLE_RULES: Readonly<Partial<Record<StaffAction, readonly SessionRole[]>>> = {
  createExercise: ['orgAdmin'],
  renameExercise: ['orgAdmin', 'planner'],
  archiveExercise: ['orgAdmin', 'planner'],
  unarchiveExercise: ['orgAdmin'],
  manageOrgPeople: ['orgAdmin'],
  stageExercise: ['planner'],
  unstageExercise: ['planner'],
  startExercise: ['controller'],
  pauseExercise: ['controller'],
  resumeExercise: ['controller'],
  endExercise: ['controller'],
  reopenExercise: ['controller'],
  freezeTiers: ['controller'],
  editExerciseSettings: ['planner'],
  setLeadController: ['planner'],
  manageViewOnlyCodes: PLANNER_OR_CONTROLLER,
  manageAccounts: PLANNER_OR_CONTROLLER,
  editContent: PLANNER_OR_CONTROLLER,
  uploadStaffMedia: PLANNER_OR_CONTROLLER,
  conductControl: ['controller'],
  lowerAutonomy: ['controller'],
}

/** Staff posting, follows and pins: setup in `build` (planner + controller), conduct otherwise. */
const BUILD_AUTHORING: readonly StaffAction[] = ['staffPost', 'staffFollow', 'staffPin']

/** The text shown beside a control that is disabled because only the lead may raise. */
export const LEAD_ONLY_RAISE_REASON = 'Only the lead controller can raise this'

/**
 * SG-004: the server maps the legacy `scheduled` status to `build`, so the client must too (there
 * is no shared canonical-status map on the frontend; `ExerciseStatus` carries both vocabularies).
 */
function isBuildStatus(status: ExerciseStatus | undefined): boolean {
  return status === 'build' || status === 'scheduled'
}

/** Whether `subject` may perform `action`. Pure; fails closed. */
export function can(action: StaffAction, subject: PermissionSubject): boolean {
  const { role } = subject
  if (role === undefined) return false
  if (action === 'raiseAutonomy') return role === 'controller' && subject.isLead === true
  if ((BUILD_AUTHORING as readonly string[]).includes(action)) {
    if (role === 'controller') return true
    return role === 'planner' && isBuildStatus(subject.exerciseStatus)
  }
  return ROLE_RULES[action]?.includes(role) ?? false
}

/** The permission checker bound to the signed-in session. */
export interface Permissions {
  /** `can(action)`; staff posting also needs `exerciseStatus` (pass it, or it fails closed). */
  readonly can: (action: StaffAction, exerciseStatus?: ExerciseStatus) => boolean
  readonly role: SessionRole | undefined
  readonly isLead: boolean
}

/**
 * Reads the role and `isLead` off the real session (never a mock identity) and binds `can`.
 * Non-throwing: with no session every answer is false.
 */
export function usePermissions(): Permissions {
  const session = useOptionalSession()
  const role = session?.role
  const isLead = session?.isLead === true
  return useMemo(
    () => ({
      role,
      isLead,
      can: (action: StaffAction, exerciseStatus?: ExerciseStatus) =>
        can(action, { role, isLead, exerciseStatus }),
    }),
    [role, isLead],
  )
}
