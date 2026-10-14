/**
 * features/controller/personaEdit/personaEditMock.test.ts
 * ---------------------------------------------------------------------------
 * The MOCK adapter of the persona profile edit (demo-polish story 21 / PE-FE):
 * it must speak PE-BE's SHIPPED contract — merge-patch semantics, the EXACT 400
 * texts, 404 for an unknown persona, the server's validation order (body ->
 * persona -> media) — plus the Gate-1 text-hygiene fold, and it must EDIT THE MOCK
 * DIRECTORY so every persona read afterwards (staff and participant) shows the
 * edit. Driven through `patchPersona` (the real client path) wherever the body is
 * a legal `PersonaPatch`, and through the shared axios client directly for bodies
 * the typed client cannot produce (arrays, forbidden fields, wrong types).
 */
import axios from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { api } from '@/core/services/api'
import { resolvePersonas, resolveStaffPersonas, SEEDED_PERSONAS } from '@/features/personas'
import {
  PERSONA_ADMIN_MESSAGES,
  initialsForDisplayName,
  personaPatchMockAdapter,
  resetMockPersonaEdits,
} from './personaEditMock'
import {
  MERGE_PATCH_CONTENT_TYPE,
  PersonaEditError,
  patchPersona,
} from './personaEditService'

const WATER = 'persona-fairhavenwater' // verified, avatar + banner, no location
const TOM = 'persona-tbrandt41' // unverified, no avatar / banner / location
const CANNED_IMAGE = 'mock-media-canned-flood'
const CANNED_VIDEO = 'mock-media-canned-video'

afterEach(() => {
  resetMockPersonaEdits()
})

/** Sends an arbitrary body straight at the mock adapter; resolves with the (error) response. */
async function raw(
  personaId: string,
  body: unknown,
  contentType: string = MERGE_PATCH_CONTENT_TYPE,
) {
  try {
    return await api.patch(`/staff/personas/${personaId}`, body, {
      adapter: personaPatchMockAdapter,
      headers: { 'Content-Type': contentType },
    })
  } catch (failure) {
    if (axios.isAxiosError(failure) && failure.response !== undefined) return failure.response
    throw failure
  }
}

/** The text of the 400 `patchPersona` rejects with. */
async function refusal(personaId: string, body: Record<string, unknown>): Promise<string> {
  const response = await raw(personaId, body)
  expect(response.status).toBe(400)
  return response.data as string
}

function seeded(id: string) {
  const entry = SEEDED_PERSONAS.find(candidate => candidate.id === id)
  if (entry === undefined) throw new Error(`no seeded persona ${id}`)
  return entry
}

describe('mock persona edit — merge-patch semantics (RFC 7396)', () => {
  it('{} is valid: 200 and nothing changes', async () => {
    const before = seeded(WATER)
    const response = await raw(WATER, {})
    expect(response.status).toBe(200)
    expect(response.data).toEqual(before)
    expect(seeded(WATER)).toEqual(before)
  })

  it('absent = unchanged: editing the name leaves every other field alone', async () => {
    const before = seeded(WATER)
    const updated = await patchPersona(WATER, { displayName: 'Fairhaven Water' })
    expect(updated).toEqual({ ...before, displayName: 'Fairhaven Water' })
  })

  it('sets every editable field', async () => {
    const updated = await patchPersona(TOM, {
      displayName: 'Tom B.',
      bio: 'New bio',
      location: 'Fairhaven',
      verified: true,
      avatarMediaId: CANNED_IMAGE,
      bannerMediaId: 'mock-media-canned-plant',
    })
    expect(updated).toMatchObject({
      displayName: 'Tom B.',
      bio: 'New bio',
      location: 'Fairhaven',
      verified: true,
      avatarUrl: '/mock-media/photos/flood-main-street.svg',
      bannerUrl: '/mock-media/photos/water-plant.svg',
    })
  })

  it('null clears bio, location, avatar and banner — the members are ABSENT, never null', async () => {
    await patchPersona(WATER, { location: 'Somewhere' })
    const updated = await patchPersona(WATER, {
      bio: null,
      location: null,
      avatarMediaId: null,
      bannerMediaId: null,
    })
    for (const key of ['bio', 'location', 'avatarUrl', 'bannerUrl']) {
      expect(updated).not.toHaveProperty(key)
    }
    expect(JSON.stringify(updated)).not.toContain('null')
  })

  it('"" after sanitizing is a clear, not an empty string', async () => {
    const updated = await patchPersona(WATER, { bio: '<b></b>   ' })
    expect(updated).not.toHaveProperty('bio')
  })

  it('sanitizes (NFR-004): <script> is stripped from every text field and the result is trimmed', async () => {
    const updated = await patchPersona(WATER, {
      displayName: '  <i>Fairhaven</i> Water  ',
      bio: 'Hello<script>alert(1)</script> world',
      location: '<img src=x onerror=alert(1)>Town',
    })
    expect(updated.displayName).toBe('Fairhaven Water')
    expect(updated.bio).toBe('Hello world')
    expect(updated.location).toBe('Town')
  })

  it('does not touch the immutable members (handle, kind, personaType, exerciseId, id)', async () => {
    const before = seeded(WATER)
    const updated = await patchPersona(WATER, { displayName: 'Renamed', verified: false })
    for (const key of ['id', 'handle', 'kind', 'personaType', 'exerciseId', 'templateId'] as const) {
      expect(updated[key]).toBe(before[key])
    }
  })
})

