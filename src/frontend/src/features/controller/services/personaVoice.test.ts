/**
 * features/controller/services/personaVoice.test.ts
 * ---------------------------------------------------------------------------
 * Unit coverage for `persona-operation/03`'s pure read helpers (CTL-003,
 * COR-020, SOC-054, D5-014/2.4):
 *  - `resolveVoiceNotes` resolves voice notes from the TEMPLATE (via
 *    `templateId`), never off the instance directly;
 *  - `categoryChipLabel` covers every `PersonaType`, with a distinct label
 *    per category (never color-only — the label text itself is the signal).
 */
import { describe, expect, it } from 'vitest'
import { PERSONA_TEMPLATES, type Persona, type PersonaType } from '@/features/personas'
import { audienceBandLabel, categoryChipLabel, resolveVoiceNotes } from './personaVoice'

function buildPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-test-author',
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-fairhavenwater',
    displayName: 'Fairhaven Water Utility',
    handle: 'fairhavenwater',
    kind: 'org',
    personaType: 'agency',
    verified: true,
    avatarColor: '#19647e',
    initials: 'FW',
    audienceBand: 'mid',
    followerCount: 4200,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveVoiceNotes (COR-020 — voice notes live on the template)', () => {
  it('resolves the voice notes from the persona\'s template, not the instance', () => {
    const persona = buildPersona()
    const template = PERSONA_TEMPLATES.find(t => t.id === persona.templateId)
    expect(template).toBeDefined()
    expect(resolveVoiceNotes(persona)).toBe(template?.voiceNotes)
    expect(resolveVoiceNotes(persona)).toBeTruthy()
    // Guard against a future accidental `persona.voiceNotes` read: the
    // instance shape genuinely has no such field.
    expect((persona as unknown as Record<string, unknown>).voiceNotes).toBeUndefined()
  })

  it('returns undefined for an unknown templateId rather than throwing', () => {
    const persona = buildPersona({ templateId: 'tmpl-does-not-exist' })
    expect(resolveVoiceNotes(persona)).toBeUndefined()
  })
})

describe('categoryChipLabel (D5-014/2.4 — wrong-persona defense)', () => {
  const expected: Record<PersonaType, string> = {
    citizen: 'CITIZEN VOICE',
    agency: 'OFFICIAL ACCOUNT',
    'weather-scientific': 'OFFICIAL ACCOUNT',
    'news-outlet': 'NEWS / MEDIA',
    influencer: 'INFLUENCER / CREATOR',
    business: 'BUSINESS ACCOUNT',
    'bad-actor': 'UNOFFICIAL / BAD ACTOR',
  }

  it.each(Object.entries(expected))('maps %s -> %s', (personaType, label) => {
    expect(categoryChipLabel(personaType as PersonaType)).toBe(label)
  })

  it('covers every PersonaType with a non-empty label', () => {
    const allTypes = Object.keys(expected) as PersonaType[]
    for (const type of allTypes) {
      expect(categoryChipLabel(type).length).toBeGreaterThan(0)
    }
  })
})

describe('audienceBandLabel (SOC-054)', () => {
  it('renders a distinct label for every band', () => {
    const bands = ['nano', 'micro', 'mid', 'large', 'mega'] as const
    const labels = bands.map(audienceBandLabel)
    expect(new Set(labels).size).toBe(bands.length)
  })
})
