/**
 * features/controller/personaEdit/personaEditForm.test.ts
 * ---------------------------------------------------------------------------
 * The pure form model of the persona profile edit (demo-polish story 21 /
 * PE-FE): validation and — the load-bearing part — the JSON merge-patch diff.
 *
 * Pins: ONLY changed fields are sent; clearing is `null`, never `""`; the persona
 * is never echoed (no `id`/`handle`/`avatarUrl` can appear); `{}` when nothing
 * changed; image `clear` is a no-op for a persona without an image; field NAMES
 * (telemetry `fields`) are in canonical order and carry no values. Validation
 * counts CODE POINTS on the trimmed text (a surrogate pair is one), refuses what
 * the server refuses (lone surrogate, controls, bidi overrides, invisible name,
 * raw text over 4x the bound) and never truncates.
 */
import { describe, expect, it } from 'vitest'
import type { StaffPersona } from '@/features/personas'
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  LOCATION_MAX,
  buildPersonaPatch,
  countedLength,
  draftFromPersona,
  isDraftValid,
  isPatchEmpty,
  patchFieldNames,
  validateDraft,
} from './personaEditForm'
import type { PersonaEditDraft } from './types'

function persona(overrides: Partial<StaffPersona> = {}): StaffPersona {
  return {
    id: 'persona-x',
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-x',
    displayName: 'Fairhaven Water Utility',
    handle: 'FairhavenWater',
    kind: 'org',
    personaType: 'agency',
    verified: true,
    avatarColor: '#19647e',
    initials: 'FW',
    bio: 'Official account.',
    audienceBand: 'mid',
    followerCount: 4200,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function draftWith(
  overrides: Partial<PersonaEditDraft>,
  base: StaffPersona = persona(),
): PersonaEditDraft {
  return { ...draftFromPersona(base), ...overrides }
}

describe('draftFromPersona / buildPersonaPatch — the merge-patch diff', () => {
  it('an untouched draft produces an EMPTY patch (and no field names)', () => {
    const p = persona({ location: 'Fairhaven', avatarUrl: '/a.svg', bannerUrl: '/b.svg' })
    const patch = buildPersonaPatch(p, draftFromPersona(p))
    expect(patch).toEqual({})
    expect(isPatchEmpty(patch)).toBe(true)
    expect(patchFieldNames(patch)).toEqual([])
  })

  it('sends ONLY the changed fields (absent = unchanged)', () => {
    const p = persona()
    const patch = buildPersonaPatch(p, draftWith({ displayName: 'Fairhaven Water' }))
    expect(patch).toEqual({ displayName: 'Fairhaven Water' })
    expect(Object.keys(patch)).toEqual(['displayName'])
  })

  it('trims text and compares the trimmed value (re-typing the same name is no change)', () => {
    const p = persona()
    expect(buildPersonaPatch(p, draftWith({ displayName: '  Fairhaven Water Utility  ' }))).toEqual({})
    expect(buildPersonaPatch(p, draftWith({ bio: '  Official account.  ' }))).toEqual({})
    expect(buildPersonaPatch(p, draftWith({ bio: '  New bio ' }))).toEqual({ bio: 'New bio' })
  })

  it('clears bio and location with null — never ""', () => {
    const p = persona({ bio: 'Has a bio', location: 'Somewhere' })
    const patch = buildPersonaPatch(p, draftWith({ bio: '   ', location: '' }, p))
    expect(patch).toEqual({ bio: null, location: null })
    expect(patch.bio).toBeNull()
    expect(JSON.stringify(patch)).not.toContain('""')
  })

  it('emptying a bio the persona never had is NOT a change', () => {
    const p = persona({ bio: undefined })
    expect(buildPersonaPatch(p, draftWith({ bio: '' }, p))).toEqual({})
  })

  it('sets a bio / location on a persona without one', () => {
    const p = persona({ bio: undefined })
    expect(buildPersonaPatch(p, draftWith({ bio: 'Hi', location: 'Town' }, p))).toEqual({
      bio: 'Hi',
      location: 'Town',
    })
  })

  it('sends verified only when it changed, in either direction', () => {
    const on = persona({ verified: true })
    expect(buildPersonaPatch(on, draftWith({ verified: true }, on))).toEqual({})
    expect(buildPersonaPatch(on, draftWith({ verified: false }, on))).toEqual({ verified: false })
    const off = persona({ verified: false })
    expect(buildPersonaPatch(off, draftWith({ verified: true }, off))).toEqual({ verified: true })
  })

  it('maps image choices: set -> the media id; clear -> null (only if there is an image); keep -> absent', () => {
    const withImages = persona({ avatarUrl: '/a.svg', bannerUrl: '/b.svg' })
    expect(
      buildPersonaPatch(withImages, draftWith({
        avatar: { mode: 'set', mediaId: 'media-1', previewUrl: '/x.svg' },
        banner: { mode: 'clear' },
      }, withImages)),
    ).toEqual({ avatarMediaId: 'media-1', bannerMediaId: null })

    // A persona with no avatar has nothing to clear: no request member at all.
    const bare = persona()
    expect(buildPersonaPatch(bare, draftWith({ avatar: { mode: 'clear' } }, bare))).toEqual({})
    expect(buildPersonaPatch(bare, draftWith({ avatar: { mode: 'keep' } }, bare))).toEqual({})
  })

  it('NEVER echoes the persona: no id / handle / kind / personaType / exerciseId / urls', () => {
    const p = persona({ avatarUrl: '/a.svg', bannerUrl: '/b.svg', location: 'L' })
    const everything = buildPersonaPatch(p, {
      displayName: 'New name',
      bio: 'New bio',
      location: 'New place',
      verified: false,
      avatar: { mode: 'set', mediaId: 'm-a' },
      banner: { mode: 'set', mediaId: 'm-b' },
    })
    expect(Object.keys(everything).sort()).toEqual(
      ['avatarMediaId', 'bannerMediaId', 'bio', 'displayName', 'location', 'verified'],
    )
    for (const forbidden of ['id', 'handle', 'kind', 'personaType', 'exerciseId', 'avatarUrl', 'bannerUrl']) {
      expect(everything).not.toHaveProperty(forbidden)
    }
  })

  it('names the changed fields in canonical order — names only, no values', () => {
    const p = persona({ avatarUrl: '/a.svg' })
    const patch = buildPersonaPatch(p, {
      ...draftFromPersona(p),
      bio: 'secret new bio text',
      displayName: 'Brand New Name',
      verified: false,
      avatar: { mode: 'clear' },
    })
    const names = patchFieldNames(patch)
    expect(names).toEqual(['displayName', 'bio', 'verified', 'avatarMediaId'])
    expect(JSON.stringify(names)).not.toMatch(/secret|Brand/)
  })
})

describe('validateDraft — mirrors the server, counts code points, never truncates', () => {
  it('a draft that reproduces the persona is valid', () => {
    expect(isDraftValid(draftFromPersona(persona()))).toBe(true)
    expect(validateDraft(draftFromPersona(persona()))).toEqual({})
  })

  it('requires a display name (blank and whitespace-only)', () => {
    expect(validateDraft(draftWith({ displayName: '' })).displayName).toBe('Display name is required.')
    expect(validateDraft(draftWith({ displayName: '    ' })).displayName).toBe('Display name is required.')
  })

  it('bounds: name <= 100, bio <= 512, location <= 100 (on the trimmed text)', () => {
    expect(validateDraft(draftWith({ displayName: 'n'.repeat(DISPLAY_NAME_MAX) }))).toEqual({})
    expect(validateDraft(draftWith({ displayName: 'n'.repeat(DISPLAY_NAME_MAX + 1) })).displayName)
      .toBe('Display name must be at most 100 characters (1 over).')
    expect(validateDraft(draftWith({ bio: 'b'.repeat(BIO_MAX) }))).toEqual({})
    expect(validateDraft(draftWith({ bio: 'b'.repeat(BIO_MAX + 3) })).bio)
      .toBe('Bio must be at most 512 characters (3 over).')
    expect(validateDraft(draftWith({ location: 'l'.repeat(LOCATION_MAX) }))).toEqual({})
    expect(validateDraft(draftWith({ location: 'l'.repeat(LOCATION_MAX + 1) })).location)
      .toBe('Location must be at most 100 characters (1 over).')
    // Surrounding whitespace does not count towards the limit.
    expect(validateDraft(draftWith({ location: `  ${'l'.repeat(LOCATION_MAX)}  ` }))).toEqual({})
  })

  it('counts CODE POINTS: an emoji is one character, so 512 emoji fit and 513 do not', () => {
    const emoji = '😀' // one code point, two UTF-16 units
    expect(emoji.length).toBe(2)
    expect(countedLength(emoji)).toBe(1)
    expect(validateDraft(draftWith({ bio: emoji.repeat(BIO_MAX) }))).toEqual({})
    expect(validateDraft(draftWith({ bio: emoji.repeat(BIO_MAX + 1) })).bio)
      .toBe('Bio must be at most 512 characters (1 over).')
  })

  it('refuses raw text over 4x the bound even when the trimmed text is short', () => {
    const padded = `x${' '.repeat(4 * LOCATION_MAX + 5)}`
    expect(countedLength(padded)).toBe(1)
    expect(validateDraft(draftWith({ location: padded })).location)
      .toMatch(/^Location must be at most 100 characters\. This text is \d+ characters long/)
    // Right at 4x is still fine.
    expect(validateDraft(draftWith({ location: `x${' '.repeat(4 * LOCATION_MAX - 1)}` }))).toEqual({})
  })

  it('refuses a lone surrogate (a half-emoji) in any text field', () => {
    const half = '😀'.charAt(0)
    for (const field of ['displayName', 'bio', 'location'] as const) {
      const problems = validateDraft(draftWith({ [field]: `ok ${half}` }))
      expect(problems[field]).toMatch(/broken character/)
    }
    // A whole pair is fine.
    expect(validateDraft(draftWith({ bio: 'fine 😀' }))).toEqual({})
  })

  it('refuses C0/C1 control characters in all three fields', () => {
    for (const field of ['displayName', 'bio', 'location'] as const) {
      expect(validateDraft(draftWith({ [field]: 'a\u0000b' }))[field]).toMatch(/control characters/)
      expect(validateDraft(draftWith({ [field]: 'a\u0085b' }))[field]).toMatch(/control characters/)
      expect(validateDraft(draftWith({ [field]: 'a\u001Fb' }))[field]).toMatch(/control characters/)
    }
  })

  it('lets TAB / LF / CR through in the multi-line BIO only', () => {
    expect(validateDraft(draftWith({ bio: 'line one\nline two\r\n\tindented' }))).toEqual({})
    expect(validateDraft(draftWith({ displayName: 'Two\nLines' })).displayName)
      .toMatch(/control characters/)
    expect(validateDraft(draftWith({ location: 'Tab\there' })).location).toMatch(/control characters/)
  })

  it('refuses bidi overrides (U+202A-202E, U+2066-2069) but not other direction marks', () => {
    for (const cp of [0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]) {
      const text = `evil${String.fromCodePoint(cp)}name`
      for (const field of ['displayName', 'bio', 'location'] as const) {
        expect(validateDraft(draftWith({ [field]: text }))[field]).toMatch(/direction override/)
      }
    }
    // LRM / RLM are ordinary marks, not overrides.
    expect(validateDraft(draftWith({ displayName: 'Name‎' }))).toEqual({})
  })

  it('refuses a display name with no VISIBLE character (zero-width / format only)', () => {
    expect(validateDraft(draftWith({ displayName: '​​' })).displayName)
      .toBe('Display name needs at least one visible character.')
    expect(validateDraft(draftWith({ displayName: '‍﻿' })).displayName)
      .toBe('Display name needs at least one visible character.')
    // The same characters in a bio/location are not a "no visible character" problem.
    expect(validateDraft(draftWith({ bio: '​' }))).toEqual({})
  })

  it('ALLOWS lookalike (homoglyph) names — a lookalike account is the point of SOC-052', () => {
    // Cyrillic "а" / "е" / "о" in place of Latin letters.
    expect(validateDraft(draftWith({ displayName: 'Fаirhаvеn Wаtеr Utility' }))).toEqual({})
    expect(validateDraft(draftWith({ displayName: 'Fairhaven Water Utility ✔' }))).toEqual({})
  })

  it('never truncates: an over-long value is reported, not cut', () => {
    const long = 'x'.repeat(BIO_MAX + 100)
    const draft = draftWith({ bio: long })
    expect(draft.bio).toHaveLength(long.length)
    expect(validateDraft(draft).bio).toBeDefined()
    expect(buildPersonaPatch(persona(), draft).bio).toBe(long)
  })
})
