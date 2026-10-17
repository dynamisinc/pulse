/**
 * features/login/linkToken.test.ts
 * ---------------------------------------------------------------------------
 * #606: `extractJoinToken` finds the personal-link token in whatever a participant
 * pastes on the home-screen app's sign-in page: a full link, a bare path, a whole
 * invitation message or a bare token. Anything else yields `null`, so the page never
 * posts a value that is not token-shaped.
 */
import { describe, expect, it } from 'vitest'
import { MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH, TOKEN_LENGTH, extractJoinToken } from './linkToken'

/** The shape of a real token: 22 base64url characters. */
const TOKEN = 'aB3_dE6-gH9iJ2kL5mN8oP'

describe('extractJoinToken (#606)', () => {
  it.each([
    ['a full link', `https://bayshield.example/join/${TOKEN}`],
    ['a link with a trailing slash', `https://bayshield.example/join/${TOKEN}/`],
    ['a link with a query and a hash', `https://bayshield.example/join/${TOKEN}?utm=x#top`],
    ['a link from a different host (the server decides)', `https://other.example/join/${TOKEN}`],
    ['a bare path', `/join/${TOKEN}`],
    ['a whole invitation message', `Hi Dana, your sign-in link: https://bayshield.example/join/${TOKEN} See you there.`],
    ['surrounding whitespace and newlines', `\n  https://bayshield.example/join/${TOKEN}  \n`],
    ['a bare token', TOKEN],
    ['a bare token with whitespace', `  ${TOKEN} `],
    ['an upper-case /JOIN/ segment (mail clients rewrite it)', `https://bayshield.example/JOIN/${TOKEN}`],
  ])('reads the token from %s', (_case, pasted) => {
    expect(extractJoinToken(pasted)).toBe(TOKEN)
  })

  it('keeps the mock-mode prefixes working inside a link (length is not pinned there)', () => {
    expect(extractJoinToken('https://localhost:5198/join/demo-dana')).toBe('demo-dana')
  })

  it('takes a BARE value only at exactly the real token length (Gate-1 W-1)', () => {
    expect(TOKEN.length).toBe(TOKEN_LENGTH)
    // Today's word or a sign-in name typed into the link field is never posted.
    expect(extractJoinToken('harborlights')).toBeNull()
    expect(extractJoinToken('dreyes_fairhaven')).toBeNull()
    expect(extractJoinToken(`${TOKEN}x`)).toBeNull()
  })

  it('mock mode: a bare value of any sane length is accepted', () => {
    expect(extractJoinToken('demo-dana', { allowLooseBareToken: true })).toBe('demo-dana')
    expect(extractJoinToken('demo-dana')).toBeNull()
  })

  it.each([
    ['nothing', ''],
    ['only whitespace', '   '],
    ['a link to another page', 'https://bayshield.example/home'],
    ['the scrubbed join address', 'https://bayshield.example/join'],
    ['a sentence with no link', 'I lost my link'],
    ['a word too short to be a token', 'hello'],
    ['a token-like value with forbidden characters', 'abc$def%ghi&jkl'],
    ['a join link whose token is too short', 'https://bayshield.example/join/abc'],
  ])('returns null for %s', (_case, pasted) => {
    expect(extractJoinToken(pasted)).toBeNull()
  })

  it('bounds the length of a token taken from a link', () => {
    const link = (token: string) => `https://bayshield.example/join/${token}`
    expect(extractJoinToken(link('a'.repeat(MIN_TOKEN_LENGTH)))).toBe('a'.repeat(MIN_TOKEN_LENGTH))
    expect(extractJoinToken(link('a'.repeat(MIN_TOKEN_LENGTH - 1)))).toBeNull()
    expect(extractJoinToken(link('a'.repeat(MAX_TOKEN_LENGTH)))).toBe('a'.repeat(MAX_TOKEN_LENGTH))
    expect(extractJoinToken(link('a'.repeat(MAX_TOKEN_LENGTH + 1)))).toBeNull()
  })
})
