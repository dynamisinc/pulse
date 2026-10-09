/**
 * features/controller/runSheet/runSheetSchema.test.ts
 * ---------------------------------------------------------------------------
 * The `pulse.runsheet.v1` file format (demo-polish C3; implementation.md §1.9).
 * A valid / invalid matrix, the "reject the WHOLE file with ONE readable message"
 * rule, the cross-beat rules, and the round trip `import(export(x))` deep-equals
 * `x`. Pure functions — no React, no storage.
 */
import { describe, expect, it } from 'vitest'
import {
  RUN_SHEET_LIMITS,
  RUN_SHEET_SCHEMA_ID,
  codePointLength,
  formatScenarioMinute,
  parseRunSheetFile,
  parseRunSheetValue,
  serializeRunSheetFile,
  validateBeat,
  type RunSheetBeat,
  type RunSheetDefinition,
} from './runSheetSchema'

function beat(overrides: Partial<RunSheetBeat> = {}): RunSheetBeat {
  return {
    id: 'b1',
    order: 1,
    title: 'Boil notice',
    scenarioMinute: 14,
    persona: { handle: 'FulcoEM' },
    text: 'Boil-water advisory in effect.',
    ...overrides,
  }
}

function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: RUN_SHEET_SCHEMA_ID,
    name: 'Water crisis',
    beats: [beat()],
    ...overrides,
  }
}

function expectRejected(raw: unknown, fragment: string | RegExp): string {
  const result = parseRunSheetValue(raw)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a rejection')
  if (typeof fragment === 'string') expect(result.message).toContain(fragment)
  else expect(result.message).toMatch(fragment)
  return result.message
}

