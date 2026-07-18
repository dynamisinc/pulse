/**
 * features/personas/personaService.test.ts
 * ---------------------------------------------------------------------------
 * Boundary-mocked + shipped-path coverage for the persona read seam. The axios
 * client is mocked at the boundary to exercise `resolvePersonas`'s validation
 * (a malformed body fails closed); a separate no-mock block exercises the
 * ACTUAL wired mock adapter (Wave-0 precedent 19), so the default author set is
 * really tested. Also covers `personaById` and `usePersonaTemplates`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '@/core/services/api'
import {
  resolvePersonas,
  personaById,
  usePersonaTemplates,
  SEEDED_PERSONAS,
} from './personaService'

describe('resolvePersonas (shipped mock path)', () => {
  it('resolves the seeded Fairhaven cast with the verified/unverified pair present', async () => {
    const personas = await resolvePersonas()
    expect(personas.length).toBe(SEEDED_PERSONAS.length)

    const real = personas.find(p => p.handle === 'FairhavenWater')
    const fake = personas.find(p => p.handle === 'FairhavenWaterUpd')
    expect(real?.verified).toBe(true)
    expect(fake?.verified).toBe(false)
  })
})

describe('resolvePersonas (validation boundary)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed when the resolved body is not a persona array', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { nope: true } } as Awaited<ReturnType<typeof api.get>>)
    await expect(resolvePersonas()).rejects.toThrow()
  })

  it('propagates a request failure rather than substituting a default cast', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    await expect(resolvePersonas()).rejects.toThrow('network down')
  })
})

describe('personaById', () => {
  it('finds a seeded instance by its stable id', () => {
    expect(personaById('persona-fulcoem')?.handle).toBe('FulcoEM')
  })

  it('returns undefined for an unknown id', () => {
    expect(personaById('persona-nobody')).toBeUndefined()
  })
})

describe('usePersonaTemplates', () => {
  it('returns the org-library templates (reusable, not exercise-scoped)', () => {
    const templates = usePersonaTemplates()
    expect(templates.length).toBeGreaterThan(0)
    // Templates carry no exercise binding.
    for (const t of templates) {
      expect(t).not.toHaveProperty('exerciseId')
    }
  })
})
