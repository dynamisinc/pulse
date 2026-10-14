/**
 * core/utils/truncateText.test.ts
 * ---------------------------------------------------------------------------
 * `truncateWithoutSplittingSurrogates`: fitting text is unchanged, a plain cut is
 * exact, and a cut that would split a surrogate pair ends one unit earlier.
 */
import { describe, expect, it } from 'vitest'
import { truncateWithoutSplittingSurrogates } from './truncateText'

describe('truncateWithoutSplittingSurrogates', () => {
  it('returns text that fits unchanged', () => {
    expect(truncateWithoutSplittingSurrogates('hello', 5)).toBe('hello')
    expect(truncateWithoutSplittingSurrogates('', 3)).toBe('')
  })

  it('cuts plain text at exactly max units', () => {
    expect(truncateWithoutSplittingSurrogates('abcdef', 4)).toBe('abcd')
  })

  it('never leaves half of a surrogate pair at the cut', () => {
    const text = `${'a'.repeat(299)}😀tail`
    const cut = truncateWithoutSplittingSurrogates(text, 300)
    expect(cut).toBe('a'.repeat(299))
    expect(cut).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('keeps a whole pair that fits exactly', () => {
    expect(truncateWithoutSplittingSurrogates('ab😀cd', 4)).toBe('ab😀')
  })
})
