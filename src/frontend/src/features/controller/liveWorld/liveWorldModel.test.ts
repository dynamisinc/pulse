/**
 * features/controller/liveWorld/liveWorldModel.test.ts
 * ---------------------------------------------------------------------------
 * The pure model behind the Live world column (demo-polish C2): ordering,
 * buffer-vs-insert ingestion, de-duplication and in-place refresh, the two
 * bounds, filters, and the `ReplyTarget` projection (excerpt <= 140).
 */
import { describe, expect, it } from 'vitest'
import type { Persona } from '@/features/personas'
import { SEEDED_PERSONAS } from '@/features/personas/personaService'
import {
  collectTags,
  compareEntries,
  decodeFilter,
  EMPTY_LIVE_WORLD_STATE,
  encodeFilter,
  excerptOf,
  ingest,
  matchesFilter,
  MAX_PENDING,
  MAX_ROWS,
  MAX_TAG_OPTIONS,
  mediaLabel,
  mergePending,
  REPLY_EXCERPT_MAX,
  shortAuthorId,
  toEntry,
  toLiveWorldPost,
  toReplyTarget,
  unknownAuthorLabel,
  type LiveWorldEntry,
  type LiveWorldState,
} from './liveWorldModel'
import { at, MVEGA, view, WATER } from './liveWorldTestKit'

function entry(id: string, minute: number, seq: number, text = `text of ${id}`): LiveWorldEntry {
  return toEntry(view(id, { scenarioTime: at(minute), text }), seq)
}

function ids(list: readonly LiveWorldEntry[]): string[] {
  return list.map(item => item.view.id)
}

