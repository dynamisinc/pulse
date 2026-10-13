/** The Add-participant form rules (easy-login story 10): the RosterRowWrite contract. */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ROSTER_FORM,
  normalizeSignInName,
  toRosterRowWrite,
  validateRosterForm,
  type RosterFormValues,
} from './rosterValidation'

const valid: RosterFormValues = { ...EMPTY_ROSTER_FORM, name: 'Jane Smith' }

describe('validateRosterForm', () => {
  it('accepts a name alone', () => {
    expect(validateRosterForm(valid)).toEqual({})
  })

  it('requires a name (blank and whitespace)', () => {
    expect(validateRosterForm({ ...valid, name: '' }).name).toMatch(/enter the participant/i)
    expect(validateRosterForm({ ...valid, name: '   ' }).name).toMatch(/enter the participant/i)
  })

  it('caps name at 256, agency and role at 128', () => {
    expect(validateRosterForm({ ...valid, name: 'x'.repeat(257) }).name).toMatch(/256/)
    expect(validateRosterForm({ ...valid, name: 'x'.repeat(256) }).name).toBeUndefined()
    expect(validateRosterForm({ ...valid, agency: 'x'.repeat(129) }).agency).toMatch(/128/)
    expect(validateRosterForm({ ...valid, role: 'x'.repeat(129) }).role).toMatch(/128/)
  })

  it('checks email shape only when one is given', () => {
    expect(validateRosterForm({ ...valid, email: '' }).email).toBeUndefined()
    expect(validateRosterForm({ ...valid, email: 'jane@fulco.gov' }).email).toBeUndefined()
    expect(validateRosterForm({ ...valid, email: 'jane' }).email).toMatch(/valid email/i)
    expect(validateRosterForm({ ...valid, email: 'jane@fulco' }).email).toMatch(/valid email/i)
    expect(validateRosterForm({ ...valid, email: 'a b@c.d' }).email).toMatch(/valid email/i)
    expect(validateRosterForm({ ...valid, email: `${'a'.repeat(250)}@x.io` }).email).toMatch(/valid email/i)
  })

  it.each(['jsmith', 'j.smith', 'j_smith-2', 'abc', 'a'.repeat(32), '9lives'])(
    'accepts the sign-in name %s',
    signInName => {
      expect(validateRosterForm({ ...valid, signInName }).signInName).toBeUndefined()
    },
  )

  it.each(['ab', 'a'.repeat(33), '.jsmith', '-jsmith', 'j smith', 'j@smith', 'jsmíth'])(
    'rejects the sign-in name %s',
    signInName => {
      expect(validateRosterForm({ ...valid, signInName }).signInName).toMatch(/3 to 32/)
    },
  )

  it('validates the sign-in name AFTER trim + lower-case (JSmith is fine)', () => {
    expect(validateRosterForm({ ...valid, signInName: '  JSmith ' }).signInName).toBeUndefined()
  })

  it('treats a blank sign-in name as "derive it"', () => {
    expect(validateRosterForm({ ...valid, signInName: '   ' }).signInName).toBeUndefined()
  })

  it('reports every problem at once', () => {
    const errors = validateRosterForm({ ...valid, name: '', email: 'x', signInName: 'a' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'signInName'])
  })
})

describe('toRosterRowWrite', () => {
  it('trims and lower-cases the sign-in name', () => {
    expect(toRosterRowWrite({
      name: ' Jane Smith ',
      agency: ' Fulco ',
      role: ' Liaison ',
      email: ' jane@fulco.gov ',
      personaHandle: ' @FulcoEM ',
      signInName: ' JSmith ',
    })).toEqual({
      name: 'Jane Smith',
      agency: 'Fulco',
      role: 'Liaison',
      email: 'jane@fulco.gov',
      personaHandle: '@FulcoEM',
      signInName: 'jsmith',
    })
  })

  it('normalizeSignInName is trim + lower-case', () => {
    expect(normalizeSignInName('  AbC ')).toBe('abc')
  })
})