describe('mock persona edit — the server\'s exact 400 texts', () => {
  it('immutable fields are loud: handle / kind / personaType / exerciseId', async () => {
    for (const field of ['handle', 'kind', 'personaType', 'exerciseId']) {
      expect(await refusal(WATER, { [field]: 'x' })).toBe(`${field} cannot be changed.`)
    }
    expect(await refusal(WATER, { handle: 'x' })).toBe('handle cannot be changed.')
  })

  it('an unknown field (and the whole-persona echo) is a 400 naming the editable fields', async () => {
    const expected = (field: string) =>
      `Unknown field '${field}'. Editable fields: displayName, bio, location, verified, `
      + 'avatarMediaId, bannerMediaId.'
    expect(await refusal(WATER, { nickname: 'x' })).toBe(expected('nickname'))
    expect(await refusal(WATER, { id: WATER })).toBe(expected('id'))
    expect(await refusal(WATER, { avatarUrl: '/x.svg' })).toBe(expected('avatarUrl'))
    // exact camelCase
    expect(await refusal(WATER, { DisplayName: 'x' })).toBe(expected('DisplayName'))
  })

  it('displayName: not null, a string, 1..100', async () => {
    expect(await refusal(WATER, { displayName: null })).toBe('displayName cannot be null.')
    expect(await refusal(WATER, { displayName: 42 })).toBe('displayName must be a string.')
    expect(await refusal(WATER, { displayName: '   ' })).toBe('displayName must be 1 to 100 characters.')
    expect(await refusal(WATER, { displayName: '<b></b>' })).toBe('displayName must be 1 to 100 characters.')
    expect(await refusal(WATER, { displayName: 'n'.repeat(101) }))
      .toBe('displayName must be 1 to 100 characters.')
    expect((await raw(WATER, { displayName: 'n'.repeat(100) })).status).toBe(200)
  })

  it('bio and location: a string or null, bounded 512 / 100', async () => {
    expect(await refusal(WATER, { bio: 5 })).toBe('bio must be a string or null.')
    expect(await refusal(WATER, { bio: 'b'.repeat(513) })).toBe('bio must be at most 512 characters.')
    expect((await raw(WATER, { bio: 'b'.repeat(512) })).status).toBe(200)
    expect(await refusal(WATER, { location: false })).toBe('location must be a string or null.')
    expect(await refusal(WATER, { location: 'l'.repeat(101) }))
      .toBe('location must be at most 100 characters.')
    expect((await raw(WATER, { location: 'l'.repeat(100) })).status).toBe(200)
  })

  it('verified: not null, a boolean', async () => {
    expect(await refusal(WATER, { verified: null })).toBe('verified cannot be null.')
    expect(await refusal(WATER, { verified: 'yes' })).toBe('verified must be true or false.')
  })

  it('avatar / banner must name an IMAGE; unknown ids and videos get the identical text', async () => {
    const avatar = 'avatarMediaId must name an image in this exercise, or be null to clear it.'
    const banner = 'bannerMediaId must name an image in this exercise, or be null to clear it.'
    expect(await refusal(WATER, { avatarMediaId: 'no-such-media' })).toBe(avatar)
    expect(await refusal(WATER, { avatarMediaId: CANNED_VIDEO })).toBe(avatar)
    expect(await refusal(WATER, { avatarMediaId: 12 })).toBe(avatar)
    expect(await refusal(WATER, { bannerMediaId: 'no-such-media' })).toBe(banner)
    expect(await refusal(WATER, { bannerMediaId: CANNED_VIDEO })).toBe(banner)
  })

  it('a body that is not a JSON object is a 400', async () => {
    const text = 'The request body must be a JSON object naming the fields to change (JSON merge-patch).'
    expect((await raw(WATER, [1, 2])).data).toBe(text)
    expect((await raw(WATER, '"just a string"')).data).toBe(text)
    expect((await raw(WATER, 'null')).data).toBe(text)
  })

  it('a body over 16384 bytes is a 400', async () => {
    const response = await raw(WATER, { bio: 'x'.repeat(20000) })
    expect(response.status).toBe(400)
    expect(response.data).toBe('The request body must be at most 16384 bytes.')
  })

  it('exports the texts used above (so the UI tests can quote the same strings)', () => {
    expect(PERSONA_ADMIN_MESSAGES.displayNameLength).toBe('displayName must be 1 to 100 characters.')
  })
})

