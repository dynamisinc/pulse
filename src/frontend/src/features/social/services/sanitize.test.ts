/**
 * features/social/services/sanitize.test.ts
 * ---------------------------------------------------------------------------
 * NFR-004: a stored `<script>` / `onerror=` attack string must be stripped to
 * inert text — never left able to parse as HTML when later rendered. And
 * (H-1): ordinary punctuation (`& " '`) must survive UNCHANGED, so the React
 * text-node render path shows exactly what the author typed (no double-encode,
 * which would break the fiction).
 */
import { describe, expect, it } from 'vitest'
import { sanitizeText } from './sanitize'

describe('sanitizeText (NFR-004)', () => {
  it('strips a <script> block (tag + contents) to nothing', () => {
    const result = sanitizeText('<script>alert(1)</script>')
    expect(result).not.toContain('script')
    expect(result).toBe('')
  })

  it('strips an <img onerror=...> tag entirely', () => {
    const result = sanitizeText('<img src=x onerror="alert(1)">')
    expect(result).not.toMatch(/<[a-z]/i)
    expect(result).not.toContain('onerror')
    expect(result).toBe('')
  })

  it('strips an <a href="javascript:..."> tag but keeps the visible label', () => {
    const result = sanitizeText('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain('<a')
    expect(result).not.toContain('javascript:')
    expect(result).toBe('click')
  })

  it('leaves ampersands, quotes, and apostrophes UNCHANGED (no double-encode, H-1)', () => {
    expect(sanitizeText('Tom & Jerry')).toBe('Tom & Jerry')
    expect(sanitizeText('kids\' school & "the plant"')).toBe('kids\' school & "the plant"')
    expect(sanitizeText('don\'t drink the water')).toBe('don\'t drink the water')
  })

  it('leaves a non-tag "less-than" in ordinary text intact', () => {
    expect(sanitizeText('turnout was 3 < 5 percent')).toBe('turnout was 3 < 5 percent')
  })

  it('leaves ordinary text completely unchanged', () => {
    const plain = 'Boil water advisory remains in effect for Zones 2-4.'
    expect(sanitizeText(plain)).toBe(plain)
  })

  it('handles an empty string', () => {
    expect(sanitizeText('')).toBe('')
  })

  it('leaves no parseable tag behind after stripping', () => {
    const result = sanitizeText('hi <b>there</b> <script>x</script> friend')
    expect(result).not.toMatch(/<\/?[a-z]/i)
    expect(result).toBe('hi there  friend')
  })
})
