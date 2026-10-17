/**
 * core/auth/rolePermissions.test.tsx
 * ---------------------------------------------------------------------------
 * The client mirror of the backend role matrix (identity-auth-roles story 17, issue #573),
 * asserted table-driven: EVERY action against EVERY role, so a change to the table must change
 * this file in the same PR. Also covers the lead rule (raise needs controller AND lead), the
 * build-versus-conduct staff-posting rule, fail-closed on no session / unknown status, and that
 * `usePermissions()` reads the role and `isLead` off the session (never infers them).
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { can, usePermissions, type StaffAction } from './rolePermissions'
import type { SessionRole } from './roles'
import { resetStubSession, setStubSession } from './rolePermissions.testUtils'

vi.mock('./session', async importOriginal => ({
  ...(await importOriginal<typeof import('./session')>()),
  useOptionalSession: (await import('./rolePermissions.testUtils')).stubbedSession,
}))

const ROLES: readonly SessionRole[] = [
  'orgAdmin', 'planner', 'controller', 'evaluator', 'participant', 'pio',
]

/** action -> the roles allowed (role-only actions; lead and build rules are tested below). */
const ROLE_ONLY: ReadonlyArray<readonly [StaffAction, readonly SessionRole[]]> = [
  ['createExercise', ['orgAdmin']],
  ['renameExercise', ['orgAdmin', 'planner']],
  ['archiveExercise', ['orgAdmin', 'planner']],
  ['unarchiveExercise', ['orgAdmin']],
  ['stageExercise', ['planner']],
  ['unstageExercise', ['planner']],
  ['startExercise', ['controller']],
  ['pauseExercise', ['controller']],
  ['resumeExercise', ['controller']],
  ['endExercise', ['controller']],
  ['reopenExercise', ['controller']],
  ['freezeTiers', ['controller']],
  ['editExerciseSettings', ['planner']],
  ['setLeadController', ['planner']],
  ['manageViewOnlyCodes', ['planner', 'controller']],
  ['manageAccounts', ['planner', 'controller']],
  ['editContent', ['planner', 'controller']],
  ['uploadStaffMedia', ['planner', 'controller']],
  ['conductControl', ['controller']],
  ['lowerAutonomy', ['controller']],
]

describe('can() - role-only actions, every role', () => {
  for (const [action, allowed] of ROLE_ONLY) {
    for (const role of ROLES) {
      const expected = allowed.includes(role)
      it(`${action}: ${role} -> ${expected ? 'allowed' : 'refused'}`, () => {
        // Lead flag and status must not change a role-only answer.
        expect(can(action, { role, isLead: false })).toBe(expected)
        expect(can(action, { role, isLead: true, exerciseStatus: 'live' })).toBe(expected)
      })
    }
  }

  it('the evaluator is refused every write action (#61)', () => {
    for (const [action] of ROLE_ONLY) {
      expect(can(action, { role: 'evaluator', isLead: true })).toBe(false)
    }
    for (const action of ['staffPost', 'staffFollow', 'staffPin', 'raiseAutonomy'] as const) {
      expect(can(action, { role: 'evaluator', isLead: true, exerciseStatus: 'build' })).toBe(false)
    }
  })

  it('a planner is allowed the inject / persona content actions (story 17 widened them)', () => {
    expect(can('editContent', { role: 'planner' })).toBe(true)
  })

  it('a planner is refused the live lifecycle transitions and a controller the planner ones', () => {
    expect(can('startExercise', { role: 'planner' })).toBe(false)
    expect(can('stageExercise', { role: 'controller' })).toBe(false)
    expect(can('archiveExercise', { role: 'controller' })).toBe(false)
  })
})

describe('can() - raising needs the lead controller (raise-only, Option A)', () => {
  for (const role of ROLES) {
    for (const isLead of [true, false]) {
      const expected = role === 'controller' && isLead
      it(`raiseAutonomy: ${role}, isLead=${isLead} -> ${expected ? 'allowed' : 'refused'}`, () => {
        expect(can('raiseAutonomy', { role, isLead })).toBe(expected)
      })
    }
  }

  it('lowering stays open to a non-lead controller', () => {
    expect(can('lowerAutonomy', { role: 'controller', isLead: false })).toBe(true)
  })

  it('an absent isLead is not a lead', () => {
    expect(can('raiseAutonomy', { role: 'controller' })).toBe(false)
  })
})

describe('can() - legacy `scheduled` is build (SG-004, the server maps it)', () => {
  for (const action of ['staffPost', 'staffFollow', 'staffPin'] as const) {
    it(`${action}: a planner may in scheduled, and still not in active`, () => {
      expect(can(action, { role: 'planner', exerciseStatus: 'scheduled' })).toBe(true)
      expect(can(action, { role: 'planner', exerciseStatus: 'active' })).toBe(false)
    })
  }
})

describe('can() - staff posting, follows and pins: build versus conduct', () => {
  const actions = ['staffPost', 'staffFollow', 'staffPin'] as const
  for (const action of actions) {
    it(`${action}: planner and controller in build; controller only otherwise`, () => {
      expect(can(action, { role: 'planner', exerciseStatus: 'build' })).toBe(true)
      expect(can(action, { role: 'controller', exerciseStatus: 'build' })).toBe(true)
      for (const exerciseStatus of ['staged', 'live', 'paused', 'completed'] as const) {
        expect(can(action, { role: 'planner', exerciseStatus })).toBe(false)
        expect(can(action, { role: 'controller', exerciseStatus })).toBe(true)
      }
    })

    it(`${action}: fails closed for a planner when the status is unknown`, () => {
      expect(can(action, { role: 'planner' })).toBe(false)
    })

    it(`${action}: orgAdmin, participant and pio are refused even in build`, () => {
      for (const role of ['orgAdmin', 'participant', 'pio'] as const) {
        expect(can(action, { role, exerciseStatus: 'build' })).toBe(false)
      }
    })
  }
})

describe('can() - fail closed', () => {
  it('no session (undefined role) is refused everything', () => {
    for (const [action] of ROLE_ONLY) expect(can(action, { role: undefined })).toBe(false)
    expect(can('raiseAutonomy', { role: undefined, isLead: true })).toBe(false)
    expect(can('staffPost', { role: undefined, exerciseStatus: 'build' })).toBe(false)
  })
})

describe('usePermissions()', () => {
  beforeEach(() => resetStubSession())

  it('reads the role and isLead off the session', () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.role).toBe('controller')
    expect(result.current.isLead).toBe(true)
    expect(result.current.can('raiseAutonomy')).toBe(true)
  })

  it('a non-lead controller can lower but not raise', () => {
    setStubSession({ role: 'controller', isLead: false })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.can('lowerAutonomy')).toBe(true)
    expect(result.current.can('raiseAutonomy')).toBe(false)
  })

  it('passes the exercise status through to the posting rule', () => {
    setStubSession({ role: 'planner', isLead: false })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.can('staffPost', 'build')).toBe(true)
    expect(result.current.can('staffPost', 'live')).toBe(false)
  })

  it('with no session every answer is false and it does not throw', () => {
    setStubSession({ role: undefined })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.role).toBeUndefined()
    expect(result.current.can('conductControl')).toBe(false)
  })
})