describe('mock persona edit — status codes and order', () => {
  it('an unknown persona is a 404 with an EMPTY body', async () => {
    const response = await raw('persona-does-not-exist', { displayName: 'x' })
    expect(response.status).toBe(404)
    expect(response.data).toBe('')
  })

  it('order: body (400) before persona (404) before media (400)', async () => {
    expect((await raw('persona-does-not-exist', { displayName: null })).status).toBe(400)
    expect((await raw('persona-does-not-exist', { avatarMediaId: 'no-such-media' })).status).toBe(404)
    expect((await raw(WATER, { avatarMediaId: 'no-such-media' })).status).toBe(400)
  })

  it('a refusal writes NOTHING (a good field beside a bad one is not applied)', async () => {
    const before = seeded(WATER)
    expect((await raw(WATER, { displayName: 'Applied?', bio: 'b'.repeat(513) })).status).toBe(400)
    expect((await raw(WATER, { displayName: 'Applied?', avatarMediaId: CANNED_VIDEO })).status).toBe(400)
    expect(seeded(WATER)).toEqual(before)
  })

  it('only merge-patch+json or json are accepted: anything else is a 415', async () => {
    const text = 'Content-Type must be application/json or application/merge-patch+json.'
    const plain = await raw(WATER, { displayName: 'x' }, 'text/plain')
    expect(plain.status).toBe(415)
    expect(plain.data).toBe(text)
    expect((await raw(WATER, { displayName: 'x' }, 'application/xml')).status).toBe(415)
    expect(seeded(WATER).displayName).toBe('Fairhaven Water Utility')
    // A charset parameter is fine.
    expect(
      (await raw(WATER, { displayName: 'z' }, 'application/merge-patch+json; charset=utf-8')).status,
    ).toBe(200)
    expect((await raw(WATER, { displayName: 'x' }, 'application/json')).status).toBe(200)
    expect((await raw(WATER, { displayName: 'y' }, 'application/merge-patch+json')).status).toBe(200)
  })
})

