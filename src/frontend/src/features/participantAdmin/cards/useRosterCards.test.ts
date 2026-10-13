/**
 * features/participantAdmin/cards/useRosterCards.test.ts
 * ---------------------------------------------------------------------------
 * The query key (XC-001 / COR-001): it carries the active exercise id, ignores order,
 * blanks and repeats, and keeps "everyone" distinct from "nothing usable".
 */
import { describe, expect, it } from 'vitest'
import { ROSTER_CARDS_KEY_ROOT, rosterCardsKey } from './useRosterCards'

describe('rosterCardsKey', () => {
  it('starts with the shared root and the exercise id', () => {
    const key = rosterCardsKey('ex-1', ['a'])
    expect(key[0]).toBe(ROSTER_CARDS_KEY_ROOT)
    expect(key[1]).toBe('ex-1')
  })

  it('differs between exercises for the same people (never serves another exercise)', () => {
    expect(rosterCardsKey('ex-1', ['a', 'b'])).not.toEqual(rosterCardsKey('ex-2', ['a', 'b']))
  })

  it('is the same entry whatever order the ids arrive in', () => {
    expect(rosterCardsKey('ex-1', ['b', 'a', 'c'])).toEqual(rosterCardsKey('ex-1', ['c', 'a', 'b']))
    expect(rosterCardsKey('ex-1', ['b', 'a'])[2]).toEqual(['a', 'b'])
  })

  it('ignores blank, whitespace-only and repeated ids', () => {
    expect(rosterCardsKey('ex-1', ['a', '', ' ', 'a', 'b'])).toEqual(rosterCardsKey('ex-1', ['a', 'b']))
  })

  it('keys an EMPTY input as "all"', () => {
    expect(rosterCardsKey('ex-1', [])[2]).toBe('all')
  })

  it('keeps "all" distinct from a non-empty input with nothing usable', () => {
    const everyone = rosterCardsKey('ex-1', [])
    const nothingUsable = rosterCardsKey('ex-1', ['', '  '])
    expect(nothingUsable[2]).toEqual([])
    expect(nothingUsable).not.toEqual(everyone)
  })

  it('does not mutate the ids it is given', () => {
    const ids = ['b', 'a']
    rosterCardsKey('ex-1', ids)
    expect(ids).toEqual(['b', 'a'])
  })
})
