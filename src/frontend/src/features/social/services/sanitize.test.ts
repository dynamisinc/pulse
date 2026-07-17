/**
 * features/social/services/sanitize.test.ts
 * ---------------------------------------------------------------------------
 * NFR-004: a stored `<script>` / `onerror=` attack string must become inert
 * text — never left able to parse as HTML when later rendered.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeText } from './sanitize'

describe('sanitizeText (NFR-004)', () => {
  it('neutralizes a <script> tag into inert text', () => {
    const result = sanitizeText('<script>alert(1)</script>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('</script>')
    expect(result).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('neutralizes an <img onerror=...> attack into inert text', () => {
    const result = sanitizeText('<img src=x onerror="alert(1)">')
    expect(result).not.toMatch(/<[a-z]/i)
    expect(result).not.toContain('<img')
  })

  it('neutralizes a javascript: href attack into inert text', () => {
    const result = sanitizeText('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain('<a ')
    expect(result).not.toContain('</a>')
  })

  it('escapes ampersands, quotes, and apostrophes', () => {
    expect(sanitizeText('Tom & Jerry')).toBe('Tom &amp; Jerry')
    expect(sanitizeText('"quoted" and \'single\'')).toBe(
      '&quot;quoted&quot; and &#39;single&#39;',
    )
  })

  it('leaves ordinary text completely unchanged', () => {
    const plain = 'Boil water advisory remains in effect for Zones 2-4.'
    expect(sanitizeText(plain)).toBe(plain)
  })

  it('handles an empty string', () => {
    expect(sanitizeText('')).toBe('')
  })

  it('is safe to embed directly in an HTML attribute or element without re-escaping risk', () => {
    // The escaped output contains no raw '<', '>', '&', '"', or '\'' characters
    // left over from the original input, so it cannot re-open a tag/attribute.
    const result = sanitizeText('<script>alert("xss")</script>')
    expect(result).not.toMatch(/[<>]/)
  })
})
