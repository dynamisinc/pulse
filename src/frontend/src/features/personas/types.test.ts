/**
 * features/personas/types.test.ts
 * ---------------------------------------------------------------------------
 * Covers the pure model helpers (story 01): the type-driven verification
 * default (institutional voices default verified; everyone else does not), and
 * the stable instance-id convention other features reference.
 */
import { describe, it, expect } from 'vitest'
import { verificationDefaultFor, personaIdForHandle, type PersonaType } from './types'

describe('verificationDefaultFor (COR-020 type-driven default)', () => {
  it('defaults institutional voices to verified', () => {
    expect(verificationDefaultFor('news-outlet')).toBe(true)
    expect(verificationDefaultFor('agency')).toBe(true)
    expect(verificationDefaultFor('weather-scientific')).toBe(true)
  })

  it('defaults every other persona type to unverified', () => {
    const unverified: PersonaType[] = ['citizen', 'influencer', 'business', 'bad-actor']
    for (const type of unverified) {
      expect(verificationDefaultFor(type)).toBe(false)
    }
  })
})

describe('personaIdForHandle', () => {
  it('builds a stable, lowercased instance id', () => {
    expect(personaIdForHandle('FairhavenWater')).toBe('persona-fairhavenwater')
    expect(personaIdForHandle('dreyes_fh')).toBe('persona-dreyes_fh')
  })
})
