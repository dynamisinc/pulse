/**
 * features/personas/seedCast.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-02 seeding ACs (COR-021) and the SOC-052 impersonation pair:
 *   - one action instantiates the WHOLE cast as exercise-scoped instances;
 *   - instances get believable derived state (varied follower counts;
 *     pre-exercise join dates rendered later in scenario time);
 *   - seeding is deterministic (stable across runs);
 *   - the verified utility and its UNVERIFIED lookalike both exist and are a
 *     plausible pair whose ONLY participant-visible trust difference is the
 *     verified flag (the platform never flags the fake).
 */
import { describe, it, expect } from 'vitest'
import { seedCast } from './seedCast'
import { FAIRHAVEN_BASELINE } from './casts'
import { PERSONA_TEMPLATES } from './personaTemplates'
import { personaIdForHandle } from './types'

const EX = 'ex-test-9999'
const seed = () => seedCast(FAIRHAVEN_BASELINE, EX, PERSONA_TEMPLATES)

describe('seedCast — one-action seeding with derived state (COR-021)', () => {
  it('instantiates every cast member as an exercise-scoped instance', () => {
    const personas = seed()
    expect(personas).toHaveLength(FAIRHAVEN_BASELINE.templateIds.length)
    for (const p of personas) {
      expect(p.exerciseId).toBe(EX)
      expect(p.id).toBe(personaIdForHandle(p.handle))
    }
  })

  it('derives varied, positive follower counts (not a single flat value)', () => {
    const personas = seed()
    for (const p of personas) expect(p.followerCount).toBeGreaterThan(0)
    const distinct = new Set(personas.map(p => p.followerCount))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('gives every instance a pre-exercise join date (COR-053 scenario instant)', () => {
    const personas = seed()
    const epoch = Date.parse('2026-06-15T12:00:00Z')
    for (const p of personas) {
      const joined = Date.parse(p.joinedAt)
      expect(Number.isNaN(joined)).toBe(false)
      expect(joined).toBeLessThan(epoch)
    }
  })

  it('has the bad-actor lookalike join most recently (the "joined this week" tell)', () => {
    const personas = seed()
    const fake = personas.find(p => p.handle === 'FairhavenWaterUpd')
    const real = personas.find(p => p.handle === 'FairhavenWater')
    expect(fake).toBeDefined()
    expect(real).toBeDefined()
    if (!fake || !real) return
    expect(Date.parse(fake.joinedAt)).toBeGreaterThan(Date.parse(real.joinedAt))
  })

  it('is deterministic — seeding the same cast twice yields identical instances', () => {
    expect(seed()).toEqual(seed())
  })
})

describe('SOC-052 impersonation pair', () => {
  it('carries a verified utility and an UNVERIFIED lookalike whose only trust signal is the mark', () => {
    const personas = seed()
    const real = personas.find(p => p.handle === 'FairhavenWater')
    const fake = personas.find(p => p.handle === 'FairhavenWaterUpd')
    expect(real).toBeDefined()
    expect(fake).toBeDefined()
    if (!real || !fake) return

    // A plausible lookalike: both org accounts, same monogram, adjacent identity.
    expect(real.kind).toBe('org')
    expect(fake.kind).toBe('org')
    expect(fake.initials).toBe(real.initials)

    // The ONLY participant-visible trust difference is the verified mark.
    expect(real.verified).toBe(true)
    expect(fake.verified).toBe(false)

    // The platform never flags the fake — the model has no "impersonator" flag
    // a participant surface could read; absence of the mark is the only signal.
    expect(Object.keys(fake)).not.toContain('isImpersonator')
    expect(Object.keys(fake)).not.toContain('flagged')
  })
})

describe('seedCast robustness', () => {
  it('skips a cast member whose template is missing rather than throwing', () => {
    const brokenCast = { ...FAIRHAVEN_BASELINE, templateIds: ['tmpl-does-not-exist', ...FAIRHAVEN_BASELINE.templateIds] }
    const personas = seedCast(brokenCast, EX, PERSONA_TEMPLATES)
    expect(personas).toHaveLength(FAIRHAVEN_BASELINE.templateIds.length)
  })
})
