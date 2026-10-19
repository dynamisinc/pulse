/**
 * core/auth/withRole.testUtils.ts
 * ---------------------------------------------------------------------------
 * Test-only helper: re-roles a session fixture without breaking the `Session` union.
 * `Session` is discriminated on `scope` (an `ExerciseRole` rides an exercise session, `orgAdmin`
 * rides an org session with no exercise), so `{ ...base, role }` for an arbitrary role no longer
 * type-checks. `withRole` picks the right variant: `orgAdmin` -> `{ scope: 'org', exerciseId:
 * null }`, any exercise role -> `{ scope: 'exercise' }` keeping the base's exercise id.
 * Never imported by production code.
 */
import type { ExerciseSession, Session } from './sessionResolver'
import type { SessionRole } from './roles'

export function withRole(base: ExerciseSession, role: SessionRole): Session {
  if (role === 'orgAdmin') return { ...base, scope: 'org', exerciseId: null, role }
  return { ...base, scope: 'exercise', role }
}
