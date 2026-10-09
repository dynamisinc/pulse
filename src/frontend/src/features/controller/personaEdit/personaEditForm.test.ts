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
 * counts UTF-16 UNITS on the trimmed text — the server's `string.Length`, so an emoji
 * is 2 — refuses what the server refuses (lone surrogate, controls, bidi overrides,
 * invisible name by the server's own rule, raw text over 4x the bound) and never
 * truncates. `clear` is always `null`, whether or not a preview URL is present.
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
import { hasVisibleCharacter } from './textRules'
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

  it('maps image choices: set -> the media id; clear -> null; keep -> absent', () => {
    const withImages = persona({ avatarUrl: '/a.svg', bannerUrl: '/b.svg' })
    expect(
      buildPersonaPatch(withImages, draftWith({
        avatar: { mode: 'set', mediaId: 'media-1', previewUrl: '/x.svg' },
        banner: { mode: 'clear' },
      }, withImages)),
    ).toEqual({ avatarMediaId: 'media-1', bannerMediaId: null })

    // Remove never depends on the preview URL (Gate-1 L-3): the staff DTO has no media id and
    // no has-image flag, and the URL is absent both for "none" and for "signing failed".
    const bare = persona()
    expect(bare.avatarUrl).toBeUndefined()
    expect(buildPersonaPatch(bare, draftWith({ avatar: { mode: 'clear' } }, bare)))
      .toEqual({ avatarMediaId: null })
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

  it('counts UTF-16 UNITS like the server (.NET string.Length): an emoji is TWO', () => {
    const emoji = '😀' // one code point, two UTF-16 units
    expect(emoji.length).toBe(2)
    expect(countedLength(emoji)).toBe(2)
    expect(countedLength(emoji.repeat(3))).toBe(6)
    // 256 emoji = 512 units: exactly the bound. 257 = 514: two over.
    expect(validateDraft(draftWith({ bio: emoji.repeat(256) }))).toEqual({})
    expect(validateDraft(draftWith({ bio: emoji.repeat(257) })).bio)
      .toBe('Bio must be at most 512 characters (2 over).')
    expect(validateDraft(draftWith({ location: emoji.repeat(51) })).location)
      .toBe('Location must be at most 100 characters (2 over).')
  })

  it('a display name of 60 wave emoji (120 units) is refused client-side; 50 fit', () => {
    expect(validateDraft(draftWith({ displayName: '🌊'.repeat(60) })).displayName)
      .toBe('Display name must be at most 100 characters (20 over).')
    expect(validateDraft(draftWith({ displayName: '🌊'.repeat(50) }))).toEqual({})
  })

  it('the raw 4x rule is in UTF-16 units too (201 emoji = 402 > 400 for a display name)', () => {
    const raw = `${' '.repeat(201)}x${' '.repeat(200)}`
    expect(raw.length).toBe(402)
    expect(validateDraft(draftWith({ displayName: raw })).displayName)
      .toMatch(/^Display name must be at most 100 characters\. This text is 402 characters long/)
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
    expect(validateDraft(draftWith({ displayName: 'Name\u200E' }))).toEqual({})
  })

  it('refuses a display name with no VISIBLE character (zero-width / format only)', () => {
    expect(validateDraft(draftWith({ displayName: '\u200B\u200B' })).displayName)
      .toBe('Display name needs at least one visible character.')
    expect(validateDraft(draftWith({ displayName: '\u200D\uFEFF' })).displayName)
      .toBe('Display name needs at least one visible character.')
    // The same characters in a bio/location are not a "no visible character" problem.
    expect(validateDraft(draftWith({ bio: '\u200B' }))).toEqual({})
  })

  // PARITY with the server's own cases (`PersonaProfilePatchParserTests`:
  // DisplayName_WithNoVisibleCharacter_IsRefused / ..._LookalikesAndOtherScripts_StayAllowed,
  // PE-BE Gate-1 S-2): the client must refuse exactly what the server refuses.
  const SERVER_INVISIBLE_NAMES: readonly (readonly [string, string])[] = [
    ['a zero-width space', '\u200B'],
    ['zero-width space, non-joiner, joiner', '\u200B\u200C\u200D'],
    ['BOM and word joiner', '\uFEFF\u2060'],
    ['two Hangul fillers (U+3164)', 'ㅤㅤ'],
    ['Braille blank (U+2800)', '⠀'],
    ['choseong, jungseong and halfwidth fillers', 'ᅟᅠﾠ'],
    ['combining marks only', '́̂'],
    ['zero-width characters around spaces', '\u200B \u00A0 \u200C'],
  ]
  it.each(SERVER_INVISIBLE_NAMES)('server parity — refused as invisible: %s', (_label, value) => {
    expect(hasVisibleCharacter(value)).toBe(false)
    expect(validateDraft(draftWith({ displayName: value })).displayName)
      .toBe('Display name needs at least one visible character.')
  })

  const SERVER_VISIBLE_NAMES: readonly (readonly [string, string])[] = [
    ['Cyrillic о', 'Fulcо EM'],
    ['Cyrillic о, Е, М', 'Fulton Cоunty ЕМ'],
    ['capital I for l', 'FuIcoEM'],
    ['a zero-width space INSIDE a visible name', 'Ful\u200Bco EM'],
    ['an emoji alone', '\u{1F6A8}'],
    ['CJK', '福尔顿'],
  ]
  it.each(SERVER_VISIBLE_NAMES)('server parity — allowed (SOC-052): %s', (_label, value) => {
    expect(hasVisibleCharacter(value)).toBe(true)
    expect(validateDraft(draftWith({ displayName: value }))).toEqual({})
  })

  it('blank "filler" glyphs are invisible although their category looks visible', () => {
    for (const filler of ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀']) {
      expect(hasVisibleCharacter(filler)).toBe(false)
      // ... and one real letter beside them makes the name visible again.
      expect(hasVisibleCharacter(`${filler}A${filler}`)).toBe(true)
    }
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