describe('mock persona edit — PE-BE Gate-1 text hygiene', () => {
  const lone = '😀'.charAt(0)

  it('a lone UTF-16 surrogate is the "must be a JSON object" 400, in any text field', async () => {
    const text = PERSONA_ADMIN_MESSAGES.bodyNotObject
    for (const field of ['displayName', 'bio', 'location']) {
      expect(await refusal(WATER, { [field]: `half ${lone}` })).toBe(text)
    }
    // A whole pair is fine.
    expect((await raw(WATER, { bio: 'whole 😀' })).status).toBe(200)
  })

  it('lengths are UTF-16 UNITS like the server\'s string.Length: an emoji counts TWO', async () => {
    // 256 emoji = 512 units (legal), 257 = 514 (refused) — NOT "512 emoji are legal".
    expect((await raw(WATER, { bio: '😀'.repeat(256) })).status).toBe(200)
    expect(await refusal(WATER, { bio: '😀'.repeat(257) })).toBe('bio must be at most 512 characters.')
    expect(await refusal(WATER, { bio: '😀'.repeat(512) })).toBe('bio must be at most 512 characters.')
    // A display name of 60 waves is 120 units: refused. 50 waves = 100: legal.
    expect(await refusal(WATER, { displayName: '🌊'.repeat(60) }))
      .toBe('displayName must be 1 to 100 characters.')
    expect((await raw(WATER, { displayName: '🌊'.repeat(50) })).status).toBe(200)
    expect(await refusal(WATER, { location: '📍'.repeat(51) }))
      .toBe('location must be at most 100 characters.')
    expect((await raw(WATER, { location: '📍'.repeat(50) })).status).toBe(200)
  })

  it('the raw 4x rule counts units too: 201 emoji (402 units) are refused before sanitizing', async () => {
    expect(await refusal(WATER, { displayName: '🌊'.repeat(201) }))
      .toBe('displayName must be 1 to 100 characters.')
  })

  it('raw text over 4x the bound is refused BEFORE sanitizing, with the ordinary length message', async () => {
    // 4 x 100 = 400: padded with markup that would sanitize down to nothing.
    const markup = '<b></b>'.repeat(60) // 420 raw characters, empty once sanitized
    expect(await refusal(WATER, { location: markup })).toBe('location must be at most 100 characters.')
    expect(await refusal(WATER, { displayName: ` ${markup}` }))
      .toBe('displayName must be 1 to 100 characters.')
    expect(await refusal(WATER, { bio: `${' '.repeat(2048)}x` })).toBe('bio must be at most 512 characters.')
    // Exactly 4x (2048) is accepted.
    expect((await raw(WATER, { bio: `x${' '.repeat(2047)}` })).status).toBe(200)
  })

  // The server's own sentences (PE-BE Gate-1 fold, 5cee307).
  const CONTROL_OR_BIDI = {
    displayName:
      'displayName must not contain control characters or bidirectional override characters.',
    bio: 'bio must not contain control characters (line breaks and tabs are allowed) or '
      + 'bidirectional override characters.',
    location: 'location must not contain control characters or bidirectional override characters.',
  } as const

  it('C0/C1 control characters are refused in all three text fields, with the server\'s sentence', async () => {
    for (const field of ['displayName', 'bio', 'location'] as const) {
      for (const control of ['\u0000', '\u001F', '\u007F', '\u0085']) {
        const response = await raw(WATER, { [field]: `a${control}b` })
        expect(response.status).toBe(400)
        expect(response.data).toBe(CONTROL_OR_BIDI[field])
      }
    }
  })

  it('bio allows line breaks and tabs; displayName and location refuse every control character', async () => {
    expect((await raw(WATER, { bio: 'line one\r\nline two\n\tindented' })).status).toBe(200)
    expect(seeded(WATER).bio).toBe('line one\r\nline two\n\tindented')
    expect(await refusal(WATER, { displayName: 'Two\nLines' })).toBe(CONTROL_OR_BIDI.displayName)
    expect(await refusal(WATER, { displayName: 'Tab\there' })).toBe(CONTROL_OR_BIDI.displayName)
    expect(await refusal(WATER, { location: 'Two\nLines' })).toBe(CONTROL_OR_BIDI.location)
    // Other C0 controls are still refused in the bio.
    expect(await refusal(WATER, { bio: 'bell\u0007' })).toBe(CONTROL_OR_BIDI.bio)
  })

  it('bidi overrides U+202A-202E and U+2066-2069 are refused in all three text fields', async () => {
    for (const cp of [0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]) {
      for (const field of ['displayName', 'bio', 'location'] as const) {
        const response = await raw(WATER, { [field]: `x${String.fromCodePoint(cp)}y` })
        expect(response.status).toBe(400)
        expect(response.data).toBe(CONTROL_OR_BIDI[field])
      }
    }
    // LRM / RLM are ordinary marks, not overrides.
    expect((await raw(WATER, { displayName: 'Name\u200E' })).status).toBe(200)
  })

  it('a displayName with no visible characters is refused', async () => {
    expect(await refusal(WATER, { displayName: '\u200B\u200B' }))
      .toBe('displayName must contain at least one visible character.')
  })

  it('lookalike (homoglyph) names are ALLOWED (SOC-052)', async () => {
    const response = await raw(WATER, { displayName: 'Fаirhаvеn Wаtеr Utility' })
    expect(response.status).toBe(200)
  })
})

