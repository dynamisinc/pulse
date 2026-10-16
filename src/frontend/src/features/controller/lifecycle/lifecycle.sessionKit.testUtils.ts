/**
 * features/controller/lifecycle/lifecycle.sessionKit.testUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY session stand-in for the StartEx / EndEx control tests (demo-polish C6). Never
 * imported by app code.
 *
 * The control gates on the signed-in session's role, and the only way to provide a session is
 * `SessionProvider`, which resolves one through `resolveSession()`. The mock resolver always
 * returns a PARTICIPANT, so a test that needs a controller (or an evaluator, a planner...)
 * replaces the resolver with this one. A test file wires it with
 *
 *     vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
 *       ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
 *       resolveSession: (await import('./lifecycle.sessionKit.testUtils')).resolveSession,
 *     }))
 *
 * and picks the role per case with `setSessionRole` (`renderControl({ sessionRole })` does it).
 */

import type { ExerciseRole } from '@/core/auth'
import type { Session } from '@/core/auth'

/** The default: the role the control is FOR. */
const DEFAULT_ROLE: ExerciseRole = 'controller'

let role: ExerciseRole = DEFAULT_ROLE

/** The role the next resolved session carries. */
export function setSessionRole(next: ExerciseRole): void {
  role = next
}

/** Back to `controller`. */
export function resetSessionRole(): void {
  role = DEFAULT_ROLE
}

/** The `resolveSession` replacement: a staff session with the chosen role, no persona. */
export async function resolveSession(): Promise<Session> {
  return {
    exerciseId: 'ex-mock-0001',
    scope: 'exercise',
    personId: null,
    world: 'participant',
    isLead: false,
    accountId: `acct-${role}`,
    role,
    actingHumanId: `human-${role}`,
    isReadOnly: false,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }
}
