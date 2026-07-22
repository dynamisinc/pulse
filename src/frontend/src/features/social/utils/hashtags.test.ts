/**
 * features/social/utils/hashtags.test.ts
 * ---------------------------------------------------------------------------
 * Covers story 01's pure hashtag parser (SOC-040, NFR-004; hashtags-trending
 * feature): `parseHashtags`, `extractHashtags`, `textHasHashtag`. See the
 * module header (`hashtags.ts`) for the exact "what counts as a hashtag" rule
 * this suite pins down.
 */
import { describe, expect, it } from 'vitest'
import { extractHashtags, parseHashtags, textHasHashtag } from './hashtags'

describe('parseHashtags — token stream reconstructs the input exactly', () => {
  it('returns a single text token for a string with no hashtags', () => {
    expect(parseHashtags('no tags here')).toEqual([
      { type: 'text', value: 'no tags here' },
    ])
  })

  it('returns an empty stream for an empty string', () => {
    expect(parseHashtags('')).toEqual([])
  })

  it('splits leading text, a hashtag, and trailing text into three tokens', () => {
    const tokens = parseHashtags('see #Water now')
    expect(tokens).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'hashtag', tag: 'water', raw: '#Water' },
      { type: 'text', value: ' now' },
    ])
  })

  it('handles a hashtag at the very start and the very end with no adjacent text tokens', () => {
    expect(parseHashtags('#Flood update')).toEqual([
      { type: 'hashtag', tag: 'flood', raw: '#Flood' },
      { type: 'text', value: ' update' },
    ])
    expect(parseHashtags('update #Flood')).toEqual([
      { type: 'text', value: 'update ' },
      { type: 'hashtag', tag: 'flood', raw: '#Flood' },
    ])
  })

  it('concatenating every token\'s text/raw reproduces the original string exactly', () => {
    const original = 'Zone 2-4 #BoilWater advisory — share #FairhavenStrong widely!'
    const tokens = parseHashtags(original)
    const rebuilt = tokens.map(t => (t.type === 'text' ? t.value : t.raw)).join('')
    expect(rebuilt).toBe(original)
  })

  it('parses back-to-back hashtags separated only by whitespace', () => {
    expect(parseHashtags('#Water #Advisory')).toEqual([
      { type: 'hashtag', tag: 'water', raw: '#Water' },
      { type: 'text', value: ' ' },
      { type: 'hashtag', tag: 'advisory', raw: '#Advisory' },
    ])
  })
})

describe('parseHashtags — non-matches (SOC-040 "what counts as a hashtag")', () => {
  it('does not match a "#" immediately preceded by a word character (e.g. "C#")', () => {
    expect(parseHashtags('I love C#programming')).toEqual([
      { type: 'text', value: 'I love C#programming' },
    ])
  })

  it('does not match a doubled "#" ("##x")', () => {
    expect(parseHashtags('##x is not a tag')).toEqual([
      { type: 'text', value: '##x is not a tag' },
    ])
  })

  it('does not match an HTML entity like "&#38;"', () => {
    expect(parseHashtags('salt &#38;pepper')).toEqual([
      { type: 'text', value: 'salt &#38;pepper' },
    ])
  })

  it('does not match a pure-number hashtag ("#2024")', () => {
    expect(parseHashtags('see you in #2024')).toEqual([
      { type: 'text', value: 'see you in #2024' },
    ])
  })

  it('does not match an underscore-only hashtag ("#__")', () => {
    expect(parseHashtags('nope #__ nope')).toEqual([
      { type: 'text', value: 'nope #__ nope' },
    ])
  })

  it('DOES match a hashtag with digits as long as at least one ASCII letter is present', () => {
    expect(parseHashtags('#Zone4 evac')).toEqual([
      { type: 'hashtag', tag: 'zone4', raw: '#Zone4' },
      { type: 'text', value: ' evac' },
    ])
  })
})

describe('extractHashtags — distinct, normalized, first-seen order', () => {
  it('returns the distinct normalized tags in first-seen order, de-duping case variants', () => {
    expect(extractHashtags('#Water advisory, more #water news, #Advisory too')).toEqual([
      'water',
      'advisory',
    ])
  })

  it('returns an empty array when there are no hashtags', () => {
    expect(extractHashtags('nothing to see here')).toEqual([])
  })

  it('never returns a duplicate for the exact same tag repeated', () => {
    expect(extractHashtags('#Flood #flood #FLOOD')).toEqual(['flood'])
  })
})

describe('textHasHashtag — case-insensitive membership', () => {
  it('is true regardless of the queried tag\'s casing', () => {
    expect(textHasHashtag('Update on #BoilWater today', 'boilwater')).toBe(true)
    expect(textHasHashtag('Update on #BoilWater today', 'BOILWATER')).toBe(true)
  })

  it('is false when the tag is not present', () => {
    expect(textHasHashtag('Update on #BoilWater today', 'evacuation')).toBe(false)
  })

  it('is false for a non-hashtag look-alike substring (e.g. inside "C#")', () => {
    expect(textHasHashtag('I write C#code', 'code')).toBe(false)
  })
})

describe('hashtag parser is pure and stateless across repeated calls (no regex lastIndex leak)', () => {
  it('a fresh call is unaffected by a previous call on different input', () => {
    const first = parseHashtags('#Alpha only')
    const second = parseHashtags('text with #Beta then #Gamma')
    expect(first).toEqual([
      { type: 'hashtag', tag: 'alpha', raw: '#Alpha' },
      { type: 'text', value: ' only' },
    ])
    expect(second).toEqual([
      { type: 'text', value: 'text with ' },
      { type: 'hashtag', tag: 'beta', raw: '#Beta' },
      { type: 'text', value: ' then ' },
      { type: 'hashtag', tag: 'gamma', raw: '#Gamma' },
    ])
  })
})