describe('parseRunSheetValue - valid files', () => {
  it('accepts a minimal file with no beats', () => {
    const result = parseRunSheetValue(file({ beats: [] }))
    expect(result).toEqual({ ok: true, sheet: { name: 'Water crisis', beats: [] } })
  })

  it('accepts every optional member', () => {
    const full = beat({
      media: [
        { mediaId: 'm1', alt: 'A brown tap running' },
        { mediaId: 'm2', alt: 'The treatment plant' },
      ],
      replyTo: { postId: 'post-123' },
      engagementBaseline: { like: 1_000_000, repost: 0, reply: 12 },
      notes: 'Say this slowly.',
    })
    const result = parseRunSheetValue(file({ beats: [full], exportedAt: '2026-10-08T12:00:00.000Z' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheet.beats).toEqual([full])
    expect(result.exportedAt).toBe('2026-10-08T12:00:00.000Z')
  })

  it('accepts a reply to another beat and exactly 4 media items', () => {
    const parent = beat({ id: 'b1', order: 1 })
    const child = beat({
      id: 'b2',
      order: 2,
      replyTo: { beatId: 'b1' },
      media: [1, 2, 3, 4].map(n => ({ mediaId: `m${n}`, alt: `photo ${n}` })),
    })
    expect(parseRunSheetValue(file({ beats: [parent, child] })).ok).toBe(true)
  })

  it('counts text in code points, so 280 emoji is within the limit and 281 is not', () => {
    expect(parseRunSheetValue(file({ beats: [beat({ text: '😀'.repeat(280) })] })).ok).toBe(true)
    expect(parseRunSheetValue(file({ beats: [beat({ text: '😀'.repeat(281) })] })).ok).toBe(false)
    expect(codePointLength('😀a')).toBe(2)
  })

  it('returns the beats sorted by order, whatever order the file lists them in', () => {
    const result = parseRunSheetValue(file({
      beats: [beat({ id: 'b3', order: 3 }), beat({ id: 'b1', order: 1 }), beat({ id: 'b2', order: 2 })],
    }))
    expect(result.ok && result.sheet.beats.map(b => b.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('accepts an exportedAt with a UTC offset or many fractional digits (PowerShell round-trip format)', () => {
    expect(parseRunSheetValue(file({ exportedAt: '2026-10-08T12:00:00.0000000Z' })).ok).toBe(true)
    expect(parseRunSheetValue(file({ exportedAt: '2026-10-08T08:00:00-04:00' })).ok).toBe(true)
  })
})

describe('parseRunSheetValue - the whole file is rejected, with one readable message', () => {
  it('rejects a wrong or missing schema id', () => {
    expectRejected(file({ schema: 'pulse.runsheet.v2' }), 'schema must be "pulse.runsheet.v1"')
    expectRejected({ name: 'x', beats: [] }, 'schema is required')
  })

  it('caps the value it quotes back for a wrong schema id (a hostile file cannot flood the UI)', () => {
    const message = expectRejected(file({ schema: 'x'.repeat(5000) }), 'schema must be "pulse.runsheet.v1"')
    expect(message.length).toBeLessThan(300)
    expect(message).toContain('...')
    // A short value is quoted whole.
    expectRejected(file({ schema: 'pulse.runsheet.v2' }), 'found "pulse.runsheet.v2"')
    // A non-string value is quoted as JSON, also capped.
    const long = expectRejected(file({ schema: ['y'.repeat(500)] }), 'schema must be')
    expect(long.length).toBeLessThan(300)
  })

  it('rejects non-objects and wrong-typed members', () => {
    expectRejected(null, 'The file must be an object')
    expectRejected([], 'The file must be an object')
    expectRejected(file({ beats: 'nope' }), 'beats must be a list')
    expectRejected(file({ name: 7 }), 'name must be a string')
    expectRejected(file({ name: '' }), 'name must not be empty')
    expectRejected(file({ name: 'x'.repeat(121) }), 'name must be at most 120 characters')
  })

  it('rejects unknown keys everywhere (status never belongs in the file)', () => {
    expectRejected(file({ status: 'fired' }), 'this format does not allow: "status"')
    const withStatus = { ...beat(), status: 'fired', firedPostId: 'p1' }
    const message = expectRejected(file({ beats: [withStatus] }), 'beats[0]')
    expect(message).toContain('"status"')
    expectRejected(
      file({ beats: [beat({ persona: { handle: 'a', extra: 1 } as never })] }),
      'beats[0].persona',
    )
  })

  it('rejects more than 200 beats', () => {
    const beats = Array.from({ length: 201 }, (_, i) => beat({ id: `b${i}`, order: i + 1 }))
    expectRejected(file({ beats }), 'too many beats')
    const ok = Array.from({ length: 200 }, (_, i) => beat({ id: `b${i}`, order: i + 1 }))
    expect(parseRunSheetValue(file({ beats: ok })).ok).toBe(true)
  })

  it('rejects duplicate ids and duplicate orders, naming both beats', () => {
    expectRejected(
      file({ beats: [beat({ id: 'a', order: 1 }), beat({ id: 'a', order: 2 })] }),
      'beats[1].id is a duplicate: "a" is already used by beats[0]',
    )
    expectRejected(
      file({ beats: [beat({ id: 'a', order: 1 }), beat({ id: 'b', order: 1 })] }),
      'beats[1].order is a duplicate: 1 is already used by beats[0]',
    )
  })

  it('rejects an id outside [A-Za-z0-9_-] or over 40 characters', () => {
    expectRejected(file({ beats: [beat({ id: 'has space' })] }), 'beats[0].id may only contain')
    expectRejected(file({ beats: [beat({ id: 'x'.repeat(41) })] }), 'beats[0].id must be at most 40')
    expectRejected(file({ beats: [beat({ id: '' })] }), 'beats[0].id must not be empty')
  })

  it('rejects a bad order, minute, or title', () => {
    expectRejected(file({ beats: [beat({ order: 0 })] }), 'beats[0].order must be at least 1')
    expectRejected(file({ beats: [beat({ order: 1.5 })] }), 'beats[0].order must be a whole number')
    expectRejected(file({ beats: [beat({ scenarioMinute: -1 })] }), 'beats[0].scenarioMinute')
    expectRejected(file({ beats: [beat({ scenarioMinute: 2.5 })] }), 'beats[0].scenarioMinute must be a whole number')
    expectRejected(file({ beats: [beat({ title: '' })] }), 'beats[0].title must not be empty')
    expectRejected(file({ beats: [beat({ title: '   ' })] }), 'beats[0].title must not be blank')
    expectRejected(file({ beats: [beat({ title: 't'.repeat(121) })] }), 'beats[0].title must be at most 120')
  })

  it('rejects text over 280 characters and says how long it was', () => {
    const message = expectRejected(
      file({ beats: [beat({ text: 'a'.repeat(281) })] }),
      'beats[0].text is 281 characters; the limit is 280',
    )
    expect(message).toContain('[beat "b1"]')
  })

  it('rejects more than 4 media, duplicate media ids, and missing / blank alt text', () => {
    const five = [1, 2, 3, 4, 5].map(n => ({ mediaId: `m${n}`, alt: `photo ${n}` }))
    expectRejected(file({ beats: [beat({ media: five })] }), 'beats[0].media has too many media items')
    expectRejected(
      file({ beats: [beat({ media: [{ mediaId: 'm1', alt: 'a' }, { mediaId: 'm1', alt: 'b' }] })] }),
      'beats[0].media[1].mediaId is attached twice',
    )
    expectRejected(
      file({ beats: [beat({ media: [{ mediaId: 'm1', alt: '  ' }] })] }),
      'beats[0].media[0].alt alt text is required',
    )
    expectRejected(
      file({ beats: [beat({ media: [{ mediaId: 'm1' } as never] })] }),
      'beats[0].media[0].alt is required',
    )
  })

  it('rejects a bad engagement baseline (negative, fractional, over a million, unknown key)', () => {
    expectRejected(
      file({ beats: [beat({ engagementBaseline: { like: -1 } })] }),
      'beats[0].engagementBaseline.like must be between 0 and 1,000,000',
    )
    expectRejected(
      file({ beats: [beat({ engagementBaseline: { like: 1_000_001 } })] }),
      'beats[0].engagementBaseline.like must be between 0 and 1,000,000',
    )
    expectRejected(
      file({ beats: [beat({ engagementBaseline: { repost: 1.5 } })] }),
      'beats[0].engagementBaseline.repost must be a whole number',
    )
    expectRejected(
      file({ beats: [beat({ engagementBaseline: { share: 5 } as never })] }),
      'beats[0].engagementBaseline has a field this format does not allow: "share"',
    )
  })

  it('rejects a persona handle with "@" or spaces', () => {
    expectRejected(file({ beats: [beat({ persona: { handle: '@FulcoEM' } })] }), 'beats[0].persona.handle')
    expectRejected(file({ beats: [beat({ persona: { handle: 'Fulco EM' } })] }), 'beats[0].persona.handle')
    expectRejected(file({ beats: [beat({ persona: { handle: '' } })] }), 'beats[0].persona.handle')
  })

  it('rejects a replyTo that is not exactly one of beatId / postId', () => {
    const shape = 'must be exactly one of { "beatId"'
    expectRejected(file({ beats: [beat({ replyTo: {} as never })] }), shape)
    expectRejected(file({ beats: [beat({ replyTo: { beatId: 'a', postId: 'b' } as never })] }), shape)
    // A branch that matches by key reports its own, more specific problem.
    expectRejected(
      file({ beats: [beat({ replyTo: { postId: '' } })] }),
      'beats[0].replyTo.postId must not be empty',
    )
  })

  it('rejects a reply to a beat that is missing, to itself, or in a loop', () => {
    expectRejected(
      file({ beats: [beat({ replyTo: { beatId: 'ghost' } })] }),
      'names a beat that is not in this file: "ghost"',
    )
    expectRejected(
      file({ beats: [beat({ replyTo: { beatId: 'b1' } })] }),
      'cannot point at the beat itself',
    )
    expectRejected(
      file({
        beats: [
          beat({ id: 'a', order: 1, replyTo: { beatId: 'b' } }),
          beat({ id: 'b', order: 2, replyTo: { beatId: 'a' } }),
        ],
      }),
      'reply loop',
    )
  })

  it('reports ONLY the first violation, noting how many others there are', () => {
    const message = expectRejected(
      file({ name: '', beats: [beat({ title: '', text: 'a'.repeat(400) })] }),
      'name must not be empty',
    )
    expect(message).toMatch(/\(\d+ more problems? not shown\)/)
  })

  it('rejects an exportedAt that is not an ISO instant', () => {
    expectRejected(file({ exportedAt: 'yesterday' }), 'exportedAt must be an ISO 8601 date-time')
  })
})

describe('parseRunSheetFile - text input', () => {
  it('rejects malformed JSON with a readable message', () => {
    const result = parseRunSheetFile('{ not json')
    expect(result).toEqual({
      ok: false,
      message: 'That file is not valid JSON, so it cannot be a run sheet.',
    })
  })

  it('rejects an oversized file without parsing it', () => {
    const result = parseRunSheetFile(' '.repeat(RUN_SHEET_LIMITS.fileMaxBytes + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('too large')
  })

  it('accepts a file whose JSON text is valid', () => {
    expect(parseRunSheetFile(JSON.stringify(file())).ok).toBe(true)
  })
})

describe('round trip - import(export(x)) deep-equals x', () => {
  const sheet: RunSheetDefinition = {
    name: 'Round trip',
    beats: [
      beat({ id: 'b1', order: 1 }),
      beat({
        id: 'b2',
        order: 2,
        scenarioMinute: 0,
        text: '',
        media: [{ mediaId: 'm1', alt: 'Brown water' }],
        replyTo: { beatId: 'b1' },
        engagementBaseline: { like: 5 },
        notes: 'n',
      }),
      beat({ id: 'b3', order: 3, replyTo: { postId: 'post-9' }, text: 'ünïcødé 😀' }),
    ],
  }

  it('is identical, and the export carries the schema id and no status', () => {
    const text = serializeRunSheetFile(sheet, '2026-10-08T12:00:00.000Z')
    const exported: unknown = JSON.parse(text)
    expect(exported).toMatchObject({ schema: 'pulse.runsheet.v1', name: 'Round trip' })
    expect(text).not.toMatch(/status|firedPostId|exerciseId/)
    const back = parseRunSheetFile(text)
    expect(back.ok && back.sheet).toEqual(sheet)
    expect(back.ok && back.exportedAt).toBe('2026-10-08T12:00:00.000Z')
  })

  it('round-trips an empty sheet and ends the file with a newline', () => {
    const empty: RunSheetDefinition = { name: 'Empty', beats: [] }
    const text = serializeRunSheetFile(empty)
    expect(text.endsWith('\n')).toBe(true)
    const back = parseRunSheetFile(text)
    expect(back.ok && back.sheet).toEqual(empty)
  })
})

describe('validateBeat - the editor gate uses the same rules', () => {
  it('returns no issues for a valid beat and path-keyed issues otherwise', () => {
    expect(validateBeat(beat())).toEqual([])
    const issues = validateBeat(beat({ text: 'a'.repeat(300), media: [{ mediaId: 'm', alt: '' }] }))
    const paths = issues.map(issue => issue.path.join('.'))
    expect(paths).toContain('text')
    expect(paths).toContain('media.0.alt')
  })
})

describe('formatScenarioMinute', () => {
  it('shows the intended minute as T+Nm', () => {
    expect(formatScenarioMinute(14)).toBe('T+14m')
    expect(formatScenarioMinute(0)).toBe('T+0m')
  })
})
