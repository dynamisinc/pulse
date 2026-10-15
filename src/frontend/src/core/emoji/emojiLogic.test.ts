/**
 * core/emoji/emojiLogic.test.ts
 * ---------------------------------------------------------------------------
 * Pure-logic coverage for the shared emoji picker (demo-feedback story 12, DF-15):
 *  - the bundled data set: every category fills whole grid rows (so Up/Down stay
 *    visually straight), no duplicates, every entry is native text with a name;
 *  - search: name + keyword substring, all terms must match, blank = browse;
 *  - grid movement: clamped at the ends, rows of EMOJI_COLUMNS;
 *  - insertAtSelection: caret insert, selection replace, clamping.
 */
import { describe, expect, it } from 'vitest'
import { ALL_EMOJI, EMOJI_CATEGORIES, EMOJI_COLUMNS } from './emojiData'
import { isSearching, searchEmoji } from './emojiSearch'
import { moveInGrid } from './gridNavigation'
import { insertAtSelection } from './insertAtSelection'

describe('emoji data (bundled, native)', () => {
  it('fills whole rows in every category, so arrow keys stay aligned', () => {
    for (const category of EMOJI_CATEGORIES) {
      expect(category.emoji.length % EMOJI_COLUMNS, category.id).toBe(0)
      expect(category.emoji.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate emoji and a name for every one', () => {
    const seen = new Set(ALL_EMOJI.map(entry => entry.emoji))
    expect(seen.size).toBe(ALL_EMOJI.length)
    for (const entry of ALL_EMOJI) {
      expect(entry.name.trim().length, entry.emoji).toBeGreaterThan(0)
      expect(entry.name).toBe(entry.name.toLowerCase())
    }
  })

  it('is plain emoji text: one grapheme, no URLs, no skin tones or ZWJ sequences', () => {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
    for (const { emoji } of ALL_EMOJI) {
      expect([...segmenter.segment(emoji)]).toHaveLength(1)
      expect(emoji).not.toMatch(/[a-z/:.]/i)
      expect(emoji).not.toContain('‍')
      expect(emoji).not.toMatch(/[\u{1F3FB}-\u{1F3FF}]/u)
    }
  })

  it('lists ALL_EMOJI in category order', () => {
    expect(ALL_EMOJI).toEqual(EMOJI_CATEGORIES.flatMap(category => category.emoji))
  })
})

describe('searchEmoji', () => {
  it('returns everything for a blank query (browse mode)', () => {
    expect(isSearching('   ')).toBe(false)
    expect(searchEmoji('  ')).toBe(ALL_EMOJI)
  })

  it('matches names and keywords, case-insensitively', () => {
    expect(searchEmoji('Thumbs').map(e => e.name)).toEqual(['thumbs up', 'thumbs down'])
    expect(searchEmoji('hurricane').map(e => e.emoji)).toEqual(['🌀'])
    expect(searchEmoji('FLOOD').map(e => e.emoji)).toContain('🌊')
  })

  it('requires every term to match', () => {
    expect(searchEmoji('red heart').map(e => e.emoji)).toEqual(['❤️'])
  })

  it('finds an emoji pasted into the search box', () => {
    expect(searchEmoji('🚨').map(e => e.name)).toEqual(['police car light'])
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(isSearching('zzzqqq')).toBe(true)
    expect(searchEmoji('zzzqqq')).toEqual([])
  })
})

describe('moveInGrid', () => {
  const cols = 8

  it('moves right/left one step and stops at the ends', () => {
    expect(moveInGrid(0, 'ArrowRight', 20, cols)).toBe(1)
    expect(moveInGrid(19, 'ArrowRight', 20, cols)).toBe(19)
    expect(moveInGrid(5, 'ArrowLeft', 20, cols)).toBe(4)
    expect(moveInGrid(0, 'ArrowLeft', 20, cols)).toBe(0)
  })

  it('moves down/up a row', () => {
    expect(moveInGrid(2, 'ArrowDown', 20, cols)).toBe(10)
    expect(moveInGrid(10, 'ArrowUp', 20, cols)).toBe(2)
    expect(moveInGrid(3, 'ArrowUp', 20, cols)).toBe(3)
  })

  it('drops to the last emoji when the row below is shorter, and stays on the last row', () => {
    expect(moveInGrid(13, 'ArrowDown', 20, cols)).toBe(19)
    expect(moveInGrid(17, 'ArrowDown', 20, cols)).toBe(17)
  })

  it('is -1 with nothing to move through', () => {
    expect(moveInGrid(0, 'ArrowRight', 0, cols)).toBe(-1)
  })
})

describe('insertAtSelection', () => {
  it('inserts at the caret and puts the caret after the emoji', () => {
    expect(insertAtSelection('Hello world', 5, 5, '👋')).toEqual({
      value: 'Hello👋 world',
      caret: 5 + '👋'.length,
    })
  })

  it('replaces the selected range', () => {
    expect(insertAtSelection('Stay safe out there', 5, 9, '🙏')).toEqual({
      value: 'Stay 🙏 out there',
      caret: 5 + '🙏'.length,
    })
  })

  it('normalises a reversed range', () => {
    expect(insertAtSelection('abcdef', 4, 2, 'X').value).toBe('abXef')
  })

  it('appends when there is no usable selection', () => {
    expect(insertAtSelection('abc', null, null, '🔥')).toEqual({ value: 'abc🔥', caret: 5 })
    expect(insertAtSelection('abc', 99, 99, '🔥').value).toBe('abc🔥')
    expect(insertAtSelection('abc', undefined, 1, '🔥').value).toBe('abc🔥')
  })
})
