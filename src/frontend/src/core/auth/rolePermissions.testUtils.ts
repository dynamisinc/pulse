/**
 * core/auth/rolePermissions.testUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY stand-in for the signed-in session, for suites that exercise role-gated controls
 * through `usePermissions()` (identity-auth-roles story 17). Never imported by app code.
 *
 * `usePermissions()` reads `useOptionalSession()`. A suite replaces that one hook with
 * {@link stubbedSession}, then picks the role and lead flag per case:
 *
 *     vi.mock('@/core/auth/session', async importOriginal => ({
 *       ...(await importOriginal<typeof import('@/core/auth/session')>()),
 *       useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
 *     }))
 *     ...
 *     setStubSession({ role: 'controller', isLead: false })
 *
 * Default is a LEAD controller, so legacy suites that click raise controls keep working. Call
 * {@link resetStubSession} in `beforeEach`.
 */

import type { Session } from './sessionResolver'
import type { SessionRole } from './roles'
import { withRole } from './withRole.testUtils'

interface StubState {
  role: SessionRole | undefined
  isLead: boolean
}

const DEFAULT_STATE: StubState = { role: 'controller', isLead: true }

let state: StubState = { ...DEFAULT_STATE }

/** Chooses the role (or `undefined` for no session) and lead flag the stub reports. */
export function setStubSession(next: Partial<StubState>): void {
  state = { ...state, ...next }
}

/** Back to a lead controller. */
export function resetStubSession(): void {
  state = { ...DEFAULT_STATE }
}

/** The `useOptionalSession` replacement. */
export function stubbedSession(): Session | undefined {
  if (state.role === undefined) return undefined
  return withRole(
    {
      exerciseId: 'ex-mock-0001',
      scope: 'exercise',
      personId: 'person-stub',
      world: 'staff',
      isLead: state.isLead,
      accountId: `acct-${state.role}`,
      role: 'controller',
      actingHumanId: `human-${state.role}`,
      isReadOnly: false,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    state.role,
  )
}