function persona(id: string): Persona {
  const found = SEEDED_PERSONAS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no seeded persona ${id}`)
  return found
}

describe('ordering', () => {
  it('sorts newest-first by SCENARIO time, not arrival order', () => {
    const state = ingest(
      EMPTY_LIVE_WORLD_STATE,
      [entry('old', 5, 1), entry('new', 50, 2), entry('mid', 20, 3)],
      false,
    )
    expect(ids(state.rows)).toEqual(['new', 'mid', 'old'])
  })

  it('breaks a same-instant tie by arrival: the later arrival first', () => {
    const state = ingest(
      EMPTY_LIVE_WORLD_STATE,
      [entry('first', 10, 1), entry('second', 10, 2)],
      false,
    )
    expect(ids(state.rows)).toEqual(['second', 'first'])
  })

  it('sorts an unparseable instant last, and the comparator stays total', () => {
    const bad = toEntry(view('bad', { scenarioTime: 'not-a-date' }), 9)
    const worse = toEntry(view('worse', { scenarioTime: 'also-bad' }), 10)
    const good = entry('good', 1, 1)
    expect(compareEntries(bad, good)).toBeGreaterThan(0)
    expect(compareEntries(good, bad)).toBeLessThan(0)
    expect(compareEntries(bad, worse)).toBeGreaterThan(0) // tie on -Infinity -> seq
    expect(ids(ingest(EMPTY_LIVE_WORLD_STATE, [bad, good], false).rows)).toEqual(['good', 'bad'])
  })
})

describe('ingest: buffer versus insert', () => {
  const base: LiveWorldState = ingest(
    EMPTY_LIVE_WORLD_STATE,
    [entry('a', 10, 1), entry('b', 5, 2)],
    false,
  )

  it('inserts into rows when the controller is not reading', () => {
    const next = ingest(base, [entry('c', 30, 3)], false)
    expect(ids(next.rows)).toEqual(['c', 'a', 'b'])
    expect(next.pending).toEqual([])
  })

  it('holds arrivals in pending, leaving rows untouched, when reading', () => {
    const next = ingest(base, [entry('c', 30, 3), entry('d', 31, 4)], true)
    expect(next.rows).toBe(base.rows) // the SAME array: the list cannot have shifted
    expect(ids(next.pending)).toEqual(['d', 'c'])
  })

  it('mergePending moves the held arrivals into rows in order, and is a no-op when empty', () => {
    const held = ingest(base, [entry('c', 30, 3), entry('z', 1, 4)], true)
    const merged = mergePending(held)
    expect(ids(merged.rows)).toEqual(['c', 'a', 'b', 'z'])
    expect(merged.pending).toEqual([])
    expect(mergePending(base)).toBe(base)
  })

  it('returns the SAME state for an empty batch or an unchanged re-delivery', () => {
    expect(ingest(base, [], false)).toBe(base)
    expect(ingest(base, [entry('a', 10, 7)], false)).toBe(base)
  })
})

describe('ingest: de-duplication and refresh', () => {
  it('never duplicates a post that is already listed, held, or repeated in the batch', () => {
    const base = ingest(EMPTY_LIVE_WORLD_STATE, [entry('a', 10, 1)], false)
    const held = ingest(base, [entry('p', 20, 2)], true)
    const next = ingest(held, [entry('a', 10, 3), entry('p', 20, 4), entry('n', 30, 5),
      entry('n', 30, 6)], false)
    expect(ids(next.rows)).toEqual(['n', 'a'])
    expect(ids(next.pending)).toEqual(['p'])
  })

  it('refreshes the content of a known post in place (new counts), keeping its arrival order', () => {
    const base = ingest(EMPTY_LIVE_WORLD_STATE, [entry('a', 10, 1), entry('b', 5, 2)], false)
    const fresh = toEntry(
      view('a', { scenarioTime: at(10), text: 'text of a', counts: { reply: 0, repost: 0, like: 9 } }),
      99,
    )
    const next = ingest(base, [fresh], false)
    expect(next.rows[0]?.view.counts.like).toBe(9)
    expect(next.rows[0]?.seq).toBe(1)
    expect(next.rows[1]).toBe(base.rows[1]) // an untouched row keeps its identity
  })

  it('refreshes a held post too', () => {
    const held = ingest(EMPTY_LIVE_WORLD_STATE, [entry('p', 20, 1)], true)
    const fresh = toEntry(
      view('p', { scenarioTime: at(20), text: 'text of p', counts: { reply: 4, repost: 0, like: 0 } }),
      2,
    )
    expect(ingest(held, [fresh], true).pending[0]?.view.counts.reply).toBe(4)
  })
})

describe('bounds (burst legibility)', () => {
  it('keeps at most MAX_ROWS rows, dropping the OLDEST', () => {
    const batch = Array.from({ length: MAX_ROWS + 25 }, (_, i) =>
      toEntry(view(`p${i}`, { scenarioTime: new Date(Date.UTC(2033, 8, 4, 0, i)).toISOString() }), i))
    const next = ingest(EMPTY_LIVE_WORLD_STATE, batch, false)
    expect(next.rows).toHaveLength(MAX_ROWS)
    expect(next.rows[0]?.view.id).toBe(`p${MAX_ROWS + 24}`) // newest kept
    expect(ids(next.rows)).not.toContain('p0') // oldest evicted
  })

  it('keeps at most MAX_PENDING held arrivals, dropping the oldest', () => {
    const batch = Array.from({ length: MAX_PENDING + 5 }, (_, i) =>
      toEntry(view(`p${i}`, { scenarioTime: new Date(Date.UTC(2033, 8, 4, 0, i)).toISOString() }), i))
    const next = ingest(EMPTY_LIVE_WORLD_STATE, batch, true)
    expect(next.pending).toHaveLength(MAX_PENDING)
    expect(ids(next.pending)).not.toContain('p0')
  })

  it('merging held arrivals still respects MAX_ROWS', () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) =>
      toEntry(view(`r${i}`, { scenarioTime: new Date(Date.UTC(2033, 8, 4, 0, i)).toISOString() }), i))
    const base = ingest(EMPTY_LIVE_WORLD_STATE, rows, false)
    const held = ingest(base, [toEntry(view('newest', { scenarioTime: at(59) }), 999)], true)
    const merged = mergePending(held)
    expect(merged.rows).toHaveLength(MAX_ROWS)
    expect(merged.rows[0]?.view.id).toBe('newest')
  })
})

describe('filters', () => {
  const tagged = toEntry(view('t', { text: 'Boil notice #WaterIssues and #boil' }), 1)
  const plain = toEntry(view('p', { text: 'nothing here', authorPersonaId: MVEGA }), 2)

  it('matches all, a hashtag (case-insensitively normalised), and a persona', () => {
    expect(matchesFilter(tagged, { kind: 'all' })).toBe(true)
    expect(matchesFilter(tagged, { kind: 'hashtag', tag: 'waterissues' })).toBe(true)
    expect(matchesFilter(plain, { kind: 'hashtag', tag: 'waterissues' })).toBe(false)
    expect(matchesFilter(plain, { kind: 'persona', personaId: MVEGA })).toBe(true)
    expect(matchesFilter(tagged, { kind: 'persona', personaId: MVEGA })).toBe(false)
  })

  it('round-trips through the select value, and an unknown value decodes to ALL (never a hidden filter)', () => {
    for (const filter of [
      { kind: 'all' } as const,
      { kind: 'hashtag', tag: 'boil' } as const,
      { kind: 'persona', personaId: WATER } as const,
    ]) {
      expect(decodeFilter(encodeFilter(filter))).toEqual(filter)
    }
    expect(decodeFilter('')).toEqual({ kind: 'all' })
    expect(decodeFilter('tag:')).toEqual({ kind: 'all' })
    expect(decodeFilter('persona:')).toEqual({ kind: 'all' })
    expect(decodeFilter('bogus')).toEqual({ kind: 'all' })
  })

  it('collects the tags SEEN, listed alphabetically (usage never reorders them)', () => {
    const entries = [
      toEntry(view('1', { text: '#b #a #c' }), 1),
      toEntry(view('2', { text: '#c #b' }), 2),
      toEntry(view('3', { text: '#c' }), 3),
      toEntry(view('4', { text: 'no tags' }), 4),
    ]
    // c is the most used, a the least: the options are still a, b, c.
    expect(collectTags(entries)).toEqual(['a', 'b', 'c'])
    // More use of 'a' later does not move it.
    expect(collectTags([...entries, toEntry(view('5', { text: '#a #a' }), 5)]))
      .toEqual(['a', 'b', 'c'])
  })

  it('caps the tag options at the MOST-USED MAX_TAG_OPTIONS, still alphabetical', () => {
    const many = Array.from({ length: MAX_TAG_OPTIONS + 10 }, (_, i) =>
      toEntry(view(`m${i}`, { text: `#tag${String(i).padStart(3, '0')}` }), i))
    // 'zzz' is used twice, so it makes the cut despite sorting last.
    const popular = [
      toEntry(view('p1', { text: '#zzz' }), 900),
      toEntry(view('p2', { text: '#zzz' }), 901),
    ]
    const tags = collectTags([...many, ...popular])
    expect(tags).toHaveLength(MAX_TAG_OPTIONS)
    expect(tags).toContain('zzz')
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)))
  })
})

