/**
 * features/participantAdmin/dayWord/dayWordNormalize.test.ts
 * ---------------------------------------------------------------------------
 * The pure mirror of the server's day-word normalisation (lower-case, `a-z0-9`
 * only) and the live length check built on it. The server stays authoritative;
 * this pins the helper that drives the "3 of 6" hint under the typed-word field.
 */
import { describe, expect, it } from 'vitest'
import {
  checkDayWord,
  DAY_WORD_RULE_HINT,
  describeDayWordCheck,
  normalizeDayWord,
} from './dayWordNormalize'
import { DAY_WORD_MAX_LENGTH, DAY_WORD_MIN_LENGTH } from './types'

describe('normalizeDayWord', () => {
  it('lower-cases', () => {
    expect(normalizeDayWord('PineCone')).toBe('pinecone')
  })

  it('keeps letters and digits only', () => {
    expect(normalizeDayWord('Pine Cone 42!')).toBe('pinecone42')
    expect(normalizeDayWord('a-b_c.d,e f')).toBe('abcdef')
  })

  it('drops everything outside a-z0-9, including accented and non-Latin letters', () => {
    expect(normalizeDayWord('café')).toBe('caf')
    expect(normalizeDayWord('日本語')).toBe('')
  })

  it('treats two spellings of one word as the same word', () => {
    expect(normalizeDayWord('Pine Cone 42')).toBe(normalizeDayWord('pinecone42'))
  })

  it('is idempotent', () => {
    const once = normalizeDayWord('Hello, World 99')
    expect(normalizeDayWord(once)).toBe(once)
  })
})

describe('checkDayWord', () => {
  it('reports empty for nothing or only whitespace', () => {
    expect(checkDayWord('')).toEqual({ kind: 'empty' })
    expect(checkDayWord('   ')).toEqual({ kind: 'empty' })
  })

  it('counts the NORMALISED length, not the typed length', () => {
    // 9 typed characters, only 5 of which count.
    expect(checkDayWord('a b c d e')).toEqual({ kind: 'tooShort', have: 5 })
    // 11 typed characters, 6 of which count: acceptable.
    expect(checkDayWord('a-b c-d e-f')).toEqual({ kind: 'ok', have: 6 })
  })

  it('accepts the minimum and rejects one under it', () => {
    expect(checkDayWord('a'.repeat(DAY_WORD_MIN_LENGTH))).toEqual({
      kind: 'ok',
      have: DAY_WORD_MIN_LENGTH,
    })
    expect(checkDayWord('a'.repeat(DAY_WORD_MIN_LENGTH - 1))).toEqual({
      kind: 'tooShort',
      have: DAY_WORD_MIN_LENGTH - 1,
    })
  })

  it('accepts the maximum and rejects one over it', () => {
    expect(checkDayWord('a'.repeat(DAY_WORD_MAX_LENGTH))).toEqual({
      kind: 'ok',
      have: DAY_WORD_MAX_LENGTH,
    })
    expect(checkDayWord('a'.repeat(DAY_WORD_MAX_LENGTH + 1))).toEqual({
      kind: 'tooLong',
      have: DAY_WORD_MAX_LENGTH + 1,
    })
  })

  it('lets spaces and punctuation pad a word without counting', () => {
    expect(checkDayWord('abc def')).toEqual({ kind: 'ok', have: 6 })
    expect(checkDayWord('!!!ab!!!')).toEqual({ kind: 'tooShort', have: 2 })
  })
})

describe('describeDayWordCheck', () => {
  it('shows the standing rule when nothing is typed', () => {
    expect(describeDayWordCheck({ kind: 'empty' })).toBe(DAY_WORD_RULE_HINT)
    expect(DAY_WORD_RULE_HINT).toMatch(/6 to 64 letters and digits/)
  })

  it('says how far short a word is, in text', () => {
    expect(describeDayWordCheck({ kind: 'tooShort', have: 3 })).toMatch(/3 of 6/)
  })

  it('says how far over a word is, in text', () => {
    expect(describeDayWordCheck({ kind: 'tooLong', have: 70 })).toMatch(/Too long.*70.*64/)
  })

  it('confirms an acceptable word', () => {
    expect(describeDayWordCheck({ kind: 'ok', have: 10 })).toMatch(/Looks good: 10/)
  })
})
