/**
 * core/auth/roles.test.ts
 * ---------------------------------------------------------------------------
 * Pure-logic coverage for the role set + guards (COR-010, story 01):
 *   - the six roles gate the right surface family (participant / staff / org);
 *   - a participant-flavored role never classifies as staff (XC-002);
 *   - the evaluator cannot write in the sim (COR-013);
 *   - the wire guard rejects out-of-vocabulary roles (fail-closed).
 */
import { describe, it, expect } from 'vitest'
import {
  PARTICIPANT_ROLES,
  STAFF_ROLES,
  isParticipantRole,
  isStaffRole,
  canWriteInSim,
  isExerciseRole,
  type ExerciseRole,
} from './roles'

const ALL: ExerciseRole[] = [
  'participant',
  'pio',
  'controller',
  'evaluator',
  'planner',
  'orgAdmin',
]

describe('role surface classification', () => {
  it('classifies participant and pio as participant-world roles', () => {
    expect(isParticipantRole('participant')).toBe(true)
    expect(isParticipantRole('pio')).toBe(true)
  })

  it('classifies controller, evaluator and planner as staff roles', () => {
    expect(isStaffRole('controller')).toBe(true)
    expect(isStaffRole('evaluator')).toBe(true)
    expect(isStaffRole('planner')).toBe(true)
  })

  it('never lets a participant-world role reach the staff family (XC-002)', () => {
    for (const role of PARTICIPANT_ROLES) {
      expect(isStaffRole(role)).toBe(false)
    }
    for (const role of STAFF_ROLES) {
      expect(isParticipantRole(role)).toBe(false)
    }
  })

  it('treats orgAdmin as neither a participant nor a staff-console role', () => {
    expect(isParticipantRole('orgAdmin')).toBe(false)
    expect(isStaffRole('orgAdmin')).toBe(false)
  })

  it('classifies every role as exactly participant, staff, or org (no gaps/overlaps)', () => {
    for (const role of ALL) {
      const inParticipant = isParticipantRole(role)
      const inStaff = isStaffRole(role)
      const inOrg = role === 'orgAdmin'
      expect(Number(inParticipant) + Number(inStaff) + Number(inOrg)).toBe(1)
    }
  })
})

describe('canWriteInSim (COR-013)', () => {
  it('denies the evaluator write in the sim', () => {
    expect(canWriteInSim('evaluator')).toBe(false)
  })

  it('allows every non-evaluator role to write in the sim', () => {
    for (const role of ALL.filter(r => r !== 'evaluator')) {
      expect(canWriteInSim(role)).toBe(true)
    }
  })
})

describe('isExerciseRole (wire guard)', () => {
  it('accepts every known role', () => {
    for (const role of ALL) {
      expect(isExerciseRole(role)).toBe(true)
    }
  })

  it('rejects an out-of-vocabulary or non-string value (fail-closed)', () => {
    expect(isExerciseRole('superuser')).toBe(false)
    expect(isExerciseRole('')).toBe(false)
    expect(isExerciseRole(undefined)).toBe(false)
    expect(isExerciseRole(3)).toBe(false)
  })
})