describe('projections', () => {
  it('flattens a view and its author, with no provenance and an @-free handle', () => {
    const projected = toLiveWorldPost(
      view('x', {
        inReplyTo: { postId: 'parent', authorHandle: 'mvega_fh' },
        media: [{ id: 'm', kind: 'image', url: '/a.png', alt: 'alt' }],
      }),
      persona(WATER),
    )
    expect(projected).toMatchObject({
      id: 'x',
      authorHandle: 'FairhavenWater',
      authorDisplayName: 'Fairhaven Water Utility',
      authorVerified: true,
      inReplyTo: { postId: 'parent', authorHandle: 'mvega_fh' },
    })
    expect(projected.media).toHaveLength(1)
    expect(Object.keys(projected)).not.toEqual(
      expect.arrayContaining(['origin', 'actingHumanId', 'createdWallClock', 'injectId']),
    )
  })

  it('still projects a post whose author is unknown: UNKNOWN AUTHOR label, flagged, never dropped', () => {
    const guid = '3f9a1c2b-7d4e-4a10-9c55-0a1b2c3d4e5f'
    const projected = toLiveWorldPost(view('x', { authorPersonaId: guid }), undefined)
    expect(projected).toMatchObject({
      id: 'x',
      authorPersonaId: guid,
      authorDisplayName: 'UNKNOWN AUTHOR · 3f9a1c2b',
      authorHandle: 'unknown-3f9a1c2b',
      authorVerified: false,
      authorUnknown: true,
    })
    // A known author carries no flag at all.
    expect('authorUnknown' in toLiveWorldPost(view('y'), persona(WATER))).toBe(false)
  })

  it('shortAuthorId: first 8 characters, after dropping the mock cast\'s persona- prefix', () => {
    expect(shortAuthorId('3f9a1c2b-7d4e-4a10-9c55-0a1b2c3d4e5f')).toBe('3f9a1c2b')
    expect(shortAuthorId('persona-nobody-at-all')).toBe('nobody-a')
    expect(shortAuthorId('abc')).toBe('abc')
    expect(unknownAuthorLabel('persona-ghost')).toBe('UNKNOWN AUTHOR · ghost')
  })

  it('omits media/inReplyTo when absent', () => {
    const projected = toLiveWorldPost(view('x', { media: [] }), persona(WATER))
    expect('media' in projected).toBe(false)
    expect('inReplyTo' in projected).toBe(false)
  })

  it('labels media in text: IMAGE, VIDEO, VIDEO m:ss', () => {
    expect(mediaLabel({ id: '1', kind: 'image', url: 'u', alt: 'a' })).toBe('IMAGE')
    expect(mediaLabel({ id: '2', kind: 'video', url: 'u', alt: 'a' })).toBe('VIDEO')
    expect(mediaLabel({ id: '3', kind: 'video', url: 'u', alt: 'a', durationSec: 24 }))
      .toBe('VIDEO 0:24')
  })
})

describe('ReplyTarget excerpt', () => {
  it('keeps a short post as is, with whitespace collapsed to one line', () => {
    expect(excerptOf('  two\n\nlines   here ')).toBe('two lines here')
  })

  it('cuts a long post to <= 140 with an ellipsis', () => {
    const cut = excerptOf('x'.repeat(500))
    expect(cut.length).toBeLessThanOrEqual(REPLY_EXCERPT_MAX)
    expect(cut.endsWith('…')).toBe(true)
    expect(excerptOf('y'.repeat(REPLY_EXCERPT_MAX))).toBe('y'.repeat(REPLY_EXCERPT_MAX))
  })

  it('never splits a surrogate pair at the cut', () => {
    const cut = excerptOf(`${'a'.repeat(138)}😀😀😀`)
    expect(cut.length).toBeLessThanOrEqual(REPLY_EXCERPT_MAX)
    // No lone high surrogate before the ellipsis.
    expect(/[\ud800-\udbff]…$/.test(cut)).toBe(false)
  })

  it('builds the target from the post: id, bare handle, display name, excerpt', () => {
    const target = toReplyTarget(toLiveWorldPost(view('x', { text: 'hello' }), persona(WATER)))
    expect(target).toEqual({
      postId: 'x',
      authorHandle: 'FairhavenWater',
      authorDisplayName: 'Fairhaven Water Utility',
      excerpt: 'hello',
    })
  })
})
