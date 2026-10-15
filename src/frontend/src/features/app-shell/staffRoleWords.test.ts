/**
 * features/app-shell/staffRoleWords.test.ts
 * ---------------------------------------------------------------------------
 * The not-allowed page's wording (demo-feedback story 15, DF-20): every staff
 * role in words, and a role list joined the way a sentence says it.
 */
import { describe, it, expect } from 'vitest'
import { STAFF_SURFACE_ROLES } from './staffRouting'
import { STAFF_ROLE_WORDS, describeRequiredRoles, joinRoleWords } from './staffRoleWords'

describe('staff roles in words', () => {
  it('has words for every role that can appear in allowedRoles', () => {
    for (const role of STAFF_SURFACE_ROLES) {
      expect(STAFF_ROLE_WORDS[role]).toMatch(/^[a-z ]+$/)
    }
  })

  it('says "org admin", never the wire literal', () => {
    expect(STAFF_ROLE_WORDS.orgAdmin).toBe('org admin')
  })
})

describe('joinRoleWords', () => {
  it.each([
    [[], ''],
    [['planner'], 'planner'],
    [['planner', 'controller'], 'planner or controller'],
    [['planner', 'orgAdmin', 'controller'], 'planner, org admin or controller'],
    [
      ['controller', 'evaluator', 'planner', 'orgAdmin'],
      'controller, evaluator, planner or org admin',
    ],
  ] as const)('joins %j as "%s", in the declared order', (roles, expected) => {
    expect(joinRoleWords(roles)).toBe(expected)
  })
})

describe('describeRequiredRoles', () => {
  it('reads as one sentence naming the roles and the surface', () => {
    expect(describeRequiredRoles(['planner', 'orgAdmin', 'controller'], 'Exercise Management'))
      .toBe('You need the planner, org admin or controller role to open Exercise Management.')
  })

  it('never names an empty role when nobody may open the surface', () => {
    expect(describeRequiredRoles([], 'Replay')).toBe('No role can open Replay yet.')
  })
})