describe('mock persona edit — it edits the mock DIRECTORY', () => {
  it('the staff read and the participant read both show the edit; the participant one still has no personaType', async () => {
    await patchPersona(TOM, { displayName: 'Thomas Brandt', verified: true, bio: 'Edited bio' })

    const staff = (await resolveStaffPersonas()).find(p => p.id === TOM)
    expect(staff).toMatchObject({ displayName: 'Thomas Brandt', verified: true, bio: 'Edited bio' })
    expect(staff?.personaType).toBe('citizen')

    const participant = (await resolvePersonas()).find(p => p.id === TOM)
    expect(participant).toMatchObject({ displayName: 'Thomas Brandt', verified: true, bio: 'Edited bio' })
    expect(participant).not.toHaveProperty('personaType')
  })

  it('a held reference to the old persona is an immutable snapshot (the array element is replaced)', async () => {
    const held = seeded(TOM)
    await patchPersona(TOM, { displayName: 'Changed' })
    expect(held.displayName).toBe('Tom Brandt')
    expect(seeded(TOM).displayName).toBe('Changed')
  })

  it('resetMockPersonaEdits() restores every seed', async () => {
    await patchPersona(TOM, { displayName: 'Changed', avatarMediaId: CANNED_IMAGE })
    await patchPersona(WATER, { bio: null })
    resetMockPersonaEdits()
    expect(seeded(TOM).displayName).toBe('Tom Brandt')
    expect(seeded(TOM)).not.toHaveProperty('avatarUrl')
    expect(seeded(WATER).bio).toMatch(/^Official account of the Fairhaven municipal water utility/)
  })

  it('rejects with a PersonaEditError carrying the server sentence VERBATIM', async () => {
    await expect(patchPersona(WATER, { bio: 'b'.repeat(513) })).rejects.toMatchObject({
      name: 'PersonaEditError',
      kind: 'rejected',
      status: 400,
      message: 'bio must be at most 512 characters.',
    })
    await expect(patchPersona('persona-does-not-exist', {})).rejects.toBeInstanceOf(PersonaEditError)
  })
})

describe('mock persona edit — initials are re-derived on rename (the server\'s rule)', () => {
  it('a rename recomputes the monogram from the new display name', async () => {
    expect(seeded(WATER).initials).toBe('FW')
    expect((await patchPersona(WATER, { displayName: 'Hartwell Municipal Water' })).initials).toBe('HM')
    expect(seeded(WATER).initials).toBe('HM')
  })

  it('first letter of the first TWO words, upper-cased; extra spaces and one word are fine', async () => {
    expect((await patchPersona(TOM, { displayName: 'marisol   vega' })).initials).toBe('MV')
    expect((await patchPersona(TOM, { displayName: 'Cher' })).initials).toBe('C')
    expect((await patchPersona(TOM, { displayName: 'one two three four' })).initials).toBe('OT')
  })

  it('is unchanged by an edit that does not rename', async () => {
    const before = seeded(WATER).initials
    expect((await patchPersona(WATER, { bio: 'Only the bio changes' })).initials).toBe(before)
    expect((await patchPersona(WATER, { verified: false })).initials).toBe(before)
  })

  it('initialsForDisplayName takes the first letter or digit per word, like the server', () => {
    expect(initialsForDisplayName('Newsline 7')).toBe('N7')
    expect(initialsForDisplayName('  spaced   out  ')).toBe('SO')
    expect(initialsForDisplayName('ßeta gamma')).toBe('ßG') // .NET ToUpperInvariant keeps ß
    expect(initialsForDisplayName('')).toBe('')
    // Mirrors the server's PersonaResponseDtoTests cases: emoji and punctuation are
    // skipped, never a lone surrogate; an all-emoji name has no initials.
    expect(initialsForDisplayName('🌊 Fairhaven Water')).toBe('FW')
    expect(initialsForDisplayName('🌊🌊')).toBe('')
    expect(initialsForDisplayName('(Official) Fairhaven')).toBe('OF')
    expect(initialsForDisplayName('Пожарная служба')).toBe('ПС')
    expect(initialsForDisplayName('9th\tDistrict')).toBe('9D')
    expect(initialsForDisplayName('\u{10428}ord x')).toBe('\u{10400}X') // astral letter stays whole
  })

  it('the avatar colour is derived from the HANDLE, so a rename leaves it alone', async () => {
    const before = seeded(WATER).avatarColor
    expect((await patchPersona(WATER, { displayName: 'Something Else' })).avatarColor).toBe(before)
  })
})

describe('mock persona edit — display name visibility follows the server\'s rule', () => {
  const BLANK_ONLY = [0x3164, 0x2800, 0x115F, 0x1160, 0xFFA0].map(cp => String.fromCodePoint(cp))
  const COMBINING_ONLY = String.fromCodePoint(0x0301, 0x0302)

  it('blank filler glyphs and combining-only names get the "no visible character" 400', async () => {
    for (const filler of BLANK_ONLY) {
      expect(await refusal(WATER, { displayName: filler.repeat(2) }))
        .toBe('displayName must contain at least one visible character.')
    }
    expect(await refusal(WATER, { displayName: COMBINING_ONLY }))
      .toBe('displayName must contain at least one visible character.')
  })

  it('a real letter next to blank glyphs is visible', async () => {
    const zeroWidth = String.fromCodePoint(0x200B)
    expect((await raw(WATER, { displayName: `Ful${zeroWidth}co EM` })).status).toBe(200)
    expect((await raw(WATER, { displayName: `${BLANK_ONLY.join('')}A` })).status).toBe(200)
  })
})
